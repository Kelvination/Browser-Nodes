/**
 * Unit tests for batch 2 nodes:
 * mesh_line, mesh_circle, mix, voronoi_texture, capture_attribute,
 * attribute_statistic, accumulate_field, triangulate, flip_faces,
 * duplicate_elements, fill_curve, fillet_curve
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry, SocketType } from '../../core/registry.js';
import {
  GeometrySet, MeshComponent, CurveComponent,
  DOMAIN, createMeshGrid, createMeshCube, createMeshCircle,
} from '../../core/geometry.js';
import { Field } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';
import { registerCurveNodes } from '../../geo/nodes_v2_curves.js';
import { registerMeshOpNodes } from '../../geo/nodes_v2_mesh_ops.js';
import { registerUtilityNodes } from '../../geo/nodes_v2_utilities.js';
import { registerSamplingNodes } from '../../geo/nodes_v2_sampling.js';

before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerFieldNodes(registry);
  registerCurveNodes(registry);
  registerMeshOpNodes(registry);
  registerUtilityNodes(registry);
  registerSamplingNodes(registry);
});

function makeGridGeo() {
  const geo = new GeometrySet();
  geo.mesh = createMeshGrid(1, 1, 3, 3);
  return geo;
}

function makeCubeGeo() {
  const geo = new GeometrySet();
  geo.mesh = createMeshCube(2, 2, 2, 2, 2, 2);
  return geo;
}

// ── Mesh Line ────────────────────────────────────────────────────────────

describe('Mesh Line', () => {
  it('should register mesh_line', () => {
    const def = registry.getNodeDef('geo', 'mesh_line');
    assert.ok(def);
    assert.equal(def.label, 'Mesh Line');
  });

  it('should create a line of vertices', () => {
    const def = registry.getNodeDef('geo', 'mesh_line');
    const result = def.evaluate(
      { count: 5, mode: 'OFFSET' },
      { 'Count': 5, 'Start Location': { x: 0, y: 0, z: 0 }, 'Offset': { x: 1, y: 0, z: 0 } }
    );
    const mesh = result.outputs[0].mesh;
    assert.equal(mesh.vertexCount, 5, 'should have 5 vertices');
    assert.equal(mesh.edgeCount, 4, 'should have 4 edges');
  });

  it('should support endpoint mode', () => {
    const def = registry.getNodeDef('geo', 'mesh_line');
    const result = def.evaluate(
      { count: 10, mode: 'END_POINTS' },
      { 'Count': 10, 'Start Location': { x: 0, y: 0, z: 0 }, 'Offset': { x: 5, y: 0, z: 0 } }
    );
    const mesh = result.outputs[0].mesh;
    assert.equal(mesh.vertexCount, 10);
  });
});

// ── Mesh Circle ──────────────────────────────────────────────────────────

describe('Mesh Circle', () => {
  it('should register mesh_circle', () => {
    const def = registry.getNodeDef('geo', 'mesh_circle');
    assert.ok(def);
    assert.equal(def.label, 'Mesh Circle');
  });

  it('should create circle with NONE fill', () => {
    const def = registry.getNodeDef('geo', 'mesh_circle');
    const result = def.evaluate(
      { vertices: 8, radius: 1.0, fill_type: 'NONE' },
      { 'Vertices': 8, 'Radius': 1.0 }
    );
    const mesh = result.outputs[0].mesh;
    assert.equal(mesh.vertexCount, 8);
    assert.equal(mesh.edgeCount, 8);
    assert.equal(mesh.faceCount, 0, 'NONE fill should have no faces');
  });

  it('should create circle with NGON fill', () => {
    const def = registry.getNodeDef('geo', 'mesh_circle');
    const result = def.evaluate(
      { vertices: 6, radius: 1.0, fill_type: 'NGON' },
      { 'Vertices': 6, 'Radius': 1.0 }
    );
    const mesh = result.outputs[0].mesh;
    assert.equal(mesh.faceCount, 1, 'NGON should have 1 face');
    assert.equal(mesh.faceVertCounts[0], 6, 'face should be a hexagon');
  });

  it('should create circle with TRIANGLE_FAN fill', () => {
    const def = registry.getNodeDef('geo', 'mesh_circle');
    const result = def.evaluate(
      { vertices: 8, radius: 1.0, fill_type: 'TRIANGLE_FAN' },
      { 'Vertices': 8, 'Radius': 1.0 }
    );
    const mesh = result.outputs[0].mesh;
    assert.equal(mesh.vertexCount, 9, 'should have 8 rim + 1 center');
    assert.equal(mesh.faceCount, 8, 'should have 8 triangle faces');
  });
});

// ── Mix ──────────────────────────────────────────────────────────────────

describe('Mix Node', () => {
  it('should register mix', () => {
    const def = registry.getNodeDef('geo', 'mix');
    assert.ok(def);
    assert.equal(def.label, 'Mix');
  });

  it('should interpolate floats', () => {
    const def = registry.getNodeDef('geo', 'mix');
    const result = def.evaluate(
      { data_type: 'FLOAT', clamp_factor: true },
      { 'Factor': 0.5, 'A': 0, 'B': 10 }
    );
    assert.equal(result.outputs[0], 5);
  });

  it('should interpolate at factor 0 (return A)', () => {
    const def = registry.getNodeDef('geo', 'mix');
    const result = def.evaluate(
      { data_type: 'FLOAT', clamp_factor: true },
      { 'Factor': 0, 'A': 42, 'B': 99 }
    );
    assert.equal(result.outputs[0], 42);
  });

  it('should interpolate vectors', () => {
    const def = registry.getNodeDef('geo', 'mix');
    const result = def.evaluate(
      { data_type: 'VECTOR', clamp_factor: true },
      { 'Factor': 0.5, 'A': { x: 0, y: 0, z: 0 }, 'B': { x: 10, y: 20, z: 30 } }
    );
    assert.ok(Math.abs(result.outputs[0].x - 5) < 0.01);
    assert.ok(Math.abs(result.outputs[0].y - 10) < 0.01);
  });

  it('should clamp factor when enabled', () => {
    const def = registry.getNodeDef('geo', 'mix');
    const result = def.evaluate(
      { data_type: 'FLOAT', clamp_factor: true },
      { 'Factor': 2.0, 'A': 0, 'B': 10 }
    );
    assert.equal(result.outputs[0], 10, 'factor clamped to 1 should give B');
  });

  it('should return field when inputs are fields', () => {
    const def = registry.getNodeDef('geo', 'mix');
    const factorField = new Field('float', (el) => el.index / el.count);
    const result = def.evaluate(
      { data_type: 'FLOAT', clamp_factor: true },
      { 'Factor': factorField, 'A': 0, 'B': 100 }
    );
    assert.ok(result.outputs[0] instanceof Field);
  });
});

// ── Voronoi Texture ──────────────────────────────────────────────────────

describe('Voronoi Texture', () => {
  it('should register voronoi_texture', () => {
    const def = registry.getNodeDef('geo', 'voronoi_texture');
    assert.ok(def);
    assert.equal(def.label, 'Voronoi Texture');
  });

  it('should produce field outputs', () => {
    const def = registry.getNodeDef('geo', 'voronoi_texture');
    const posField = new Field('vector', (el) => el.position);
    const result = def.evaluate(
      { scale: 5, randomness: 1, feature: 'F1' },
      { 'Vector': posField, 'Scale': 5, 'Randomness': 1 }
    );
    assert.ok(result.outputs[0] instanceof Field, 'Distance should be Field');
    assert.ok(result.outputs[1] instanceof Field, 'Color should be Field');
  });
});

// ── Capture Attribute ────────────────────────────────────────────────────

describe('Capture Attribute', () => {
  it('should register capture_attribute', () => {
    const def = registry.getNodeDef('geo', 'capture_attribute');
    assert.ok(def);
  });

  it('should capture a field and output stored values', () => {
    const def = registry.getNodeDef('geo', 'capture_attribute');
    const geo = makeGridGeo();
    const posXField = new Field('float', (el) => el.position.x);

    const result = def.evaluate(
      { data_type: 'FLOAT', domain: 'POINT' },
      { 'Geometry': geo, 'Value': posXField }
    );

    assert.ok(result.outputs[0] instanceof GeometrySet, 'first output should be geometry');
    assert.ok(result.outputs[1] instanceof Field, 'second output should be a field');

    // The captured field should return the same values
    const el = { index: 0, count: 9, position: { x: 999, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
    const captured = result.outputs[1].evaluateAt(el);
    assert.ok(typeof captured === 'number', 'should be a number');
  });
});

// ── Attribute Statistic ──────────────────────────────────────────────────

describe('Attribute Statistic', () => {
  it('should register attribute_statistic', () => {
    const def = registry.getNodeDef('geo', 'attribute_statistic');
    assert.ok(def);
  });

  it('should compute correct statistics for float field', () => {
    const def = registry.getNodeDef('geo', 'attribute_statistic');
    const geo = makeGridGeo();

    // Index field: 0, 1, 2, 3, 4, 5, 6, 7, 8
    const indexField = new Field('float', (el) => el.index);

    const result = def.evaluate(
      { data_type: 'FLOAT', domain: 'POINT' },
      { 'Geometry': geo, 'Selection': null, 'Attribute': indexField }
    );

    const [mean, median, sum, min, max, range, stdDev, variance] = result.outputs;
    assert.equal(mean, 4, 'mean of 0-8 should be 4');
    assert.equal(median, 4, 'median of 0-8 should be 4');
    assert.equal(sum, 36, 'sum of 0-8 should be 36');
    assert.equal(min, 0, 'min should be 0');
    assert.equal(max, 8, 'max should be 8');
    assert.equal(range, 8, 'range should be 8');
    assert.ok(stdDev > 0, 'std dev should be positive');
  });
});

// ── Accumulate Field ─────────────────────────────────────────────────────

describe('Accumulate Field', () => {
  it('should register accumulate_field', () => {
    const def = registry.getNodeDef('geo', 'accumulate_field');
    assert.ok(def);
  });

  it('should return field outputs', () => {
    const def = registry.getNodeDef('geo', 'accumulate_field');
    const result = def.evaluate(
      { data_type: 'FLOAT', domain: 'POINT' },
      { 'Value': 1, 'Group Index': null }
    );
    assert.ok(result.outputs[0] instanceof Field, 'Leading should be Field');
    assert.ok(result.outputs[1] instanceof Field, 'Trailing should be Field');
    assert.ok(result.outputs[2] instanceof Field, 'Total should be Field');
  });
});

// ── Triangulate ──────────────────────────────────────────────────────────

describe('Triangulate', () => {
  it('should register triangulate', () => {
    const def = registry.getNodeDef('geo', 'triangulate');
    assert.ok(def);
    assert.equal(def.label, 'Triangulate');
  });

  it('should convert quads to triangles', () => {
    const def = registry.getNodeDef('geo', 'triangulate');
    const geo = makeGridGeo(); // 4 quad faces

    const result = def.evaluate(
      { quad_method: 'SHORT_EDGE', ngon_method: 'BEAUTY' },
      { 'Mesh': geo, 'Selection': null }
    );
    const mesh = result.outputs[0].mesh;

    // Each quad becomes 2 triangles
    assert.equal(mesh.faceCount, 8, '4 quads should become 8 triangles');
    for (const count of mesh.faceVertCounts) {
      assert.equal(count, 3, 'all faces should be triangles');
    }
  });

  it('should respect selection', () => {
    const def = registry.getNodeDef('geo', 'triangulate');
    const geo = makeGridGeo(); // 4 quad faces

    // Only triangulate first face
    const selField = new Field('bool', (el) => el.index === 0);
    const result = def.evaluate(
      { quad_method: 'FIXED', ngon_method: 'BEAUTY' },
      { 'Mesh': geo, 'Selection': selField }
    );
    const mesh = result.outputs[0].mesh;

    // 1 quad becomes 2 tris + 3 remaining quads = 5 faces
    assert.equal(mesh.faceCount, 5);
  });
});

// ── Flip Faces ───────────────────────────────────────────────────────────

describe('Flip Faces', () => {
  it('should register flip_faces', () => {
    const def = registry.getNodeDef('geo', 'flip_faces');
    assert.ok(def);
  });

  it('should reverse face winding order', () => {
    const def = registry.getNodeDef('geo', 'flip_faces');

    // Create simple triangle mesh
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ];
    geo.mesh.faceVertCounts = [3];
    geo.mesh.cornerVerts = [0, 1, 2];
    geo.mesh.edges = [[0, 1], [1, 2], [2, 0]];

    const result = def.evaluate({}, { 'Mesh': geo, 'Selection': null });
    const mesh = result.outputs[0].mesh;

    // Reversed: [2, 1, 0]
    assert.equal(mesh.cornerVerts[0], 2);
    assert.equal(mesh.cornerVerts[1], 1);
    assert.equal(mesh.cornerVerts[2], 0);
  });
});

// ── Duplicate Elements ───────────────────────────────────────────────────

describe('Duplicate Elements', () => {
  it('should register duplicate_elements', () => {
    const def = registry.getNodeDef('geo', 'duplicate_elements');
    assert.ok(def);
  });

  it('should duplicate points', () => {
    const def = registry.getNodeDef('geo', 'duplicate_elements');
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];

    const result = def.evaluate(
      { amount: 3, domain: 'POINT' },
      { 'Geometry': geo, 'Selection': null, 'Amount': 3 }
    );

    // 2 points × 3 duplicates = 6 points (only duplicates, no originals)
    assert.equal(result.outputs[0].mesh.vertexCount, 6);
    assert.ok(result.outputs[1] instanceof Field, 'Duplicate Index should be Field');
  });
});

// ── Fill Curve ───────────────────────────────────────────────────────────

describe('Fill Curve', () => {
  it('should register fill_curve', () => {
    const def = registry.getNodeDef('geo', 'fill_curve');
    assert.ok(def);
    assert.equal(def.label, 'Fill Curve');
  });

  it('should fill a curve to create mesh faces', () => {
    const def = registry.getNodeDef('geo', 'fill_curve');

    // Create a square curve
    const geo = new GeometrySet();
    geo.curve = new CurveComponent();
    geo.curve.splines.push({
      type: 'POLY',
      positions: [
        { x: -1, y: -1, z: 0 },
        { x: 1, y: -1, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: -1, y: 1, z: 0 },
      ],
      handleLeft: null, handleRight: null,
      radii: [1, 1, 1, 1], tilts: [0, 0, 0, 0],
      cyclic: true, resolution: 12,
    });

    const result = def.evaluate(
      { mode: 'TRIANGULATED' },
      { 'Curve': geo }
    );

    assert.ok(result.outputs[0].mesh, 'should output a mesh');
    assert.ok(result.outputs[0].mesh.faceCount > 0, 'should have faces');
    assert.equal(result.outputs[0].mesh.vertexCount, 4, 'should have 4 vertices');
  });

  it('should support NGONS mode', () => {
    const def = registry.getNodeDef('geo', 'fill_curve');

    const geo = new GeometrySet();
    geo.curve = new CurveComponent();
    geo.curve.splines.push({
      type: 'POLY',
      positions: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      handleLeft: null, handleRight: null,
      radii: [1, 1, 1, 1], tilts: [0, 0, 0, 0],
      cyclic: true, resolution: 12,
    });

    const result = def.evaluate(
      { mode: 'NGONS' },
      { 'Curve': geo }
    );

    assert.equal(result.outputs[0].mesh.faceCount, 1, 'NGONS should have 1 face');
    assert.equal(result.outputs[0].mesh.faceVertCounts[0], 4, 'face should be a quad');
  });
});

// ── Fillet Curve ─────────────────────────────────────────────────────────

describe('Fillet Curve', () => {
  it('should register fillet_curve', () => {
    const def = registry.getNodeDef('geo', 'fillet_curve');
    assert.ok(def);
    assert.equal(def.label, 'Fillet Curve');
  });

  it('should add points at corners', () => {
    const def = registry.getNodeDef('geo', 'fillet_curve');

    const geo = new GeometrySet();
    geo.curve = new CurveComponent();
    geo.curve.splines.push({
      type: 'POLY',
      positions: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      handleLeft: null, handleRight: null,
      radii: [1, 1, 1], tilts: [0, 0, 0],
      cyclic: false, resolution: 12,
    });

    const result = def.evaluate(
      { radius: 0.1, count: 3, mode: 'POLY' },
      { 'Curve': geo, 'Radius': 0.1, 'Count': 3 }
    );

    const curve = result.outputs[0].curve;
    assert.ok(curve, 'should output a curve');
    // Interior vertex (index 1) gets count+1 points, endpoints stay
    assert.ok(curve.splines[0].positions.length > 3, 'should have more points than original');
  });
});
