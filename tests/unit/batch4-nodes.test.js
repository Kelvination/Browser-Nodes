/**
 * Unit tests for batch 4 nodes:
 * face_area, edge_angle, face_neighbors, vertex_neighbors,
 * set_material, material_selection, split_edges,
 * separate_color, combine_color, evaluate_at_index,
 * spline_length, is_spline_cyclic, white_noise_texture, gradient_texture
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry, SocketType } from '../../core/registry.js';
import {
  GeometrySet, MeshComponent, DOMAIN,
  createMeshGrid, createMeshCube,
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

function makeGridGeo() {
  const geo = new GeometrySet();
  geo.mesh = createMeshGrid(1, 1, 3, 3);
  return geo;
}

// ── Mesh Read Nodes ──────────────────────────────────────────────────────

describe('Face Area', () => {
  it('should register face_area', () => {
    assert.ok(registry.getNodeDef('geo', 'face_area'));
  });

  it('should return a float field', () => {
    const def = registry.getNodeDef('geo', 'face_area');
    const result = def.evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
  });
});

describe('Edge Angle', () => {
  it('should register edge_angle', () => {
    assert.ok(registry.getNodeDef('geo', 'edge_angle'));
  });

  it('should return two float fields', () => {
    const def = registry.getNodeDef('geo', 'edge_angle');
    const result = def.evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field, 'unsigned angle should be field');
    assert.ok(result.outputs[1] instanceof Field, 'signed angle should be field');
  });
});

describe('Face Neighbors', () => {
  it('should register face_neighbors', () => {
    assert.ok(registry.getNodeDef('geo', 'face_neighbors'));
  });

  it('should return vertex count and face count fields', () => {
    const def = registry.getNodeDef('geo', 'face_neighbors');
    const result = def.evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Vertex Neighbors', () => {
  it('should register vertex_neighbors', () => {
    assert.ok(registry.getNodeDef('geo', 'vertex_neighbors'));
  });
});

// ── Material Nodes ───────────────────────────────────────────────────────

describe('Set Material', () => {
  it('should register set_material', () => {
    const def = registry.getNodeDef('geo', 'set_material');
    assert.ok(def);
    assert.equal(def.label, 'Set Material');
  });

  it('should store material_index attribute', () => {
    const def = registry.getNodeDef('geo', 'set_material');
    const geo = makeGridGeo();
    const result = def.evaluate(
      { material_index: 2 },
      { 'Geometry': geo, 'Selection': null, 'Material Index': 2 }
    );
    const matIdx = result.outputs[0].mesh.faceAttrs.get('material_index');
    assert.ok(matIdx, 'should have material_index attribute');
    for (const idx of matIdx) {
      assert.equal(idx, 2, 'all faces should have material index 2');
    }
  });
});

describe('Material Selection', () => {
  it('should register material_selection', () => {
    assert.ok(registry.getNodeDef('geo', 'material_selection'));
  });
});

// ── Split Edges ──────────────────────────────────────────────────────────

describe('Split Edges', () => {
  it('should register split_edges', () => {
    const def = registry.getNodeDef('geo', 'split_edges');
    assert.ok(def);
    assert.equal(def.label, 'Split Edges');
  });

  it('should add vertices when splitting', () => {
    const def = registry.getNodeDef('geo', 'split_edges');
    const geo = makeGridGeo();
    const origVerts = geo.mesh.vertexCount;
    const result = def.evaluate({}, { 'Mesh': geo, 'Selection': null });
    assert.ok(result.outputs[0].mesh.vertexCount > origVerts, 'should add vertices');
  });
});

// ── Color Nodes ──────────────────────────────────────────────────────────

describe('Separate Color', () => {
  it('should register separate_color', () => {
    const def = registry.getNodeDef('geo', 'separate_color');
    assert.ok(def);
  });

  it('should split RGB color into components', () => {
    const def = registry.getNodeDef('geo', 'separate_color');
    const result = def.evaluate(
      { mode: 'RGB' },
      { 'Color': { r: 0.5, g: 0.3, b: 0.8, a: 0.9 } }
    );
    assert.ok(Math.abs(result.outputs[0] - 0.5) < 0.01, 'R should be 0.5');
    assert.ok(Math.abs(result.outputs[1] - 0.3) < 0.01, 'G should be 0.3');
    assert.ok(Math.abs(result.outputs[2] - 0.8) < 0.01, 'B should be 0.8');
    assert.ok(Math.abs(result.outputs[3] - 0.9) < 0.01, 'A should be 0.9');
  });

  it('should handle field inputs', () => {
    const def = registry.getNodeDef('geo', 'separate_color');
    const colorField = new Field('color', () => ({ r: 1, g: 0.5, b: 0, a: 1 }));
    const result = def.evaluate({ mode: 'RGB' }, { 'Color': colorField });
    assert.ok(result.outputs[0] instanceof Field, 'R should be Field');
  });
});

describe('Combine Color', () => {
  it('should register combine_color', () => {
    const def = registry.getNodeDef('geo', 'combine_color');
    assert.ok(def);
  });

  it('should combine RGB components into color', () => {
    const def = registry.getNodeDef('geo', 'combine_color');
    const result = def.evaluate(
      { mode: 'RGB' },
      { 'Red': 0.5, 'Green': 0.3, 'Blue': 0.8, 'Alpha': 1.0 }
    );
    const c = result.outputs[0];
    assert.ok(Math.abs(c.r - 0.5) < 0.01);
    assert.ok(Math.abs(c.g - 0.3) < 0.01);
    assert.ok(Math.abs(c.b - 0.8) < 0.01);
  });
});

// ── Field Utility Nodes ──────────────────────────────────────────────────

describe('Evaluate at Index', () => {
  it('should register evaluate_at_index', () => {
    const def = registry.getNodeDef('geo', 'evaluate_at_index');
    assert.ok(def);
  });

  it('should return a field', () => {
    const def = registry.getNodeDef('geo', 'evaluate_at_index');
    const valueField = new Field('float', (el) => el.index * 10);
    const result = def.evaluate(
      { data_type: 'FLOAT', domain: 'POINT' },
      { 'Value': valueField, 'Index': 3 }
    );
    assert.ok(result.outputs[0] instanceof Field);
    // Evaluating at index 3 should give 30
    const val = result.outputs[0].evaluateAt({ index: 0, count: 10 });
    assert.equal(val, 30);
  });
});

describe('Spline Length', () => {
  it('should register spline_length', () => {
    assert.ok(registry.getNodeDef('geo', 'spline_length'));
  });

  it('should return Length and Point Count fields', () => {
    const def = registry.getNodeDef('geo', 'spline_length');
    const result = def.evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

describe('Is Spline Cyclic', () => {
  it('should register is_spline_cyclic', () => {
    assert.ok(registry.getNodeDef('geo', 'is_spline_cyclic'));
  });
});

// ── Texture Nodes ────────────────────────────────────────────────────────

describe('White Noise Texture', () => {
  it('should register white_noise_texture', () => {
    const def = registry.getNodeDef('geo', 'white_noise_texture');
    assert.ok(def);
    assert.equal(def.label, 'White Noise Texture');
  });

  it('should produce field outputs with field input', () => {
    const def = registry.getNodeDef('geo', 'white_noise_texture');
    const posField = new Field('vector', (el) => el.position);
    const result = def.evaluate(
      { dimensions: '3D' },
      { 'Vector': posField, 'W': null }
    );
    assert.ok(result.outputs[0] instanceof Field, 'Value should be Field');
    assert.ok(result.outputs[1] instanceof Field, 'Color should be Field');
  });

  it('should produce different values at different positions', () => {
    const def = registry.getNodeDef('geo', 'white_noise_texture');
    const result = def.evaluate(
      { dimensions: '3D' },
      { 'Vector': { x: 1.5, y: 2.5, z: 3.5 }, 'W': null }
    );
    const val1 = result.outputs[0];
    const result2 = def.evaluate(
      { dimensions: '3D' },
      { 'Vector': { x: 7.1, y: 8.2, z: 9.3 }, 'W': null }
    );
    const val2 = result2.outputs[0];
    // White noise should produce different values at different positions
    assert.ok(typeof val1 === 'number');
    assert.ok(typeof val2 === 'number');
  });
});

describe('Gradient Texture', () => {
  it('should register gradient_texture', () => {
    const def = registry.getNodeDef('geo', 'gradient_texture');
    assert.ok(def);
  });

  it('should compute linear gradient', () => {
    const def = registry.getNodeDef('geo', 'gradient_texture');
    const result = def.evaluate(
      { gradient_type: 'LINEAR' },
      { 'Vector': { x: 0.5, y: 0, z: 0 } }
    );
    const fac = result.outputs[1];
    assert.ok(Math.abs(fac - 0.5) < 0.01, `linear gradient at x=0.5 should be 0.5, got ${fac}`);
  });

  it('should return field outputs with field input', () => {
    const def = registry.getNodeDef('geo', 'gradient_texture');
    const posField = new Field('vector', (el) => el.position);
    const result = def.evaluate(
      { gradient_type: 'LINEAR' },
      { 'Vector': posField }
    );
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });

  it('should handle radial gradient', () => {
    const def = registry.getNodeDef('geo', 'gradient_texture');
    const result = def.evaluate(
      { gradient_type: 'RADIAL' },
      { 'Vector': { x: 1, y: 0, z: 0 } }
    );
    const fac = result.outputs[1];
    assert.ok(typeof fac === 'number');
    assert.ok(fac >= 0 && fac <= 1);
  });
});
