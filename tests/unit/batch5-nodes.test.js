/**
 * Unit tests for batch 5 nodes.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry, SocketType } from '../../core/registry.js';
import {
  GeometrySet, MeshComponent, CurveComponent,
  DOMAIN, createMeshGrid,
} from '../../core/geometry.js';
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

// ── Mesh Read Nodes ──────────────────────────────────────────────────────

describe('Edge Neighbors', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'edge_neighbors')); });
  it('should return int field', () => {
    const result = registry.getNodeDef('geo', 'edge_neighbors').evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
  });
});

describe('Mesh Island', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'mesh_island')); });
  it('should return island index and count', () => {
    const result = registry.getNodeDef('geo', 'mesh_island').evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Radius', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'radius')); });
  it('should default to 1.0', () => {
    const result = registry.getNodeDef('geo', 'radius').evaluate({}, {});
    assert.equal(result.outputs[0].evaluateAt({ index: 0 }), 1.0);
  });
});

// ── Points to Vertices ───────────────────────────────────────────────────

describe('Points to Vertices', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'points_to_vertices')); });

  it('should convert point positions to mesh vertices', () => {
    const def = registry.getNodeDef('geo', 'points_to_vertices');
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ];

    const result = def.evaluate({}, { 'Points': geo, 'Selection': null });
    assert.equal(result.outputs[0].mesh.vertexCount, 3);
  });
});

// ── Curve Primitives ─────────────────────────────────────────────────────

describe('Curve Arc', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'curve_arc')); });

  it('should create arc with specified resolution', () => {
    const def = registry.getNodeDef('geo', 'curve_arc');
    const result = def.evaluate(
      { resolution: 8, radius: 2.0, start_angle: 0, sweep_angle: Math.PI },
      { 'Resolution': 8, 'Radius': 2.0, 'Start Angle': 0, 'Sweep Angle': Math.PI,
        'Connect Center': false, 'Invert Arc': false }
    );
    assert.ok(result.outputs[0].curve);
    assert.equal(result.outputs[0].curve.splines[0].positions.length, 8);
  });

  it('should connect center when enabled', () => {
    const def = registry.getNodeDef('geo', 'curve_arc');
    const result = def.evaluate(
      { resolution: 4, radius: 1.0, start_angle: 0, sweep_angle: Math.PI },
      { 'Resolution': 4, 'Radius': 1, 'Start Angle': 0, 'Sweep Angle': Math.PI,
        'Connect Center': true, 'Invert Arc': false }
    );
    // Should have 4 arc points + 1 center = 5
    assert.equal(result.outputs[0].curve.splines[0].positions.length, 5);
    assert.equal(result.outputs[0].curve.splines[0].cyclic, true);
  });
});

describe('Curve Spiral', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'curve_spiral')); });

  it('should create spiral with correct point count', () => {
    const def = registry.getNodeDef('geo', 'curve_spiral');
    const result = def.evaluate(
      { resolution: 16, rotations: 2, start_radius: 1, end_radius: 2, height: 2 },
      { 'Resolution': 16, 'Rotations': 2, 'Start Radius': 1, 'End Radius': 2,
        'Height': 2, 'Reverse': false }
    );
    assert.ok(result.outputs[0].curve);
    assert.equal(result.outputs[0].curve.splines[0].positions.length, 16);
  });
});

describe('Set Curve Normal', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'set_curve_normal')); });
});

// ── Texture Nodes ────────────────────────────────────────────────────────

describe('Checker Texture', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'checker_texture')); });

  it('should alternate between two colors', () => {
    const def = registry.getNodeDef('geo', 'checker_texture');
    const result1 = def.evaluate(
      { scale: 1 },
      { 'Vector': { x: 0.5, y: 0.5, z: 0.5 }, 'Color1': null, 'Color2': null, 'Scale': 1 }
    );
    const result2 = def.evaluate(
      { scale: 1 },
      { 'Vector': { x: 1.5, y: 0.5, z: 0.5 }, 'Color1': null, 'Color2': null, 'Scale': 1 }
    );
    // Adjacent cells should have different fac values
    assert.notEqual(result1.outputs[1], result2.outputs[1]);
  });
});

describe('Wave Texture', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'wave_texture')); });

  it('should produce values in [0,1]', () => {
    const def = registry.getNodeDef('geo', 'wave_texture');
    const result = def.evaluate(
      { scale: 5, distortion: 0, detail: 0, detail_scale: 1, detail_roughness: 0.5,
        phase_offset: 0, wave_type: 'BANDS', wave_profile: 'SIN' },
      { 'Vector': { x: 0.3, y: 0, z: 0 }, 'Scale': 5, 'Distortion': 0,
        'Detail': 0, 'Detail Scale': 1, 'Detail Roughness': 0.5, 'Phase Offset': 0 }
    );
    assert.ok(result.outputs[1] >= 0 && result.outputs[1] <= 1);
  });
});

// ── Utility Nodes ────────────────────────────────────────────────────────

describe('Evaluate on Domain', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'evaluate_on_domain')); });
});

describe('Index of Nearest', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'index_of_nearest')); });

  it('should return field outputs', () => {
    const result = registry.getNodeDef('geo', 'index_of_nearest').evaluate({}, {
      'Position': null, 'Group ID': null,
    });
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Remove Named Attribute', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'remove_named_attribute')); });

  it('should pass through geometry', () => {
    const def = registry.getNodeDef('geo', 'remove_named_attribute');
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [{ x: 0, y: 0, z: 0 }];
    const result = def.evaluate({ name: 'test' }, { 'Geometry': geo });
    assert.ok(result.outputs[0].mesh);
  });
});

describe('Blur Attribute', () => {
  it('should register', () => { assert.ok(registry.getNodeDef('geo', 'blur_attribute')); });
});
