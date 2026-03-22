/**
 * Integration tests for geometry nodes v2 - new point ops, rotation, curve attrs, graph clear.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../../core/registry.js';
import { NodeGraph } from '../../core/graph.js';
import { GeometrySet, MeshComponent, CurveComponent, DOMAIN, ATTR_TYPE } from '../../core/geometry.js';
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

/** Helper: create a simple curve GeometrySet with one POLY spline. */
function makeCurveGeo(positions) {
  const geo = new GeometrySet();
  const curve = new CurveComponent();
  curve.splines.push({
    type: 'POLY',
    positions: positions.map(p => ({ x: p.x, y: p.y, z: p.z })),
    handleLeft: null,
    handleRight: null,
    radii: new Array(positions.length).fill(1),
    tilts: new Array(positions.length).fill(0),
    cyclic: false,
    resolution: 12,
  });
  geo.curve = curve;
  return geo;
}

/** Helper: create a simple quad mesh GeometrySet. */
function makeQuadGeo() {
  const geo = new GeometrySet();
  const mesh = new MeshComponent();
  mesh.positions = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
  ];
  mesh.faceVertCounts = [4];
  mesh.cornerVerts = [0, 1, 2, 3];
  geo.mesh = mesh;
  return geo;
}

// ═══════════════════════════════════════════════════════════════════════════
// NODE REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

describe('New Node Registration', () => {
  it('should register point operation nodes', () => {
    assert.ok(registry.getNodeDef('geo', 'mesh_to_points'));
    assert.ok(registry.getNodeDef('geo', 'curve_to_points'));
    assert.ok(registry.getNodeDef('geo', 'distribute_points_on_faces'));
  });

  it('should register rotation nodes', () => {
    assert.ok(registry.getNodeDef('geo', 'align_euler_to_vector'));
  });

  it('should register curve attribute nodes', () => {
    assert.ok(registry.getNodeDef('geo', 'set_curve_radius'));
    assert.ok(registry.getNodeDef('geo', 'set_curve_tilt'));
  });

  it('should register group input node', () => {
    assert.ok(registry.getNodeDef('geo', 'group_input'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MESH TO POINTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Mesh to Points', () => {
  it('should convert cube vertices to points', () => {
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cubeResult = cubeDef.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {});
    const cubeGeo = cubeResult.outputs[0];

    const def = registry.getNodeDef('geo', 'mesh_to_points');
    const result = def.evaluate(
      { mode: 'VERTICES', radius: 0.05 },
      { 'Mesh': cubeGeo }
    );

    const geo = result.outputs[0];
    assert.ok(geo instanceof GeometrySet);
    assert.ok(geo.mesh);
    assert.equal(geo.mesh.vertexCount, 8);
    // Point cloud has no topology
    assert.equal(geo.mesh.edgeCount, 0);
    assert.equal(geo.mesh.faceCount, 0);
  });

  it('should convert face centers to points', () => {
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cubeGeo = cubeDef.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];

    const def = registry.getNodeDef('geo', 'mesh_to_points');
    const result = def.evaluate(
      { mode: 'FACES', radius: 0.05 },
      { 'Mesh': cubeGeo }
    );

    const geo = result.outputs[0];
    assert.ok(geo instanceof GeometrySet);
    assert.equal(geo.mesh.vertexCount, 6); // cube has 6 faces
  });

  it('should handle empty input gracefully', () => {
    const def = registry.getNodeDef('geo', 'mesh_to_points');
    const result = def.evaluate(
      { mode: 'VERTICES', radius: 0.05 },
      { 'Mesh': null }
    );
    assert.ok(result.outputs[0] instanceof GeometrySet);
  });

  it('should store radius attribute on output points', () => {
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cubeGeo = cubeDef.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];

    const def = registry.getNodeDef('geo', 'mesh_to_points');
    const result = def.evaluate(
      { mode: 'VERTICES', radius: 0.1 },
      { 'Mesh': cubeGeo }
    );

    const geo = result.outputs[0];
    const radiusData = geo.mesh.pointAttrs.get('radius');
    assert.ok(radiusData, 'Should have radius attribute');
    assert.equal(radiusData.length, 8);
    assert.ok(radiusData.every(r => Math.abs(r - 0.1) < 0.001));
  });

  it('should convert edge midpoints to points', () => {
    const cubeDef = registry.getNodeDef('geo', 'mesh_cube');
    const cubeGeo = cubeDef.evaluate({ sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];

    const def = registry.getNodeDef('geo', 'mesh_to_points');
    const result = def.evaluate(
      { mode: 'EDGES', radius: 0.05 },
      { 'Mesh': cubeGeo }
    );

    const geo = result.outputs[0];
    assert.ok(geo instanceof GeometrySet);
    // A cube has 12 edges
    assert.equal(geo.mesh.vertexCount, 12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CURVE TO POINTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Curve to Points', () => {
  it('should convert a curve to points with COUNT mode', () => {
    const curveGeo = makeCurveGeo([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);

    const def = registry.getNodeDef('geo', 'curve_to_points');
    const result = def.evaluate(
      { mode: 'COUNT', count: 5, length: 0.1 },
      { 'Curve': curveGeo }
    );

    const [points, tangent, normal, rotation] = result.outputs;
    assert.ok(points instanceof GeometrySet);
    assert.equal(points.mesh.vertexCount, 5);
  });

  it('should output tangent, normal, and rotation fields', () => {
    const curveGeo = makeCurveGeo([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);

    const def = registry.getNodeDef('geo', 'curve_to_points');
    const result = def.evaluate(
      { mode: 'COUNT', count: 3, length: 0.1 },
      { 'Curve': curveGeo }
    );

    const [points, tangent, normal, rotation] = result.outputs;
    assert.equal(points.mesh.vertexCount, 3);
    assert.ok(isField(tangent), 'Tangent should be a field');
    assert.ok(isField(normal), 'Normal should be a field');
    assert.ok(isField(rotation), 'Rotation should be a field');
  });

  it('should produce points spaced along the curve', () => {
    const curveGeo = makeCurveGeo([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]);

    const def = registry.getNodeDef('geo', 'curve_to_points');
    const result = def.evaluate(
      { mode: 'COUNT', count: 3, length: 0.1 },
      { 'Curve': curveGeo }
    );

    const positions = result.outputs[0].mesh.positions;
    // First point at start, last at end
    assert.ok(Math.abs(positions[0].x - 0) < 0.01);
    assert.ok(Math.abs(positions[2].x - 2) < 0.01);
    // Middle point at midpoint
    assert.ok(Math.abs(positions[1].x - 1) < 0.01);
  });

  it('should handle empty curve gracefully', () => {
    const def = registry.getNodeDef('geo', 'curve_to_points');
    const result = def.evaluate(
      { mode: 'COUNT', count: 5, length: 0.1 },
      { 'Curve': null }
    );
    assert.ok(result.outputs[0] instanceof GeometrySet);
  });

  it('should work with LENGTH mode', () => {
    const curveGeo = makeCurveGeo([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);

    const def = registry.getNodeDef('geo', 'curve_to_points');
    const result = def.evaluate(
      { mode: 'LENGTH', count: 10, length: 0.25 },
      { 'Curve': curveGeo }
    );

    const points = result.outputs[0];
    assert.ok(points.mesh.vertexCount >= 4, `Expected >= 4 points, got ${points.mesh.vertexCount}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DISTRIBUTE POINTS ON FACES
// ═══════════════════════════════════════════════════════════════════════════

describe('Distribute Points on Faces', () => {
  it('should distribute points on a grid in RANDOM mode', () => {
    const gridDef = registry.getNodeDef('geo', 'mesh_grid');
    const gridGeo = gridDef.evaluate({ sizeX: 2, sizeY: 2, verticesX: 3, verticesY: 3 }, {}).outputs[0];

    const def = registry.getNodeDef('geo', 'distribute_points_on_faces');
    const result = def.evaluate(
      { mode: 'RANDOM', density: 50, seed: 42, distanceMin: 0.1, densityMax: 10 },
      { 'Mesh': gridGeo }
    );

    const points = result.outputs[0];
    assert.ok(points instanceof GeometrySet);
    assert.ok(points.mesh);
    assert.ok(points.mesh.vertexCount > 50, `Expected many points, got ${points.mesh.vertexCount}`);
  });

  it('should produce deterministic results with same seed', () => {
    const gridDef = registry.getNodeDef('geo', 'mesh_grid');
    const gridGeo = gridDef.evaluate({ sizeX: 1, sizeY: 1, verticesX: 2, verticesY: 2 }, {}).outputs[0];

    const def = registry.getNodeDef('geo', 'distribute_points_on_faces');

    const r1 = def.evaluate({ mode: 'RANDOM', density: 20, seed: 123, distanceMin: 0.1, densityMax: 10 }, { 'Mesh': gridGeo });
    const r2 = def.evaluate({ mode: 'RANDOM', density: 20, seed: 123, distanceMin: 0.1, densityMax: 10 }, { 'Mesh': gridGeo });

    assert.equal(r1.outputs[0].mesh.vertexCount, r2.outputs[0].mesh.vertexCount);
  });

  it('should distribute points with POISSON mode', () => {
    const gridDef = registry.getNodeDef('geo', 'mesh_grid');
    const gridGeo = gridDef.evaluate({ sizeX: 2, sizeY: 2, verticesX: 3, verticesY: 3 }, {}).outputs[0];

    const def = registry.getNodeDef('geo', 'distribute_points_on_faces');
    const result = def.evaluate(
      { mode: 'POISSON', distanceMin: 0.2, densityMax: 100, seed: 7, density: 10 },
      { 'Mesh': gridGeo }
    );

    const points = result.outputs[0];
    assert.ok(points.mesh.vertexCount > 0, 'Should produce some points');

    // Verify minimum distance constraint
    const positions = points.mesh.positions;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dz = positions[i].z - positions[j].z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        assert.ok(dist >= 0.199, `Points ${i} and ${j} too close: ${dist}`);
      }
    }
  });

  it('should output normal and rotation fields', () => {
    const def = registry.getNodeDef('geo', 'distribute_points_on_faces');
    const geo = makeQuadGeo();

    const result = def.evaluate(
      { mode: 'RANDOM', density: 10, seed: 1, distanceMin: 0.1, densityMax: 10 },
      { 'Mesh': geo }
    );
    const [points, normal, rotation] = result.outputs;
    assert.ok(isField(normal) || typeof normal === 'object');
    assert.ok(isField(rotation) || typeof rotation === 'object');
  });

  it('should handle empty mesh gracefully', () => {
    const def = registry.getNodeDef('geo', 'distribute_points_on_faces');
    const result = def.evaluate(
      { mode: 'RANDOM', density: 10, seed: 0, distanceMin: 0.1, densityMax: 10 },
      { 'Mesh': null }
    );
    assert.ok(result.outputs[0] instanceof GeometrySet);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALIGN EULER TO VECTOR
// ═══════════════════════════════════════════════════════════════════════════

describe('Align Euler to Vector', () => {
  it('should align Z axis to a target vector', () => {
    const def = registry.getNodeDef('geo', 'align_euler_to_vector');
    const result = def.evaluate(
      { axis: 'Z', pivot: 'AUTO', factor: 1 },
      {
        'Rotation': { x: 0, y: 0, z: 0 },
        'Factor': 1,
        'Vector': { x: 0, y: 1, z: 0 },
      }
    );

    const rot = result.outputs[0];
    assert.ok(typeof rot.x === 'number');
    assert.ok(typeof rot.y === 'number');
    assert.ok(typeof rot.z === 'number');

    // After alignment, the local Z axis should point in the +Y direction
    // This means rotation around X by ~90 degrees (pi/2)
    assert.ok(Math.abs(rot.x - Math.PI / 2) < 0.01 || Math.abs(rot.x + Math.PI / 2) < 0.01,
      `Expected ~pi/2 rotation around X, got ${rot.x}`);
  });

  it('should respect factor=0 (no change)', () => {
    const def = registry.getNodeDef('geo', 'align_euler_to_vector');
    const inputRot = { x: 0.5, y: 0.3, z: 0.1 };
    const result = def.evaluate(
      { axis: 'Z', pivot: 'AUTO', factor: 0 },
      {
        'Rotation': inputRot,
        'Factor': 0,
        'Vector': { x: 1, y: 0, z: 0 },
      }
    );

    const rot = result.outputs[0];
    assert.ok(Math.abs(rot.x - inputRot.x) < 0.001);
    assert.ok(Math.abs(rot.y - inputRot.y) < 0.001);
    assert.ok(Math.abs(rot.z - inputRot.z) < 0.001);
  });

  it('should handle zero-length vector input', () => {
    const def = registry.getNodeDef('geo', 'align_euler_to_vector');
    const result = def.evaluate(
      { axis: 'Z', pivot: 'AUTO', factor: 1 },
      {
        'Rotation': { x: 0.5, y: 0.3, z: 0.1 },
        'Factor': 1,
        'Vector': { x: 0, y: 0, z: 0 },
      }
    );
    const rot = result.outputs[0];
    assert.ok(Math.abs(rot.x - 0.5) < 0.001);
  });

  it('should work with field inputs', () => {
    const def = registry.getNodeDef('geo', 'align_euler_to_vector');
    const vecField = new Field('vector', (el) => ({
      x: el.index === 0 ? 1 : 0,
      y: el.index === 0 ? 0 : 1,
      z: 0,
    }));

    const result = def.evaluate(
      { axis: 'Z', pivot: 'AUTO', factor: 1 },
      {
        'Rotation': { x: 0, y: 0, z: 0 },
        'Factor': 1,
        'Vector': vecField,
      }
    );

    assert.ok(isField(result.outputs[0]));
  });

  it('should support constrained pivot axis', () => {
    const def = registry.getNodeDef('geo', 'align_euler_to_vector');
    const result = def.evaluate(
      { axis: 'Z', pivot: 'X', factor: 1 },
      {
        'Rotation': { x: 0, y: 0, z: 0 },
        'Factor': 1,
        'Vector': { x: 0, y: 1, z: 1 },
      }
    );

    const rot = result.outputs[0];
    assert.ok(typeof rot.x === 'number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SET CURVE RADIUS
// ═══════════════════════════════════════════════════════════════════════════

describe('Set Curve Radius', () => {
  it('should set radius on curve control points', () => {
    const def = registry.getNodeDef('geo', 'set_curve_radius');
    const geo = makeCurveGeo([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]);

    const result = def.evaluate(
      { radius: 0.5 },
      { 'Curve': geo, 'Radius': 0.5 }
    );

    const outCurve = result.outputs[0].curve;
    assert.ok(outCurve);
    assert.ok(outCurve.splines[0].radii);
    assert.ok(outCurve.splines[0].radii.every(r => Math.abs(r - 0.5) < 0.001));
  });

  it('should not modify original geometry', () => {
    const def = registry.getNodeDef('geo', 'set_curve_radius');
    const geo = makeCurveGeo([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
    geo.curve.splines[0].radii = [1, 1];

    def.evaluate({ radius: 0.5 }, { 'Curve': geo, 'Radius': 0.5 });

    // Original should be unchanged
    assert.equal(geo.curve.splines[0].radii[0], 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SET CURVE TILT
// ═══════════════════════════════════════════════════════════════════════════

describe('Set Curve Tilt', () => {
  it('should set tilt on curve control points', () => {
    const def = registry.getNodeDef('geo', 'set_curve_tilt');
    const geo = makeCurveGeo([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);

    const result = def.evaluate(
      { tilt: Math.PI / 4 },
      { 'Curve': geo, 'Tilt': Math.PI / 4 }
    );

    const outCurve = result.outputs[0].curve;
    assert.ok(outCurve);
    assert.ok(outCurve.splines[0].tilts);
    assert.ok(outCurve.splines[0].tilts.every(t => Math.abs(t - Math.PI / 4) < 0.001));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GROUP INPUT
// ═══════════════════════════════════════════════════════════════════════════

describe('Group Input', () => {
  it('should output an empty GeometrySet', () => {
    const def = registry.getNodeDef('geo', 'group_input');
    const result = def.evaluate({}, {});
    assert.ok(result.outputs[0] instanceof GeometrySet);
  });

  it('should be singular', () => {
    const def = registry.getNodeDef('geo', 'group_input');
    assert.equal(def.singular, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GRAPH CLEAR
// ═══════════════════════════════════════════════════════════════════════════

describe('Graph clear()', () => {
  it('should clear all nodes and connections', () => {
    const graph = new NodeGraph('geo');
    graph.addNode('mesh_cube', 0, 0);
    graph.addNode('mesh_grid', 200, 0);
    assert.ok(graph.nodes.length >= 2);

    graph.clear(false);
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.connections.length, 0);
    assert.equal(graph.nextId, 1);
  });

  it('should re-add group_input and output nodes when addOutput=true', () => {
    const graph = new NodeGraph('geo');
    graph.addNode('mesh_cube', 0, 0);
    graph.clear(true);

    assert.equal(graph.nodes.length, 2);
    const types = graph.nodes.map(n => n.type).sort();
    assert.deepEqual(types, ['group_input', 'output']);
  });

  it('should re-add shader_output for shader graphs', () => {
    const shaderDef = registry.getNodeDef('shader', 'shader_output');
    if (!shaderDef) return; // Skip if shader nodes not registered

    const graph = new NodeGraph('shader');
    graph.clear(true);
    assert.equal(graph.nodes[0].type, 'shader_output');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FULL PIPELINE: Grid → Distribute Points → verify output
// ═══════════════════════════════════════════════════════════════════════════

describe('Full Pipeline: Point Distribution', () => {
  it('should distribute points on a grid and produce valid output', () => {
    // Build graph with integer socket indices
    const graph = new NodeGraph('geo');

    const grid = graph.addNode('mesh_grid', 0, 0);
    graph.setNodeValue(grid.id, 'sizeX', 2);
    graph.setNodeValue(grid.id, 'sizeY', 2);
    graph.setNodeValue(grid.id, 'verticesX', 3);
    graph.setNodeValue(grid.id, 'verticesY', 3);

    const dist = graph.addNode('distribute_points_on_faces', 200, 0);
    graph.setNodeValue(dist.id, 'mode', 'RANDOM');
    graph.setNodeValue(dist.id, 'density', 10);
    graph.setNodeValue(dist.id, 'seed', 42);

    const output = graph.addNode('output', 400, 0);

    // Connect grid output 0 (Mesh) → dist input 0 (Mesh)
    graph.addConnection(grid.id, 0, dist.id, 0);
    // Connect dist output 0 (Points) → output input 0 (Geometry)
    graph.addConnection(dist.id, 0, output.id, 0);

    const result = graph.evaluate();
    assert.ok(result.geometries.length > 0, 'Should produce geometry');
    const geo = result.geometries[0];
    assert.ok(geo.mesh, 'Should have mesh component');
    assert.ok(geo.mesh.vertexCount > 0, `Should have points, got ${geo.mesh.vertexCount}`);
  });

  it('should pipe curve_line → curve_to_points through graph', () => {
    const graph = new NodeGraph('geo');

    const line = graph.addNode('curve_line', 0, 0);
    const c2p = graph.addNode('curve_to_points', 200, 0);
    graph.setNodeValue(c2p.id, 'mode', 'COUNT');
    graph.setNodeValue(c2p.id, 'count', 5);
    const output = graph.addNode('output', 400, 0);

    // curve_line output 0 (Curve) → curve_to_points input 0 (Curve)
    graph.addConnection(line.id, 0, c2p.id, 0);
    // curve_to_points output 0 (Points) → output input 0 (Geometry)
    graph.addConnection(c2p.id, 0, output.id, 0);

    const result = graph.evaluate();
    assert.ok(result.geometries.length > 0);
    assert.equal(result.geometries[0].mesh.vertexCount, 5);
  });
});
