/**
 * Unit tests for batch 8 nodes.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry } from '../../core/registry.js';
import { GeometrySet } from '../../core/geometry.js';
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

// ── Rotation Nodes ───────────────────────────────────────────────────────

describe('Euler to Rotation', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'euler_to_rotation')); });
  it('should pass through euler as rotation', () => {
    const def = registry.getNodeDef('geo', 'euler_to_rotation');
    const result = def.evaluate({}, { 'Euler': { x: 1, y: 2, z: 3 } });
    assert.deepEqual(result.outputs[0], { x: 1, y: 2, z: 3 });
  });
});

describe('Axis Angle to Rotation', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'axis_angle_to_rotation')); });
  it('should convert axis-angle', () => {
    const def = registry.getNodeDef('geo', 'axis_angle_to_rotation');
    const result = def.evaluate({}, {
      'Axis': { x: 0, y: 0, z: 1 },
      'Angle': Math.PI,
    });
    assert.ok(Math.abs(result.outputs[0].z - Math.PI) < 0.01);
  });
});

describe('Rotate Rotation', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'rotate_rotation')); });
  it('should combine rotations', () => {
    const def = registry.getNodeDef('geo', 'rotate_rotation');
    const result = def.evaluate(
      { rotation_space: 'GLOBAL' },
      { 'Rotation': { x: 1, y: 0, z: 0 }, 'Rotate By': { x: 0, y: 1, z: 0 } }
    );
    assert.deepEqual(result.outputs[0], { x: 1, y: 1, z: 0 });
  });
});

describe('Invert Rotation', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'invert_rotation')); });
  it('should negate euler angles', () => {
    const def = registry.getNodeDef('geo', 'invert_rotation');
    const result = def.evaluate({}, { 'Rotation': { x: 1, y: -2, z: 3 } });
    assert.deepEqual(result.outputs[0], { x: -1, y: 2, z: -3 });
  });
});

// ── Mesh Topology ────────────────────────────────────────────────────────

describe('Corners of Vertex', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'corners_of_vertex')); });
  it('should return field outputs', () => {
    const result = registry.getNodeDef('geo', 'corners_of_vertex').evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Edges of Vertex', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'edges_of_vertex')); });
});

describe('Edges of Corner', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'edges_of_corner')); });
  it('should return next and previous edge fields', () => {
    const result = registry.getNodeDef('geo', 'edges_of_corner').evaluate({}, {});
    assert.equal(result.outputs.length, 2);
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

// ── Other Nodes ──────────────────────────────────────────────────────────

describe('Is Face Smooth', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'is_face_smooth')); });
  it('should return bool field', () => {
    const result = registry.getNodeDef('geo', 'is_face_smooth').evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
  });
});

describe('Index Switch', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'index_switch')); });

  it('should select value by index', () => {
    const def = registry.getNodeDef('geo', 'index_switch');
    const result = def.evaluate(
      { data_type: 'FLOAT' },
      { 'Index': 2, '0': 10, '1': 20, '2': 30, '3': 40 }
    );
    assert.equal(result.outputs[0], 30);
  });

  it('should clamp index to valid range', () => {
    const def = registry.getNodeDef('geo', 'index_switch');
    const result = def.evaluate(
      { data_type: 'FLOAT' },
      { 'Index': 99, '0': 10, '1': 20, '2': 30, '3': 40 }
    );
    assert.equal(result.outputs[0], 40); // clamped to max index 3
  });

  it('should have dynamic inputs based on type', () => {
    const def = registry.getNodeDef('geo', 'index_switch');
    const inputs = def.getInputs({ data_type: 'GEOMETRY' });
    assert.equal(inputs[1].type, 'geometry');
  });
});
