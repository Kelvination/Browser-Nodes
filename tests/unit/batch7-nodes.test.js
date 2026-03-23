/**
 * Unit tests for batch 7 nodes.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry } from '../../core/registry.js';
import { GeometrySet, MeshComponent, CurveComponent, createMeshGrid } from '../../core/geometry.js';
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

// ── Curve Operations ─────────────────────────────────────────────────────

describe('Set Spline Type', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'set_spline_type')); });

  it('should change spline type', () => {
    const def = registry.getNodeDef('geo', 'set_spline_type');
    const geo = new GeometrySet();
    geo.curve = new CurveComponent();
    geo.curve.splines.push({
      type: 'BEZIER', positions: [{ x: 0, y: 0, z: 0 }],
      handleLeft: [{ x: -1, y: 0, z: 0 }], handleRight: [{ x: 1, y: 0, z: 0 }],
      radii: [1], tilts: [0], cyclic: false, resolution: 12,
    });
    const result = def.evaluate(
      { spline_type: 'POLY' },
      { 'Curve': geo, 'Selection': null }
    );
    assert.equal(result.outputs[0].curve.splines[0].type, 'POLY');
    assert.equal(result.outputs[0].curve.splines[0].handleLeft, null);
  });
});

describe('Curve Handle Positions', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'curve_handle_positions')); });
  it('should return two vector fields', () => {
    const result = registry.getNodeDef('geo', 'curve_handle_positions').evaluate({}, { 'Relative': false });
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Points of Curve', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'points_of_curve')); });
});

// ── Mesh Operations ──────────────────────────────────────────────────────

describe('Dual Mesh', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'dual_mesh')); });

  it('should convert faces to vertices', () => {
    const def = registry.getNodeDef('geo', 'dual_mesh');
    const geo = new GeometrySet();
    geo.mesh = createMeshGrid(1, 1, 3, 3); // 4 faces, 9 vertices
    const result = def.evaluate({}, { 'Mesh': geo, 'Keep Boundaries': false });
    assert.ok(result.outputs[0].mesh);
    // Dual should have 4 vertices (one per original face)
    assert.equal(result.outputs[0].mesh.vertexCount, 4);
  });
});

describe('Sort Elements', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'sort_elements')); });
});

describe('Set Point Radius', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'set_point_radius')); });
});

describe('Object Info', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'object_info')); });
  it('should return identity transforms', () => {
    const result = registry.getNodeDef('geo', 'object_info').evaluate({}, {});
    assert.deepEqual(result.outputs[0], { x: 0, y: 0, z: 0 }); // location
    assert.deepEqual(result.outputs[2], { x: 1, y: 1, z: 1 }); // scale
  });
});

// ── Topology Queries ─────────────────────────────────────────────────────

describe('Corners of Face', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'corners_of_face')); });
});

describe('Face of Corner', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'face_of_corner')); });
});

// ── Textures ─────────────────────────────────────────────────────────────

describe('Brick Texture', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'brick_texture')); });

  it('should produce field outputs', () => {
    const def = registry.getNodeDef('geo', 'brick_texture');
    const posField = new Field('vector', (el) => el.position);
    const result = def.evaluate(
      { scale: 5, mortar_size: 0.02, brick_width: 0.5, row_height: 0.25 },
      { 'Vector': posField, 'Color1': null, 'Color2': null, 'Scale': 5,
        'Mortar Size': 0.02, 'Brick Width': 0.5, 'Row Height': 0.25 }
    );
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Magic Texture', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'magic_texture')); });

  it('should produce colorful output', () => {
    const def = registry.getNodeDef('geo', 'magic_texture');
    const result = def.evaluate(
      { scale: 5, distortion: 1, depth: 2 },
      { 'Vector': { x: 0.5, y: 0.3, z: 0.7 }, 'Scale': 5, 'Distortion': 1 }
    );
    const col = result.outputs[0];
    assert.ok(col.r >= 0 && col.r <= 1);
    assert.ok(col.g >= 0 && col.g <= 1);
    assert.ok(col.b >= 0 && col.b <= 1);
  });
});

describe('Sample Nearest Surface', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'sample_nearest_surface')); });

  it('should have dynamic inputs', () => {
    const def = registry.getNodeDef('geo', 'sample_nearest_surface');
    const floatInputs = def.getInputs({ data_type: 'FLOAT' });
    assert.equal(floatInputs[1].name, 'Value');
  });
});
