/**
 * Unit tests for batch 9 (final gap-filling nodes).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry } from '../../core/registry.js';
import { GeometrySet, MeshComponent, CurveComponent, createMeshCube } from '../../core/geometry.js';
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

// ── Rotation Conversions ─────────────────────────────────────────────────

describe('Rotation to Euler', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'rotation_to_euler')); });
  it('should pass through rotation as euler', () => {
    const result = registry.getNodeDef('geo', 'rotation_to_euler').evaluate({}, {
      'Rotation': { x: 1, y: 2, z: 3 },
    });
    assert.deepEqual(result.outputs[0], { x: 1, y: 2, z: 3 });
  });
});

describe('Rotation to Axis Angle', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'rotation_to_axis_angle')); });
  it('should decompose rotation', () => {
    const result = registry.getNodeDef('geo', 'rotation_to_axis_angle').evaluate({}, {
      'Rotation': { x: 0, y: 0, z: Math.PI },
    });
    const axis = result.outputs[0];
    const angle = result.outputs[1];
    assert.ok(Math.abs(axis.z - 1) < 0.01, 'axis should be Z');
    assert.ok(Math.abs(angle - Math.PI) < 0.01, 'angle should be PI');
  });
});

// ── Scene/Context Nodes ──────────────────────────────────────────────────

describe('Curve Tilt (input)', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'curve_tilt')); });
  it('should return float field', () => {
    const result = registry.getNodeDef('geo', 'curve_tilt').evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
  });
});

describe('Is Viewport', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'is_viewport')); });
  it('should return true in browser context', () => {
    const result = registry.getNodeDef('geo', 'is_viewport').evaluate({}, {});
    assert.equal(result.outputs[0], true);
  });
});

// ── Geometry Operations ──────────────────────────────────────────────────

describe('Geometry to Instance', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'geometry_to_instance')); });
  it('should convert geometry to instance', () => {
    const def = registry.getNodeDef('geo', 'geometry_to_instance');
    const geo = new GeometrySet();
    geo.mesh = createMeshCube(1, 1, 1, 2, 2, 2);
    const result = def.evaluate({}, { 'Geometry': geo });
    assert.ok(result.outputs[0].instances);
    assert.equal(result.outputs[0].instances.instanceCount, 1);
  });
});

describe('Separate Components', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'separate_components')); });
  it('should separate mesh and curve', () => {
    const def = registry.getNodeDef('geo', 'separate_components');
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [{ x: 0, y: 0, z: 0 }];
    geo.curve = new CurveComponent();
    geo.curve.splines.push({
      type: 'POLY', positions: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      handleLeft: null, handleRight: null,
      radii: [1, 1], tilts: [0, 0], cyclic: false, resolution: 12,
    });

    const result = def.evaluate({}, { 'Geometry': geo });
    assert.ok(result.outputs[0].mesh, 'Mesh output should have mesh');
    assert.ok(result.outputs[1].curve, 'Curve output should have curve');
    assert.ok(!result.outputs[0].curve, 'Mesh output should not have curve');
    assert.ok(!result.outputs[1].mesh, 'Curve output should not have mesh');
  });

  it('should handle empty geometry', () => {
    const result = registry.getNodeDef('geo', 'separate_components').evaluate({}, { 'Geometry': null });
    assert.equal(result.outputs.length, 4);
  });
});

// ── Topology Nodes ───────────────────────────────────────────────────────

describe('Vertex of Corner', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'vertex_of_corner')); });
  it('should return int field', () => {
    const result = registry.getNodeDef('geo', 'vertex_of_corner').evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
  });
});

describe('Corners of Edge', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'corners_of_edge')); });
  it('should return Corner Index and Total fields', () => {
    const result = registry.getNodeDef('geo', 'corners_of_edge').evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Offset Corner in Face', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'offset_corner_in_face')); });
  it('should offset corner index', () => {
    const result = registry.getNodeDef('geo', 'offset_corner_in_face').evaluate({}, {
      'Corner Index': null, 'Offset': 2,
    });
    assert.ok(result.outputs[0] instanceof Field);
    const val = result.outputs[0].evaluateAt({ index: 5, count: 10 });
    assert.equal(val, 7, 'index 5 + offset 2 = 7');
  });
});
