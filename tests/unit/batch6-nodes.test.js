/**
 * Unit tests for batch 6 nodes.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry } from '../../core/registry.js';
import { GeometrySet, MeshComponent, CurveComponent } from '../../core/geometry.js';
import { Field } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';
import { registerCurveNodes } from '../../geo/nodes_v2_curves.js';
import { registerMeshOpNodes } from '../../geo/nodes_v2_mesh_ops.js';
import { registerUtilityNodes } from '../../geo/nodes_v2_utilities.js';
import { registerSamplingNodes } from '../../geo/nodes_v2_sampling.js';
import { registerPointOpNodes } from '../../geo/nodes_v2_point_ops.js';
import { registerMeshReadNodes } from '../../geo/nodes_v2_mesh_read.js';

before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerFieldNodes(registry);
  registerCurveNodes(registry);
  registerMeshOpNodes(registry);
  registerUtilityNodes(registry);
  registerSamplingNodes(registry);
  registerPointOpNodes(registry);
  registerMeshReadNodes(registry);
});

// ── Mesh Read ────────────────────────────────────────────────────────────

describe('Edge Vertices', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'edge_vertices')); });
  it('should return 4 field outputs', () => {
    const result = registry.getNodeDef('geo', 'edge_vertices').evaluate({}, {});
    assert.equal(result.outputs.length, 4);
    for (const out of result.outputs) assert.ok(out instanceof Field);
  });
});

describe('Convex Hull', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'convex_hull')); });

  it('should compute hull for a set of points', () => {
    const def = registry.getNodeDef('geo', 'convex_hull');
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 },
      { x: 0.5, y: 0.5, z: 0 }, // interior point
    ];
    const result = def.evaluate({}, { 'Geometry': geo });
    assert.ok(result.outputs[0].mesh);
    // Interior point should be excluded from hull
    assert.ok(result.outputs[0].mesh.vertexCount <= 4, 'hull should have at most 4 points');
    assert.ok(result.outputs[0].mesh.vertexCount >= 3, 'hull should have at least 3 points');
  });
});

describe('Set ID', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'set_id')); });
});

// ── Curve Primitives ─────────────────────────────────────────────────────

describe('Curve Quadrilateral', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'curve_quadrilateral')); });

  it('should create a rectangle', () => {
    const def = registry.getNodeDef('geo', 'curve_quadrilateral');
    const result = def.evaluate(
      { width: 2, height: 1, mode: 'RECTANGLE' },
      { 'Width': 2, 'Height': 1, 'Offset': 0 }
    );
    assert.ok(result.outputs[0].curve);
    assert.equal(result.outputs[0].curve.splines[0].positions.length, 4);
    assert.equal(result.outputs[0].curve.splines[0].cyclic, true);
  });

  it('should support parallelogram mode', () => {
    const def = registry.getNodeDef('geo', 'curve_quadrilateral');
    const result = def.evaluate(
      { width: 2, height: 1, offset: 0.5, mode: 'PARALLELOGRAM' },
      { 'Width': 2, 'Height': 1, 'Offset': 0.5 }
    );
    assert.equal(result.outputs[0].curve.splines[0].positions.length, 4);
  });
});

describe('Curve Star', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'curve_star')); });

  it('should create star with alternating inner/outer points', () => {
    const def = registry.getNodeDef('geo', 'curve_star');
    const result = def.evaluate(
      { points: 5, inner_radius: 1, outer_radius: 2, twist: 0 },
      { 'Points': 5, 'Inner Radius': 1, 'Outer Radius': 2, 'Twist': 0 }
    );
    assert.ok(result.outputs[0].curve);
    // 5 points * 2 (inner + outer) = 10
    assert.equal(result.outputs[0].curve.splines[0].positions.length, 10);
    // Outer Points field
    assert.ok(result.outputs[1] instanceof Field);
    assert.equal(result.outputs[1].evaluateAt({ index: 0 }), true); // outer
    assert.equal(result.outputs[1].evaluateAt({ index: 1 }), false); // inner
  });
});

// ── Curve Topology ───────────────────────────────────────────────────────

describe('Handle Type Selection', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'handle_type_selection')); });
});

describe('Set Handle Positions', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'set_handle_positions')); });
});

describe('Curve of Point', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'curve_of_point')); });
  it('should return curve index and local index fields', () => {
    const result = registry.getNodeDef('geo', 'curve_of_point').evaluate({}, { 'Point Index': 0 });
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Offset Point in Curve', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'offset_point_in_curve')); });
  it('should check validity of offset', () => {
    const result = registry.getNodeDef('geo', 'offset_point_in_curve').evaluate(
      {}, { 'Point Index': null, 'Offset': 1 }
    );
    const isValid = result.outputs[0];
    assert.ok(isValid instanceof Field);
    // At index 0 with count 5, offset 1 should be valid
    assert.equal(isValid.evaluateAt({ index: 0, count: 5, localIndex: 0, localCount: 5 }), true);
    // At index 4 with count 5, offset 1 should be invalid
    assert.equal(isValid.evaluateAt({ index: 4, count: 5, localIndex: 4, localCount: 5 }), false);
  });
});

describe('Points to Curves', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'points_to_curves')); });
  it('should convert points to a curve', () => {
    const def = registry.getNodeDef('geo', 'points_to_curves');
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
    ];
    const result = def.evaluate({}, { 'Points': geo, 'Curve Group ID': null, 'Weight': null });
    assert.ok(result.outputs[0].curve);
    assert.equal(result.outputs[0].curve.splines[0].positions.length, 3);
  });
});
