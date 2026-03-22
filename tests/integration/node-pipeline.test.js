/**
 * Integration tests for the geometry node evaluation pipeline.
 *
 * Tests the full path: registry → node registration → graph construction → evaluation
 * using the actual v2 node modules.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../../core/registry.js';
import { NodeGraph } from '../../core/graph.js';
import { GeometrySet } from '../../core/geometry.js';
import { isField } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerCurveNodes } from '../../geo/nodes_v2_curves.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';

// Register all nodes once
before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerCurveNodes(registry);
  registerFieldNodes(registry);
});

// Helper to build a simple graph and evaluate
function evaluateSimpleGraph(nodeConfigs) {
  const graph = new NodeGraph('geo');

  const nodes = {};
  let x = 0;
  for (const [key, config] of Object.entries(nodeConfigs)) {
    const node = graph.addNode(config.type, x, 0);
    if (!node) throw new Error(`Failed to add node: ${config.type}`);
    if (config.values) {
      for (const [k, v] of Object.entries(config.values)) {
        graph.setNodeValue(node.id, k, v);
      }
    }
    nodes[key] = node;
    x += 200;
  }

  // Apply connections
  for (const [key, config] of Object.entries(nodeConfigs)) {
    if (config.connections) {
      for (const conn of config.connections) {
        graph.addConnection(nodes[conn.from].id, conn.fromSocket, nodes[key].id, conn.toSocket);
      }
    }
  }

  return graph.evaluate();
}

describe('Node Registration', () => {
  it('should register primitive nodes', () => {
    assert.ok(registry.getNodeDef('geo', 'mesh_cube'));
    assert.ok(registry.getNodeDef('geo', 'mesh_grid'));
    assert.ok(registry.getNodeDef('geo', 'mesh_uv_sphere'));
    assert.ok(registry.getNodeDef('geo', 'mesh_cylinder'));
    assert.ok(registry.getNodeDef('geo', 'mesh_cone'));
    assert.ok(registry.getNodeDef('geo', 'mesh_ico_sphere'));
    assert.ok(registry.getNodeDef('geo', 'mesh_torus'));
  });

  it('should register operation nodes', () => {
    assert.ok(registry.getNodeDef('geo', 'set_position'));
    assert.ok(registry.getNodeDef('geo', 'transform_geometry'));
    assert.ok(registry.getNodeDef('geo', 'delete_geometry'));
    assert.ok(registry.getNodeDef('geo', 'join_geometry'));
    assert.ok(registry.getNodeDef('geo', 'instance_on_points'));
    assert.ok(registry.getNodeDef('geo', 'realize_instances'));
  });

  it('should register field nodes', () => {
    assert.ok(registry.getNodeDef('geo', 'position'));
    assert.ok(registry.getNodeDef('geo', 'normal'));
    assert.ok(registry.getNodeDef('geo', 'index'));
    assert.ok(registry.getNodeDef('geo', 'math'));
    assert.ok(registry.getNodeDef('geo', 'vector_math'));
    assert.ok(registry.getNodeDef('geo', 'map_range'));
    assert.ok(registry.getNodeDef('geo', 'compare'));
    assert.ok(registry.getNodeDef('geo', 'clamp'));
  });

  it('should register curve nodes', () => {
    assert.ok(registry.getNodeDef('geo', 'resample_curve'));
    assert.ok(registry.getNodeDef('geo', 'sample_curve'));
    assert.ok(registry.getNodeDef('geo', 'curve_to_mesh'));
  });

  it('should register categories', () => {
    const cats = registry.getCategories('geo');
    assert.ok(Object.keys(cats).length > 0);
    assert.ok(cats.MESH_PRIMITIVES);
    assert.ok(cats.CURVE_PRIMITIVES);
  });
});

describe('Primitive Node Evaluation', () => {
  it('mesh_cube should produce a GeometrySet with mesh data', () => {
    const def = registry.getNodeDef('geo', 'mesh_cube');
    const result = def.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {});
    const gs = result.outputs[0];
    assert.ok(gs instanceof GeometrySet);
    assert.ok(gs.mesh);
    assert.ok(gs.mesh.vertexCount >= 8);
    assert.ok(gs.mesh.faceCount > 0);
  });

  it('mesh_grid should produce correct vertex grid', () => {
    const def = registry.getNodeDef('geo', 'mesh_grid');
    const result = def.evaluate({ sizeX: 2, sizeY: 2, verticesX: 3, verticesY: 3 }, {});
    const gs = result.outputs[0];
    assert.ok(gs instanceof GeometrySet);
    assert.equal(gs.mesh.vertexCount, 9); // 3x3
  });

  it('mesh_ico_sphere should produce icosahedron at subdivision 0', () => {
    const def = registry.getNodeDef('geo', 'mesh_ico_sphere');
    const result = def.evaluate({ radius: 1, subdivisions: 0 }, {});
    const gs = result.outputs[0];
    assert.equal(gs.mesh.vertexCount, 12);
    assert.equal(gs.mesh.faceCount, 20);
  });

  it('curve_line should produce a curve with 2 points', () => {
    const def = registry.getNodeDef('geo', 'curve_line');
    const result = def.evaluate(
      { startX: 0, startY: 0, startZ: 0, endX: 1, endY: 0, endZ: 0 },
      {},
    );
    const gs = result.outputs[0];
    assert.ok(gs instanceof GeometrySet);
    assert.ok(gs.curve);
    assert.equal(gs.curve.splineCount, 1);
    assert.equal(gs.curve.pointCount, 2);
  });

  it('curve_circle should produce cyclic curve', () => {
    const def = registry.getNodeDef('geo', 'curve_circle');
    const result = def.evaluate({ resolution: 12, radius: 1 }, {});
    const gs = result.outputs[0];
    assert.ok(gs.curve);
    assert.equal(gs.curve.splines[0].cyclic, true);
    assert.equal(gs.curve.pointCount, 12);
  });
});

describe('Field Node Evaluation', () => {
  it('position node should return a Field', () => {
    const def = registry.getNodeDef('geo', 'position');
    const result = def.evaluate({}, {});
    assert.ok(isField(result.outputs[0]));
  });

  it('normal node should return a Field', () => {
    const def = registry.getNodeDef('geo', 'normal');
    const result = def.evaluate({}, {});
    assert.ok(isField(result.outputs[0]));
  });

  it('index node should return a Field', () => {
    const def = registry.getNodeDef('geo', 'index');
    const result = def.evaluate({}, {});
    assert.ok(isField(result.outputs[0]));
  });

  it('math ADD should add two scalars', () => {
    const def = registry.getNodeDef('geo', 'math');
    const result = def.evaluate({ operation: 'ADD', clampResult: false, value: 3, value2: 4, value3: 0 }, {});
    assert.equal(result.outputs[0], 7);
  });

  it('math MULTIPLY should multiply', () => {
    const def = registry.getNodeDef('geo', 'math');
    const result = def.evaluate({ operation: 'MULTIPLY', clampResult: false, value: 3, value2: 4, value3: 0 }, {});
    assert.equal(result.outputs[0], 12);
  });

  it('math with clamp should clamp to 0-1', () => {
    const def = registry.getNodeDef('geo', 'math');
    const result = def.evaluate({ operation: 'ADD', clampResult: true, value: 0.8, value2: 0.5, value3: 0 }, {});
    assert.equal(result.outputs[0], 1); // 1.3 clamped to 1
  });

  it('math with field input should return a field', () => {
    const def = registry.getNodeDef('geo', 'math');
    const indexDef = registry.getNodeDef('geo', 'index');
    const indexResult = indexDef.evaluate({}, {}).outputs[0];

    const result = def.evaluate(
      { operation: 'ADD', clampResult: false, value: 0, value2: 10, value3: 0 },
      { 'Value': indexResult },
    );
    assert.ok(isField(result.outputs[0]));
    // Evaluate at index=5
    const val = result.outputs[0].evaluateAt({ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, index: 5, count: 10 });
    assert.equal(val, 15); // index(5) + 10
  });

  it('clamp should clamp values', () => {
    const def = registry.getNodeDef('geo', 'clamp');
    const result = def.evaluate({ clampType: 'MINMAX', min: 0, max: 1 }, { 'Value': 5 });
    assert.equal(result.outputs[0], 1);
  });

  it('map_range should map linearly', () => {
    const def = registry.getNodeDef('geo', 'map_range');
    const result = def.evaluate({
      interpolation: 'LINEAR',
      clamp: false,
      fromMin: 0,
      fromMax: 1,
      toMin: 0,
      toMax: 100,
    }, { 'Value': 0.5 });
    assert.equal(result.outputs[0], 50);
  });

  it('separate_xyz should split vector into components', () => {
    const def = registry.getNodeDef('geo', 'separate_xyz');
    const result = def.evaluate({ x: 0, y: 0, z: 0 }, { 'Vector': { x: 1, y: 2, z: 3 } });
    assert.equal(result.outputs[0], 1); // X
    assert.equal(result.outputs[1], 2); // Y
    assert.equal(result.outputs[2], 3); // Z
  });

  it('combine_xyz should create vector from components', () => {
    const def = registry.getNodeDef('geo', 'combine_xyz');
    const result = def.evaluate({ x: 0, y: 0, z: 0 }, { 'X': 10, 'Y': 20, 'Z': 30 });
    assert.deepEqual(result.outputs[0], { x: 10, y: 20, z: 30 });
  });
});

describe('Boolean Math Node', () => {
  it('should register boolean_math', () => {
    assert.ok(registry.getNodeDef('geo', 'boolean_math'));
  });

  it('AND should return true only when both inputs are true', () => {
    const def = registry.getNodeDef('geo', 'boolean_math');
    assert.equal(def.evaluate({ operation: 'AND', a: true, b: true }, {}).outputs[0], true);
    assert.equal(def.evaluate({ operation: 'AND', a: true, b: false }, {}).outputs[0], false);
    assert.equal(def.evaluate({ operation: 'AND', a: false, b: false }, {}).outputs[0], false);
  });

  it('OR should return true when either input is true', () => {
    const def = registry.getNodeDef('geo', 'boolean_math');
    assert.equal(def.evaluate({ operation: 'OR', a: false, b: true }, {}).outputs[0], true);
    assert.equal(def.evaluate({ operation: 'OR', a: false, b: false }, {}).outputs[0], false);
  });

  it('NOT should negate first input', () => {
    const def = registry.getNodeDef('geo', 'boolean_math');
    assert.equal(def.evaluate({ operation: 'NOT', a: true, b: false }, {}).outputs[0], false);
    assert.equal(def.evaluate({ operation: 'NOT', a: false, b: false }, {}).outputs[0], true);
  });

  it('XOR should return true when inputs differ', () => {
    const def = registry.getNodeDef('geo', 'boolean_math');
    assert.equal(def.evaluate({ operation: 'XOR', a: true, b: false }, {}).outputs[0], true);
    assert.equal(def.evaluate({ operation: 'XOR', a: true, b: true }, {}).outputs[0], false);
  });
});

describe('Random Value Node', () => {
  it('should register random_value', () => {
    assert.ok(registry.getNodeDef('geo', 'random_value'));
  });

  it('should return a Field for per-element randomness', () => {
    const def = registry.getNodeDef('geo', 'random_value');
    const result = def.evaluate({ data_type: 'FLOAT', min: 0, max: 1, seed: 42 }, {});
    assert.ok(isField(result.outputs[0]));
  });

  it('FLOAT values should be within min/max range', () => {
    const def = registry.getNodeDef('geo', 'random_value');
    const result = def.evaluate({ data_type: 'FLOAT', min: 0, max: 1, seed: 0 }, {});
    const field = result.outputs[0];
    for (let i = 0; i < 20; i++) {
      const v = field.evaluateAt({ index: i, count: 20, position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } });
      assert.ok(v >= 0 && v <= 1, `Value ${v} out of range [0,1] at index ${i}`);
    }
  });

  it('different seeds should produce different values', () => {
    const def = registry.getNodeDef('geo', 'random_value');
    const f1 = def.evaluate({ data_type: 'FLOAT', min: 0, max: 1, seed: 0 }, {}).outputs[0];
    const f2 = def.evaluate({ data_type: 'FLOAT', min: 0, max: 1, seed: 99 }, {}).outputs[0];
    const el = { index: 0, count: 1, position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
    assert.notEqual(f1.evaluateAt(el), f2.evaluateAt(el));
  });
});

describe('Integer Math Node', () => {
  it('should register integer_math', () => {
    assert.ok(registry.getNodeDef('geo', 'integer_math'));
  });

  it('ADD should add integers', () => {
    const def = registry.getNodeDef('geo', 'integer_math');
    assert.equal(def.evaluate({ operation: 'ADD', value: 3, value2: 4 }, {}).outputs[0], 7);
  });

  it('MULTIPLY should multiply integers', () => {
    const def = registry.getNodeDef('geo', 'integer_math');
    assert.equal(def.evaluate({ operation: 'MULTIPLY', value: 3, value2: 4 }, {}).outputs[0], 12);
  });

  it('MODULO should return remainder', () => {
    const def = registry.getNodeDef('geo', 'integer_math');
    assert.equal(def.evaluate({ operation: 'MODULO', value: 7, value2: 3 }, {}).outputs[0], 1);
  });

  it('DIVIDE should truncate to integer', () => {
    const def = registry.getNodeDef('geo', 'integer_math');
    assert.equal(def.evaluate({ operation: 'DIVIDE', value: 7, value2: 2 }, {}).outputs[0], 3);
  });

  it('DIVIDE by zero should return 0', () => {
    const def = registry.getNodeDef('geo', 'integer_math');
    assert.equal(def.evaluate({ operation: 'DIVIDE', value: 7, value2: 0 }, {}).outputs[0], 0);
  });

  it('GCD should compute greatest common divisor', () => {
    const def = registry.getNodeDef('geo', 'integer_math');
    assert.equal(def.evaluate({ operation: 'GCD', value: 12, value2: 8 }, {}).outputs[0], 4);
  });

  it('ABS should return absolute value', () => {
    const def = registry.getNodeDef('geo', 'integer_math');
    assert.equal(def.evaluate({ operation: 'ABS', value: -5, value2: 0 }, {}).outputs[0], 5);
  });

  it('NEGATE should negate', () => {
    const def = registry.getNodeDef('geo', 'integer_math');
    assert.equal(def.evaluate({ operation: 'NEGATE', value: 5, value2: 0 }, {}).outputs[0], -5);
  });
});

describe('Operation Node Evaluation', () => {
  it('transform_geometry should accept and return geometry', () => {
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cubeResult = cubeDef.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {});
    const cube = cubeResult.outputs[0];

    const transformDef = registry.getNodeDef('geo', 'transform_geometry');
    const result = transformDef.evaluate(
      { translateX: 5, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      { 'Geometry': cube },
    );
    const transformed = result.outputs[0];
    assert.ok(transformed instanceof GeometrySet);
    assert.ok(transformed.mesh.vertexCount >= 8);
    const avgX = transformed.mesh.positions.reduce((s, p) => s + p.x, 0) / transformed.mesh.positions.length;
    assert.ok(Math.abs(avgX - 5) < 0.01, `Expected avg X ~5, got ${avgX}`);
  });

  it('join_geometry should combine two meshes', () => {
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cube1 = cubeDef.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];
    const cube2 = cubeDef.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];

    const joinDef = registry.getNodeDef('geo', 'join_geometry');
    const result = joinDef.evaluate({}, { 'Geometry 1': cube1, 'Geometry 2': cube2 });
    const joined = result.outputs[0];
    assert.ok(joined instanceof GeometrySet);
    assert.ok(joined.mesh.vertexCount >= cube1.mesh.vertexCount);
  });

  it('set_position with offset should move vertices', () => {
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cube = cubeDef.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];

    const n = cube.mesh.positions.length;
    const originalCenterX = cube.mesh.positions.reduce((s, p) => s + p.x, 0) / n;

    const setPosDef = registry.getNodeDef('geo', 'set_position');
    const result = setPosDef.evaluate(
      {},
      { 'Geometry': cube, 'Offset': { x: 10, y: 0, z: 0 } },
    );
    const moved = result.outputs[0];
    const newCenterX = moved.mesh.positions.reduce((s, p) => s + p.x, 0) / moved.mesh.positions.length;

    assert.ok(Math.abs(newCenterX - (originalCenterX + 10)) < 0.01);
  });
});

describe('Curve Node Evaluation', () => {
  it('resample_curve should change point count', () => {
    const lineDef = registry.getNodeDef('geo', 'curve_line');
    const line = lineDef.evaluate(
      { startX: 0, startY: 0, startZ: 0, endX: 10, endY: 0, endZ: 0 },
      {},
    ).outputs[0];
    assert.equal(line.curve.pointCount, 2);

    const resampleDef = registry.getNodeDef('geo', 'resample_curve');
    const result = resampleDef.evaluate(
      { mode: 'COUNT', count: 5, length: 1 },
      { 'Curve': line },
    );
    const resampled = result.outputs[0];
    assert.equal(resampled.curve.pointCount, 5);
  });

  it('sample_curve should return position/tangent/normal', () => {
    const lineDef = registry.getNodeDef('geo', 'curve_line');
    const line = lineDef.evaluate(
      { startX: 0, startY: 0, startZ: 0, endX: 10, endY: 0, endZ: 0 },
      {},
    ).outputs[0];

    const sampleDef = registry.getNodeDef('geo', 'sample_curve');
    const result = sampleDef.evaluate(
      { mode: 'FACTOR', factor: 0.5, length: 0 },
      { 'Curve': line },
    );
    const pos = result.outputs[0];
    assert.ok(pos, 'Position output should exist');
    assert.ok(Math.abs(pos.x - 5) < 0.1, `Expected x~5, got ${pos.x}`);
  });

  it('curve_to_mesh should produce mesh from curve + profile', () => {
    const lineDef = registry.getNodeDef('geo', 'curve_line');
    const line = lineDef.evaluate(
      { startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 5 },
      {},
    ).outputs[0];

    const circleDef = registry.getNodeDef('geo', 'curve_circle');
    const circle = circleDef.evaluate({ resolution: 8, radius: 0.5 }, {}).outputs[0];

    const resampleDef = registry.getNodeDef('geo', 'resample_curve');
    const resampledLine = resampleDef.evaluate(
      { mode: 'COUNT', count: 5, length: 1 },
      { 'Curve': line },
    ).outputs[0];

    const ctmDef = registry.getNodeDef('geo', 'curve_to_mesh');
    const result = ctmDef.evaluate(
      { fill_caps: false },
      { 'Curve': resampledLine, 'Profile Curve': circle },
    );
    const mesh = result.outputs[0];
    assert.ok(mesh instanceof GeometrySet);
    assert.ok(mesh.mesh, 'Should produce a mesh');
    assert.ok(mesh.mesh.vertexCount > 0, 'Mesh should have vertices');
    assert.ok(mesh.mesh.faceCount > 0, 'Mesh should have faces');
  });
});

describe('Full Graph Evaluation', () => {
  it('should evaluate Cube → Output pipeline', () => {
    const result = evaluateSimpleGraph({
      cube: { type: 'mesh_cube', values: { sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 } },
      output: {
        type: 'output',
        connections: [{ from: 'cube', fromSocket: 0, toSocket: 0 }],
      },
    });
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.ok(result.geometries.length > 0);
    assert.ok(result.geometries[0] instanceof GeometrySet);
  });

  it('should evaluate Cube → Transform → Output pipeline', () => {
    const result = evaluateSimpleGraph({
      cube: { type: 'mesh_cube', values: { sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 } },
      transform: {
        type: 'transform_geometry',
        values: { translateX: 3, translateY: 0, translateZ: 0, rotateX: 0, rotateY: 0, rotateZ: 0, scaleX: 2, scaleY: 2, scaleZ: 2 },
        connections: [{ from: 'cube', fromSocket: 0, toSocket: 0 }],
      },
      output: {
        type: 'output',
        connections: [{ from: 'transform', fromSocket: 0, toSocket: 0 }],
      },
    });
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.ok(result.geometries.length > 0);
    const geo = result.geometries[0];
    const avgX = geo.mesh.positions.reduce((s, p) => s + p.x, 0) / geo.mesh.vertexCount;
    assert.ok(Math.abs(avgX - 3) < 0.01);
  });

  it('should report error for graph without output node', () => {
    const graph = new NodeGraph('geo');
    graph.addNode('mesh_cube', 0, 0);
    const result = graph.evaluate();
    assert.ok(result.error);
  });
});
