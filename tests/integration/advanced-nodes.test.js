/**
 * Integration tests for previously untested node behaviors and edge cases.
 *
 * Covers: vector_math, delete_geometry, instance+realize pipelines,
 * compare, map_range interpolation modes, cycle detection, dynamic node defs.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../../core/registry.js';
import { NodeGraph } from '../../core/graph.js';
import { GeometrySet, MeshComponent, CurveComponent, DOMAIN } from '../../core/geometry.js';
import { Field, isField } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerCurveNodes } from '../../geo/nodes_v2_curves.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';
import { registerPointOpNodes } from '../../geo/nodes_v2_point_ops.js';
import { registerRotationNodes } from '../../geo/nodes_v2_rotation.js';

before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerCurveNodes(registry);
  registerFieldNodes(registry);
  registerPointOpNodes(registry);
  registerRotationNodes(registry);
});

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR MATH NODE
// ═══════════════════════════════════════════════════════════════════════════

describe('Vector Math Node', () => {
  function evalVecMath(op, a, b) {
    const def = registry.getNodeDef('geo', 'vector_math');
    return def.evaluate(
      { operation: op },
      { 'Vector': a, 'Vector2': b }
    );
  }

  it('ADD should add vectors component-wise', () => {
    const r = evalVecMath('ADD', { x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    assert.deepEqual(r.outputs[0], { x: 5, y: 7, z: 9 });
  });

  it('SUBTRACT should subtract vectors', () => {
    const r = evalVecMath('SUBTRACT', { x: 5, y: 7, z: 9 }, { x: 4, y: 5, z: 6 });
    assert.deepEqual(r.outputs[0], { x: 1, y: 2, z: 3 });
  });

  it('CROSS should compute cross product', () => {
    const r = evalVecMath('CROSS', { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    assert.deepEqual(r.outputs[0], { x: 0, y: 0, z: 1 });
  });

  it('DOT should return scalar in Value output', () => {
    const r = evalVecMath('DOT', { x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    assert.equal(r.outputs[1], 32); // dot product
  });

  it('LENGTH should return vector length in Value output', () => {
    const r = evalVecMath('LENGTH', { x: 3, y: 4, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.equal(r.outputs[1], 5);
  });

  it('NORMALIZE should return unit vector', () => {
    const r = evalVecMath('NORMALIZE', { x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(r.outputs[0].x - 1) < 1e-10);
    assert.ok(Math.abs(r.outputs[0].y) < 1e-10);
  });

  it('DISTANCE should return distance in Value output', () => {
    const r = evalVecMath('DISTANCE', { x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
    assert.equal(r.outputs[1], 5);
  });

  it('should return Field outputs when input is a Field', () => {
    const posField = new Field('vector', (el) => ({
      x: el.index, y: 0, z: 0,
    }));
    const def = registry.getNodeDef('geo', 'vector_math');
    const r = def.evaluate(
      { operation: 'ADD' },
      { 'Vector': posField, 'Vector2': { x: 10, y: 0, z: 0 } }
    );
    assert.ok(isField(r.outputs[0]));
    const val = r.outputs[0].evaluateAt({ index: 5, count: 10, position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } });
    assert.equal(val.x, 15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPARE NODE
// ═══════════════════════════════════════════════════════════════════════════

describe('Compare Node', () => {
  function evalCompare(op, a, b, threshold = 0.001) {
    const def = registry.getNodeDef('geo', 'compare');
    return def.evaluate(
      { operation: op, threshold, a: 0, b: 0 },
      { 'A': a, 'B': b }
    ).outputs[0];
  }

  it('LESS_THAN should return true when a < b', () => {
    assert.equal(evalCompare('LESS_THAN', 1, 2), true);
    assert.equal(evalCompare('LESS_THAN', 2, 1), false);
  });

  it('GREATER_THAN should return true when a > b', () => {
    assert.equal(evalCompare('GREATER_THAN', 2, 1), true);
    assert.equal(evalCompare('GREATER_THAN', 1, 2), false);
  });

  it('LESS_EQUAL should handle equality', () => {
    assert.equal(evalCompare('LESS_EQUAL', 2, 2), true);
    assert.equal(evalCompare('LESS_EQUAL', 1, 2), true);
    assert.equal(evalCompare('LESS_EQUAL', 3, 2), false);
  });

  it('GREATER_EQUAL should handle equality', () => {
    assert.equal(evalCompare('GREATER_EQUAL', 2, 2), true);
    assert.equal(evalCompare('GREATER_EQUAL', 3, 2), true);
  });

  it('EQUAL should use threshold', () => {
    assert.equal(evalCompare('EQUAL', 1.0, 1.0005, 0.001), true);
    assert.equal(evalCompare('EQUAL', 1.0, 1.1, 0.001), false);
  });

  it('NOT_EQUAL should be inverse of EQUAL', () => {
    assert.equal(evalCompare('NOT_EQUAL', 1.0, 2.0, 0.001), true);
    assert.equal(evalCompare('NOT_EQUAL', 1.0, 1.0005, 0.001), false);
  });

  it('should return Field when inputs are Fields', () => {
    const indexField = new Field('int', (el) => el.index);
    const result = registry.getNodeDef('geo', 'compare').evaluate(
      { operation: 'LESS_THAN', threshold: 0.001, a: 0, b: 0 },
      { 'A': indexField, 'B': 5 }
    ).outputs[0];
    assert.ok(isField(result));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MAP RANGE INTERPOLATION MODES
// ═══════════════════════════════════════════════════════════════════════════

describe('Map Range Interpolation Modes', () => {
  function evalMapRange(value, interp) {
    const def = registry.getNodeDef('geo', 'map_range');
    return def.evaluate({
      interpolation: interp,
      clamp: false,
      fromMin: 0, fromMax: 1, toMin: 0, toMax: 100,
    }, { 'Value': value }).outputs[0];
  }

  it('LINEAR should map linearly', () => {
    assert.equal(evalMapRange(0.5, 'LINEAR'), 50);
    assert.equal(evalMapRange(0, 'LINEAR'), 0);
    assert.equal(evalMapRange(1, 'LINEAR'), 100);
  });

  it('SMOOTH should apply smoothstep', () => {
    const v = evalMapRange(0.5, 'SMOOTH');
    assert.ok(v >= 49 && v <= 51, `Expected ~50, got ${v}`);
    // Endpoints should be exact
    assert.equal(evalMapRange(0, 'SMOOTH'), 0);
    assert.equal(evalMapRange(1, 'SMOOTH'), 100);
  });

  it('SMOOTHER should apply smootherstep', () => {
    const v = evalMapRange(0.5, 'SMOOTHER');
    assert.ok(v >= 49 && v <= 51, `Expected ~50, got ${v}`);
  });

  it('STEPPED should quantize output', () => {
    const v = evalMapRange(0.3, 'STEPPED');
    // 0.3 * 4 = 1.2, floor = 1, 1/4 = 0.25, * 100 = 25
    assert.equal(v, 25);
  });

  it('should clamp when enabled', () => {
    const def = registry.getNodeDef('geo', 'map_range');
    const r = def.evaluate({
      interpolation: 'LINEAR',
      clamp: true,
      fromMin: 0, fromMax: 1, toMin: 0, toMax: 100,
    }, { 'Value': 1.5 }).outputs[0];
    assert.equal(r, 100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE GEOMETRY - MULTIPLE DOMAINS
// ═══════════════════════════════════════════════════════════════════════════

describe('Delete Geometry - Domain Tests', () => {
  function makeCube() {
    const def = registry.getNodeDef('geo', 'mesh_cube');
    return def.evaluate(
      { sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 },
      {}
    ).outputs[0];
  }

  it('should delete selected vertices (POINT domain)', () => {
    const cube = makeCube();
    const origCount = cube.mesh.vertexCount;

    // Delete vertices where index < 4 (first half)
    const selField = new Field('bool', (el) => el.index < 4);
    const def = registry.getNodeDef('geo', 'delete_geometry');
    const result = def.evaluate(
      { domain: 'POINT', mode: 'all' },
      { 'Geometry': cube, 'Selection': selField }
    ).outputs[0];

    assert.ok(result.mesh.vertexCount < origCount);
    assert.equal(result.mesh.vertexCount, origCount - 4);
  });

  it('should delete selected faces (FACE domain)', () => {
    const cube = makeCube();
    const origFaces = cube.mesh.faceCount;

    // Delete first 3 faces
    const selField = new Field('bool', (el) => el.index < 3);
    const def = registry.getNodeDef('geo', 'delete_geometry');
    const result = def.evaluate(
      { domain: 'FACE', mode: 'all' },
      { 'Geometry': cube, 'Selection': selField }
    ).outputs[0];

    assert.equal(result.mesh.faceCount, origFaces - 3);
    // Vertices should remain (only faces removed)
    assert.equal(result.mesh.vertexCount, cube.mesh.vertexCount);
  });

  it('should delete selected edges (EDGE domain)', () => {
    const cube = makeCube();
    const origEdges = cube.mesh.edgeCount;

    const selField = new Field('bool', (el) => el.index < 3);
    const def = registry.getNodeDef('geo', 'delete_geometry');
    const result = def.evaluate(
      { domain: 'EDGE', mode: 'all' },
      { 'Geometry': cube, 'Selection': selField }
    ).outputs[0];

    assert.equal(result.mesh.edgeCount, origEdges - 3);
  });

  it('mode "all_but_selected" should keep only selected elements', () => {
    const cube = makeCube();
    const origCount = cube.mesh.vertexCount;

    const selField = new Field('bool', (el) => el.index < 2);
    const def = registry.getNodeDef('geo', 'delete_geometry');
    const result = def.evaluate(
      { domain: 'POINT', mode: 'all_but_selected' },
      { 'Geometry': cube, 'Selection': selField }
    ).outputs[0];

    assert.equal(result.mesh.vertexCount, 2);
  });

  it('should return unchanged geometry when no selection provided', () => {
    const cube = makeCube();
    const def = registry.getNodeDef('geo', 'delete_geometry');
    const result = def.evaluate(
      { domain: 'POINT', mode: 'all' },
      { 'Geometry': cube }
    ).outputs[0];

    assert.equal(result.mesh.vertexCount, cube.mesh.vertexCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE ON POINTS + REALIZE INSTANCES PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

describe('Instance on Points + Realize Instances', () => {
  it('should create instances at point positions', () => {
    // Create a point cloud (mesh with just positions)
    const points = new GeometrySet();
    const pointMesh = new MeshComponent();
    pointMesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ];
    points.mesh = pointMesh;

    // Create a small cube as instance
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cube = cubeDef.evaluate(
      { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, verticesX: 2, verticesY: 2, verticesZ: 2 },
      {}
    ).outputs[0];

    const instDef = registry.getNodeDef('geo', 'instance_on_points');
    const result = instDef.evaluate(
      {},
      { 'Points': points, 'Instance': cube }
    ).outputs[0];

    assert.ok(result.instances);
    assert.equal(result.instances.instanceCount, 3);
  });

  it('should respect selection on instance_on_points', () => {
    const points = new GeometrySet();
    const pointMesh = new MeshComponent();
    pointMesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ];
    points.mesh = pointMesh;

    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cube = cubeDef.evaluate(
      { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5, verticesX: 2, verticesY: 2, verticesZ: 2 },
      {}
    ).outputs[0];

    // Only select first and third point
    const sel = new Field('bool', (el) => el.index !== 1);

    const instDef = registry.getNodeDef('geo', 'instance_on_points');
    const result = instDef.evaluate(
      {},
      { 'Points': points, 'Instance': cube, 'Selection': sel }
    ).outputs[0];

    assert.equal(result.instances.instanceCount, 2);
  });

  it('realize_instances should convert instances to real geometry', () => {
    const points = new GeometrySet();
    const pointMesh = new MeshComponent();
    pointMesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ];
    points.mesh = pointMesh;

    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cube = cubeDef.evaluate(
      { sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 },
      {}
    ).outputs[0];

    const instDef = registry.getNodeDef('geo', 'instance_on_points');
    const instResult = instDef.evaluate(
      {},
      { 'Points': points, 'Instance': cube }
    ).outputs[0];

    const realizeDef = registry.getNodeDef('geo', 'realize_instances');
    const result = realizeDef.evaluate({}, { 'Geometry': instResult }).outputs[0];

    assert.ok(result.mesh);
    // 2 instances * 8 vertices = 16 vertices
    assert.equal(result.mesh.vertexCount, 16);
    assert.ok(result.mesh.faceCount > 0);
    // Instances should be cleared
    assert.ok(!result.instances || result.instances.instanceCount === 0);
  });

  it('realize_instances with no instances should return copy', () => {
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cube = cubeDef.evaluate(
      { sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 },
      {}
    ).outputs[0];

    const realizeDef = registry.getNodeDef('geo', 'realize_instances');
    const result = realizeDef.evaluate({}, { 'Geometry': cube }).outputs[0];
    assert.equal(result.mesh.vertexCount, cube.mesh.vertexCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CYCLE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Cycle Detection in Graph Evaluation', () => {
  it('should detect and report cycles without crashing', () => {
    const graph = new NodeGraph('geo');
    const add1 = graph.addNode('math', 0, 0);
    const add2 = graph.addNode('math', 200, 0);
    const output = graph.addNode('output', 400, 0);

    // Create cycle: add1 → add2 → add1
    graph.connections.push(
      { fromNode: add1.id, fromSocket: 0, toNode: add2.id, toSocket: 0 },
      { fromNode: add2.id, fromSocket: 0, toNode: add1.id, toSocket: 0 },
      { fromNode: add2.id, fromSocket: 0, toNode: output.id, toSocket: 0 }
    );

    const result = graph.evaluate();
    assert.ok(result.error, 'Should report cycle error');
    assert.ok(result.error.includes('Cycle'), `Error should mention cycle: ${result.error}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC NODE DEFINITIONS (getInputs/getOutputs)
// ═══════════════════════════════════════════════════════════════════════════

describe('Dynamic Node Definitions', () => {
  it('graph.getNodeDef should resolve dynamic inputs for random_value', () => {
    const graph = new NodeGraph('geo');
    const node = graph.addNode('random_value', 0, 0);
    graph.setNodeValue(node.id, 'data_type', 'BOOLEAN');

    const def = graph.getNodeDef(node);
    assert.ok(def);
    // BOOLEAN mode should have Probability input, not Min/Max
    const inputNames = def.inputs.map(i => i.name);
    assert.ok(inputNames.includes('Probability'), `Expected Probability input, got: ${inputNames}`);
    assert.ok(!inputNames.includes('Min'), `Should not have Min input for BOOLEAN mode`);
  });

  it('graph.getNodeDef should resolve dynamic outputs for random_value', () => {
    const graph = new NodeGraph('geo');
    const node = graph.addNode('random_value', 0, 0);
    graph.setNodeValue(node.id, 'data_type', 'FLOAT_VECTOR');

    const def = graph.getNodeDef(node);
    assert.equal(def.outputs[0].type, 'vector');
  });

  it('evaluate should use dynamic definitions for input resolution', () => {
    const graph = new NodeGraph('geo');
    const rv = graph.addNode('random_value', 0, 0);
    graph.setNodeValue(rv.id, 'data_type', 'FLOAT');
    graph.setNodeValue(rv.id, 'min', 0);
    graph.setNodeValue(rv.id, 'max', 1);
    graph.setNodeValue(rv.id, 'seed', 42);

    const output = graph.addNode('output', 200, 0);

    // This tests that evaluate() properly resolves the random_value node
    // even though it has dynamic inputs
    const result = graph.evaluate();
    // No error should occur from dynamic definition resolution
    assert.ok(!result.error || !result.error.includes('No evaluator'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MATH NODE - ADDITIONAL OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Math Node - Extended Operations', () => {
  function evalMath(op, a, b = 0, c = 0) {
    const def = registry.getNodeDef('geo', 'math');
    return def.evaluate(
      { operation: op, clampResult: false, value: a, value2: b, value3: c },
      {}
    ).outputs[0];
  }

  it('SINE should compute sin', () => {
    assert.ok(Math.abs(evalMath('SINE', Math.PI / 2) - 1) < 1e-10);
  });

  it('COSINE should compute cos', () => {
    assert.ok(Math.abs(evalMath('COSINE', 0) - 1) < 1e-10);
  });

  it('POWER should compute exponentiation', () => {
    assert.equal(evalMath('POWER', 2, 3), 8);
  });

  it('SQRT should compute square root', () => {
    assert.equal(evalMath('SQRT', 9), 3);
  });

  it('SQRT of negative should return 0', () => {
    assert.equal(evalMath('SQRT', -1), 0);
  });

  it('ABSOLUTE should return absolute value', () => {
    assert.equal(evalMath('ABSOLUTE', -5), 5);
  });

  it('FRACT should return fractional part', () => {
    assert.ok(Math.abs(evalMath('FRACT', 3.7) - 0.7) < 1e-10);
  });

  it('MODULO should compute positive modulo', () => {
    assert.equal(evalMath('MODULO', 7, 3), 1);
    // Negative modulo should be positive (Blender convention)
    assert.ok(evalMath('MODULO', -1, 3) > 0);
  });

  it('DIVIDE by zero should return 0', () => {
    assert.equal(evalMath('DIVIDE', 5, 0), 0);
  });

  it('MULTIPLY_ADD should compute a * b + c', () => {
    assert.equal(evalMath('MULTIPLY_ADD', 3, 4, 5), 17);
  });

  it('RADIANS should convert degrees to radians', () => {
    assert.ok(Math.abs(evalMath('RADIANS', 180) - Math.PI) < 1e-10);
  });

  it('DEGREES should convert radians to degrees', () => {
    assert.ok(Math.abs(evalMath('DEGREES', Math.PI) - 180) < 1e-10);
  });

  it('COMPARE should check approximate equality', () => {
    assert.equal(evalMath('COMPARE', 1.0, 1.0, 0.01), 1);
    assert.equal(evalMath('COMPARE', 1.0, 2.0, 0.01), 0);
  });

  it('SNAP should snap to increment', () => {
    assert.equal(evalMath('SNAP', 3.7, 1), 3);
    assert.equal(evalMath('SNAP', 3.7, 0.5), 3.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLAMP NODE
// ═══════════════════════════════════════════════════════════════════════════

describe('Clamp Node', () => {
  it('RANGE mode should auto-swap min/max', () => {
    const def = registry.getNodeDef('geo', 'clamp');
    // Pass min > max, RANGE mode should handle it
    const r = def.evaluate(
      { clampType: 'RANGE', min: 10, max: 0 },
      { 'Value': 5 }
    ).outputs[0];
    assert.equal(r, 5); // 5 is within [0, 10] after swap
  });

  it('MINMAX mode should not swap', () => {
    const def = registry.getNodeDef('geo', 'clamp');
    const r = def.evaluate(
      { clampType: 'MINMAX', min: 10, max: 0 },
      { 'Value': 5 }
    ).outputs[0];
    // With min=10, max=0, MINMAX does max(10, min(0, 5)) = max(10, 0) = 10
    assert.equal(r, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FULL PIPELINE: Instance on Points through Graph
// ═══════════════════════════════════════════════════════════════════════════

describe('Full Pipeline: Instance on Points', () => {
  it('should evaluate grid → mesh_to_points → instance_on_points → output', () => {
    const graph = new NodeGraph('geo');

    const grid = graph.addNode('mesh_grid', 0, 0);
    graph.setNodeValue(grid.id, 'sizeX', 1);
    graph.setNodeValue(grid.id, 'sizeY', 1);
    graph.setNodeValue(grid.id, 'verticesX', 3);
    graph.setNodeValue(grid.id, 'verticesY', 3);

    const m2p = graph.addNode('mesh_to_points', 200, 0);
    const cube = graph.addNode('mesh_cube', 200, 200);
    graph.setNodeValue(cube.id, 'sizeX', 0.1);
    graph.setNodeValue(cube.id, 'sizeY', 0.1);
    graph.setNodeValue(cube.id, 'sizeZ', 0.1);

    const inst = graph.addNode('instance_on_points', 400, 0);
    const realize = graph.addNode('realize_instances', 600, 0);
    const output = graph.addNode('output', 800, 0);

    // grid → mesh_to_points
    graph.addConnection(grid.id, 0, m2p.id, 0);
    // mesh_to_points → instance_on_points (Points)
    graph.addConnection(m2p.id, 0, inst.id, 0);
    // cube → instance_on_points (Instance)
    graph.addConnection(cube.id, 0, inst.id, 1);
    // instance_on_points → realize_instances
    graph.addConnection(inst.id, 0, realize.id, 0);
    // realize → output
    graph.addConnection(realize.id, 0, output.id, 0);

    const result = graph.evaluate();
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.ok(result.geometries.length > 0);
    const geo = result.geometries[0];
    assert.ok(geo.mesh);
    // 9 grid points * 8 cube vertices = 72
    assert.equal(geo.mesh.vertexCount, 72);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BEZIER SEGMENT NODE
// ═══════════════════════════════════════════════════════════════════════════

describe('Bezier Segment Node', () => {
  it('should create a curve from bezier control points', () => {
    const def = registry.getNodeDef('geo', 'bezier_segment');
    assert.ok(def, 'bezier_segment should be registered');

    const result = def.evaluate(
      {
        mode: 'POSITION', resolution: 8,
        startX: -1, startY: 0, startZ: 0,
        startHandleX: -0.5, startHandleY: 0.5, startHandleZ: 0,
        endHandleX: 0.5, endHandleY: 0.5, endHandleZ: 0,
        endX: 1, endY: 0, endZ: 0,
      },
      {}
    );

    const gs = result.outputs[0];
    assert.ok(gs instanceof GeometrySet);
    assert.ok(gs.curve);
    assert.equal(gs.curve.splineCount, 1);
    assert.equal(gs.curve.pointCount, 8);
    // Start point should be at (-1, 0, 0)
    assert.ok(Math.abs(gs.curve.splines[0].positions[0].x - (-1)) < 0.01);
    // End point should be at (1, 0, 0)
    assert.ok(Math.abs(gs.curve.splines[0].positions[7].x - 1) < 0.01);
  });

  it('should handle OFFSET mode', () => {
    const def = registry.getNodeDef('geo', 'bezier_segment');
    const result = def.evaluate(
      {
        mode: 'OFFSET', resolution: 4,
        startX: 0, startY: 0, startZ: 0,
        startHandleX: 0.5, startHandleY: 0.5, startHandleZ: 0,
        endHandleX: -0.5, endHandleY: 0.5, endHandleZ: 0,
        endX: 2, endY: 0, endZ: 0,
      },
      {}
    );
    const gs = result.outputs[0];
    assert.equal(gs.curve.pointCount, 4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CORNER ATTRS FILTERING IN FACE DELETION
// ═══════════════════════════════════════════════════════════════════════════

describe('Delete Geometry - Corner Attribute Integrity', () => {
  it('should filter cornerAttrs when faces are deleted', () => {
    const geo = new GeometrySet();
    const mesh = new MeshComponent();
    mesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 1, z: 0 },
    ];
    mesh.faceVertCounts = [3, 3];
    mesh.cornerVerts = [0, 1, 2, 3, 4, 5];
    // Add per-corner UV data
    mesh.cornerAttrs.set('uv_map', 'FLOAT2', [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 },
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    ]);
    geo.mesh = mesh;

    // Delete first face (index 0)
    const selField = new Field('bool', (el) => el.index === 0);
    const def = registry.getNodeDef('geo', 'delete_geometry');
    const result = def.evaluate(
      { domain: 'FACE', mode: 'all' },
      { 'Geometry': geo, 'Selection': selField }
    ).outputs[0];

    // Should have 1 face left
    assert.equal(result.mesh.faceCount, 1);
    assert.equal(result.mesh.cornerVerts.length, 3);

    // Corner attrs should match corner count
    const uvData = result.mesh.cornerAttrs.get('uv_map');
    assert.ok(uvData, 'Corner attrs should exist after face deletion');
    assert.equal(uvData.length, 3, 'Corner attrs should match remaining corner count');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ATTRIBUTE PRESERVATION IN JOIN GEOMETRY
// ═══════════════════════════════════════════════════════════════════════════

describe('Join Geometry - Attribute Preservation', () => {
  it('should preserve attributes when joining geometries with different attrs', () => {
    // Geo 1 has 'weight' attribute
    const geo1 = new GeometrySet();
    const mesh1 = new MeshComponent();
    mesh1.positions = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
    mesh1.pointAttrs.set('weight', 'FLOAT', [0.5, 1.0]);
    geo1.mesh = mesh1;

    // Geo 2 has 'color' attribute but no 'weight'
    const geo2 = new GeometrySet();
    const mesh2 = new MeshComponent();
    mesh2.positions = [{ x: 2, y: 0, z: 0 }];
    mesh2.pointAttrs.set('color', 'FLOAT_VECTOR', [{ x: 1, y: 0, z: 0 }]);
    geo2.mesh = mesh2;

    const joinDef = registry.getNodeDef('geo', 'join_geometry');
    const result = joinDef.evaluate(
      {},
      { 'Geometry 1': geo1, 'Geometry 2': geo2 }
    ).outputs[0];

    assert.equal(result.mesh.vertexCount, 3);

    // 'weight' should have 3 values: [0.5, 1.0, 0] (default for geo2's element)
    const weights = result.mesh.pointAttrs.get('weight');
    assert.ok(weights, 'weight attribute should exist');
    assert.equal(weights.length, 3);
    assert.equal(weights[0], 0.5);
    assert.equal(weights[1], 1.0);
    assert.equal(weights[2], 0); // default

    // 'color' should have 3 values: [default, default, {1,0,0}]
    const colors = result.mesh.pointAttrs.get('color');
    assert.ok(colors, 'color attribute should exist');
    assert.equal(colors.length, 3);
  });
});
