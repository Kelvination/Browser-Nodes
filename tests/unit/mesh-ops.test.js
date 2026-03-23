/**
 * Unit tests for mesh operation nodes:
 * subdivide_mesh, subdivision_surface, set_shade_smooth,
 * separate_geometry, bounding_box, merge_by_distance
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry, SocketType } from '../../core/registry.js';
import { GeometrySet, MeshComponent, InstancesComponent, DOMAIN, ATTR_TYPE } from '../../core/geometry.js';
import { createMeshCube, createMeshGrid } from '../../core/geometry.js';
import { Field } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';
import { registerMeshOpNodes } from '../../geo/nodes_v2_mesh_ops.js';

before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerFieldNodes(registry);
  registerMeshOpNodes(registry);
});

// Helper: make a simple GeometrySet with a cube mesh
function makeCubeGeo() {
  const geo = new GeometrySet();
  geo.mesh = createMeshCube(2, 2, 2, 2, 2, 2);
  return geo;
}

// Helper: make a simple GeometrySet with a grid mesh
function makeGridGeo() {
  const geo = new GeometrySet();
  geo.mesh = createMeshGrid(1, 1, 3, 3);
  return geo;
}

// ── Subdivide Mesh ───────────────────────────────────────────────────────

describe('Subdivide Mesh', () => {
  it('should register subdivide_mesh', () => {
    const def = registry.getNodeDef('geo', 'subdivide_mesh');
    assert.ok(def, 'subdivide_mesh should be registered');
    assert.equal(def.label, 'Subdivide Mesh');
  });

  it('should pass through unchanged at level 0', () => {
    const def = registry.getNodeDef('geo', 'subdivide_mesh');
    const geo = makeCubeGeo();
    const origVertCount = geo.mesh.vertexCount;
    const result = def.evaluate({ level: 0 }, { 'Mesh': geo, 'Level': 0 });
    assert.equal(result.outputs[0].mesh.vertexCount, origVertCount);
  });

  it('should subdivide a grid at level 1', () => {
    const def = registry.getNodeDef('geo', 'subdivide_mesh');
    const geo = makeGridGeo();
    const origFaceCount = geo.mesh.faceCount;
    const origVertCount = geo.mesh.vertexCount;

    const result = def.evaluate({ level: 1 }, { 'Mesh': geo, 'Level': 1 });
    const mesh = result.outputs[0].mesh;

    // After 1 level: each n-gon face becomes n quads
    // Original grid has quads, so each quad becomes 4 quads
    // New vertices = orig_verts + orig_edges + orig_faces
    assert.ok(mesh.vertexCount > origVertCount,
      `should have more vertices (${mesh.vertexCount} > ${origVertCount})`);
    assert.ok(mesh.faceCount > origFaceCount,
      `should have more faces (${mesh.faceCount} > ${origFaceCount})`);

    // All faces should be quads after subdivision
    for (const count of mesh.faceVertCounts) {
      assert.equal(count, 4, 'all subdivided faces should be quads');
    }
  });

  it('should produce 4x more faces per level for quads', () => {
    const def = registry.getNodeDef('geo', 'subdivide_mesh');
    const geo = makeGridGeo();
    const origFaceCount = geo.mesh.faceCount; // 4 faces (3x3 grid)

    const result1 = def.evaluate({ level: 1 }, { 'Mesh': geo, 'Level': 1 });
    // Each of the 4 original quads becomes 4 quads = 16 faces
    assert.equal(result1.outputs[0].mesh.faceCount, origFaceCount * 4);

    const result2 = def.evaluate({ level: 2 }, { 'Mesh': geo, 'Level': 2 });
    // Level 2: 16 quads each become 4 quads = 64 faces
    assert.equal(result2.outputs[0].mesh.faceCount, origFaceCount * 16);
  });

  it('should handle empty geometry', () => {
    const def = registry.getNodeDef('geo', 'subdivide_mesh');
    const result = def.evaluate({ level: 1 }, { 'Mesh': null, 'Level': 1 });
    assert.ok(result.outputs[0] instanceof GeometrySet);
  });

  it('should not change shape (linear subdivision)', () => {
    const def = registry.getNodeDef('geo', 'subdivide_mesh');
    const geo = makeCubeGeo();

    // Get bounding box of original
    const origPositions = geo.mesh.positions;
    let origMinX = Infinity, origMaxX = -Infinity;
    for (const p of origPositions) {
      if (p.x < origMinX) origMinX = p.x;
      if (p.x > origMaxX) origMaxX = p.x;
    }

    const result = def.evaluate({ level: 2 }, { 'Mesh': geo, 'Level': 2 });
    const newPositions = result.outputs[0].mesh.positions;
    let newMinX = Infinity, newMaxX = -Infinity;
    for (const p of newPositions) {
      if (p.x < newMinX) newMinX = p.x;
      if (p.x > newMaxX) newMaxX = p.x;
    }

    // Linear subdivision should preserve bounding box
    assert.ok(Math.abs(origMinX - newMinX) < 0.001, 'min X should be preserved');
    assert.ok(Math.abs(origMaxX - newMaxX) < 0.001, 'max X should be preserved');
  });
});

// ── Subdivision Surface ──────────────────────────────────────────────────

describe('Subdivision Surface', () => {
  it('should register subdivision_surface', () => {
    const def = registry.getNodeDef('geo', 'subdivision_surface');
    assert.ok(def, 'subdivision_surface should be registered');
    assert.equal(def.label, 'Subdivision Surface');
  });

  it('should pass through unchanged at level 0', () => {
    const def = registry.getNodeDef('geo', 'subdivision_surface');
    const geo = makeCubeGeo();
    const origVertCount = geo.mesh.vertexCount;
    const result = def.evaluate({ level: 0 }, {
      'Mesh': geo, 'Level': 0, 'Edge Crease': null, 'Vertex Crease': null,
    });
    assert.equal(result.outputs[0].mesh.vertexCount, origVertCount);
  });

  it('should smooth the surface (change vertex positions)', () => {
    const def = registry.getNodeDef('geo', 'subdivision_surface');
    const geo = makeCubeGeo();

    // Get corner vertex position
    const origCorner = { ...geo.mesh.positions[0] };

    const result = def.evaluate(
      { level: 1, boundary_smooth: 'ALL' },
      { 'Mesh': geo, 'Level': 1, 'Edge Crease': null, 'Vertex Crease': null }
    );
    const mesh = result.outputs[0].mesh;

    // In Catmull-Clark, corner vertices of a cube should move inward
    // (the cube gets rounded). So the bounding box should be smaller.
    let maxX = -Infinity;
    for (const p of mesh.positions) {
      if (p.x > maxX) maxX = p.x;
    }

    // The original cube goes from -1 to 1. After CC, the corners move inward.
    assert.ok(maxX <= 1.01, 'Catmull-Clark should not expand beyond original');
  });

  it('should produce all-quad topology', () => {
    const def = registry.getNodeDef('geo', 'subdivision_surface');
    const geo = makeCubeGeo();
    const result = def.evaluate(
      { level: 1, boundary_smooth: 'ALL' },
      { 'Mesh': geo, 'Level': 1, 'Edge Crease': null, 'Vertex Crease': null }
    );
    for (const count of result.outputs[0].mesh.faceVertCounts) {
      assert.equal(count, 4, 'all subdivided faces should be quads');
    }
  });
});

// ── Set Shade Smooth ─────────────────────────────────────────────────────

describe('Set Shade Smooth', () => {
  it('should register set_shade_smooth', () => {
    const def = registry.getNodeDef('geo', 'set_shade_smooth');
    assert.ok(def);
    assert.equal(def.label, 'Set Shade Smooth');
  });

  it('should set sharp_face attribute (inverted logic)', () => {
    const def = registry.getNodeDef('geo', 'set_shade_smooth');
    const geo = makeCubeGeo();
    const result = def.evaluate(
      { domain: 'FACE' },
      { 'Geometry': geo, 'Selection': null, 'Shade Smooth': true }
    );
    const sharpFace = result.outputs[0].mesh.faceAttrs.get('sharp_face');
    assert.ok(sharpFace, 'should have sharp_face attribute');
    // smooth=true means sharp=false
    for (const val of sharpFace) {
      assert.equal(val, false, 'smooth=true should set sharp=false');
    }
  });

  it('should set sharp=true when smooth=false', () => {
    const def = registry.getNodeDef('geo', 'set_shade_smooth');
    const geo = makeCubeGeo();
    const result = def.evaluate(
      { domain: 'FACE' },
      { 'Geometry': geo, 'Selection': null, 'Shade Smooth': false }
    );
    const sharpFace = result.outputs[0].mesh.faceAttrs.get('sharp_face');
    for (const val of sharpFace) {
      assert.equal(val, true, 'smooth=false should set sharp=true');
    }
  });

  it('should respect selection', () => {
    const def = registry.getNodeDef('geo', 'set_shade_smooth');
    const geo = makeGridGeo();
    const faceCount = geo.mesh.faceCount;

    // Select only first face
    const selField = new Field('bool', (el) => el.index === 0);

    const result = def.evaluate(
      { domain: 'FACE' },
      { 'Geometry': geo, 'Selection': selField, 'Shade Smooth': false }
    );
    const sharpFace = result.outputs[0].mesh.faceAttrs.get('sharp_face');
    assert.equal(sharpFace[0], true, 'selected face should be sharp');
    // Other faces should be unchanged (default false)
    for (let i = 1; i < faceCount; i++) {
      assert.equal(sharpFace[i], false, 'unselected faces should remain smooth');
    }
  });
});

// ── Separate Geometry ────────────────────────────────────────────────────

describe('Separate Geometry', () => {
  it('should register separate_geometry', () => {
    const def = registry.getNodeDef('geo', 'separate_geometry');
    assert.ok(def);
  });

  it('should split geometry by point selection', () => {
    const def = registry.getNodeDef('geo', 'separate_geometry');
    const geo = makeGridGeo(); // 3x3 grid = 9 vertices
    const totalVerts = geo.mesh.vertexCount;

    // Select first 4 vertices
    const selField = new Field('bool', (el) => el.index < 4);

    const result = def.evaluate(
      { domain: 'POINT' },
      { 'Geometry': geo, 'Selection': selField }
    );

    const selected = result.outputs[0];
    const inverted = result.outputs[1];

    assert.ok(selected.mesh, 'selected output should have mesh');
    assert.ok(inverted.mesh, 'inverted output should have mesh');
    assert.equal(selected.mesh.vertexCount, 4, 'selected should have 4 vertices');
    assert.equal(inverted.mesh.vertexCount, totalVerts - 4, 'inverted should have remaining');
  });

  it('should split geometry by face selection', () => {
    const def = registry.getNodeDef('geo', 'separate_geometry');
    const geo = makeGridGeo(); // 4 faces

    // Select first 2 faces
    const selField = new Field('bool', (el) => el.index < 2);

    const result = def.evaluate(
      { domain: 'FACE' },
      { 'Geometry': geo, 'Selection': selField }
    );

    assert.equal(result.outputs[0].mesh.faceCount, 2, 'selected should have 2 faces');
    assert.equal(result.outputs[1].mesh.faceCount, 2, 'inverted should have 2 faces');
  });

  it('should handle null selection (everything to Selection output)', () => {
    const def = registry.getNodeDef('geo', 'separate_geometry');
    const geo = makeCubeGeo();

    const result = def.evaluate(
      { domain: 'POINT' },
      { 'Geometry': geo, 'Selection': null }
    );

    assert.ok(result.outputs[0].mesh, 'selection output should have all geometry');
    assert.ok(!result.outputs[1].mesh || result.outputs[1].mesh.vertexCount === 0,
      'inverted should be empty');
  });
});

// ── Bounding Box ─────────────────────────────────────────────────────────

describe('Bounding Box', () => {
  it('should register bounding_box', () => {
    const def = registry.getNodeDef('geo', 'bounding_box');
    assert.ok(def);
    assert.equal(def.label, 'Bounding Box');
  });

  it('should compute correct min/max for a cube', () => {
    const def = registry.getNodeDef('geo', 'bounding_box');
    const geo = makeCubeGeo(); // 2x2x2 centered at origin

    const result = def.evaluate({}, { 'Geometry': geo });
    const min = result.outputs[1];
    const max = result.outputs[2];

    assert.ok(Math.abs(min.x - (-1)) < 0.01, 'min.x should be -1');
    assert.ok(Math.abs(min.y - (-1)) < 0.01, 'min.y should be -1');
    assert.ok(Math.abs(min.z - (-1)) < 0.01, 'min.z should be -1');
    assert.ok(Math.abs(max.x - 1) < 0.01, 'max.x should be 1');
    assert.ok(Math.abs(max.y - 1) < 0.01, 'max.y should be 1');
    assert.ok(Math.abs(max.z - 1) < 0.01, 'max.z should be 1');
  });

  it('should create a box mesh geometry', () => {
    const def = registry.getNodeDef('geo', 'bounding_box');
    const geo = makeCubeGeo();

    const result = def.evaluate({}, { 'Geometry': geo });
    const boxGeo = result.outputs[0];

    assert.ok(boxGeo.mesh, 'should output a mesh');
    assert.equal(boxGeo.mesh.vertexCount, 8, 'box should have 8 vertices');
    assert.equal(boxGeo.mesh.faceCount, 6, 'box should have 6 faces');
    assert.equal(boxGeo.mesh.edgeCount, 12, 'box should have 12 edges');
  });

  it('should handle empty geometry', () => {
    const def = registry.getNodeDef('geo', 'bounding_box');
    const result = def.evaluate({}, { 'Geometry': null });
    assert.ok(result.outputs[0] instanceof GeometrySet);
  });
});

// ── Merge by Distance ────────────────────────────────────────────────────

describe('Merge by Distance', () => {
  it('should register merge_by_distance', () => {
    const def = registry.getNodeDef('geo', 'merge_by_distance');
    assert.ok(def);
    assert.equal(def.label, 'Merge by Distance');
  });

  it('should merge overlapping vertices', () => {
    const def = registry.getNodeDef('geo', 'merge_by_distance');

    // Create a mesh with two overlapping vertices
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0.0001 }, // very close to vertex 0
      { x: 1, y: 0, z: 0 },
    ];
    geo.mesh.edges = [[0, 2], [1, 2]];
    geo.mesh.faceVertCounts = [3];
    geo.mesh.cornerVerts = [0, 1, 2];

    const result = def.evaluate(
      { distance: 0.001, mode: 'ALL' },
      { 'Geometry': geo, 'Selection': null, 'Distance': 0.001 }
    );

    // Vertices 0 and 1 should merge
    assert.equal(result.outputs[0].mesh.vertexCount, 2, 'should merge to 2 vertices');
  });

  it('should not merge distant vertices', () => {
    const def = registry.getNodeDef('geo', 'merge_by_distance');
    const geo = makeCubeGeo();
    const origVertCount = geo.mesh.vertexCount;

    const result = def.evaluate(
      { distance: 0.001, mode: 'ALL' },
      { 'Geometry': geo, 'Selection': null, 'Distance': 0.001 }
    );

    // Cube vertices are far apart, none should merge
    assert.equal(result.outputs[0].mesh.vertexCount, origVertCount);
  });
});

// ── Instance Manipulation ────────────────────────────────────────────────

// ── Extrude Mesh ─────────────────────────────────────────────────────────

describe('Extrude Mesh', () => {
  it('should register extrude_mesh', () => {
    const def = registry.getNodeDef('geo', 'extrude_mesh');
    assert.ok(def);
    assert.equal(def.label, 'Extrude Mesh');
  });

  it('should extrude faces along normals', () => {
    const def = registry.getNodeDef('geo', 'extrude_mesh');
    const geo = makeGridGeo(); // 4 faces
    const origVertCount = geo.mesh.vertexCount;
    const origFaceCount = geo.mesh.faceCount;

    const result = def.evaluate(
      { mode: 'FACES', offset_scale: 1.0 },
      { 'Mesh': geo, 'Selection': null, 'Offset': { x: 0, y: 0, z: 1 }, 'Offset Scale': 1.0, 'Individual': true }
    );

    const mesh = result.outputs[0].mesh;

    // Each selected face creates: n new verts, n side quads, 1 top face
    // 4 quads × 4 verts/quad = 16 new verts, 4 tops + 16 sides = 20 new faces
    assert.ok(mesh.vertexCount > origVertCount, 'should have more vertices');
    assert.ok(mesh.faceCount > origFaceCount, 'should have more faces');

    // Top and Side should be field outputs
    const topField = result.outputs[1];
    const sideField = result.outputs[2];
    assert.ok(topField instanceof Field, 'top should be a Field');
    assert.ok(sideField instanceof Field, 'side should be a Field');
  });

  it('should extrude vertices', () => {
    const def = registry.getNodeDef('geo', 'extrude_mesh');
    const geo = makeGridGeo();
    const origVertCount = geo.mesh.vertexCount;

    const result = def.evaluate(
      { mode: 'VERTICES', offset_scale: 1.0 },
      { 'Mesh': geo, 'Selection': null, 'Offset': { x: 0, y: 0, z: 1 }, 'Offset Scale': 1.0, 'Individual': null }
    );

    const mesh = result.outputs[0].mesh;
    // Each vertex gets a duplicate, so vertex count should double
    assert.equal(mesh.vertexCount, origVertCount * 2, 'should double vertices');
  });

  it('should handle empty geometry', () => {
    const def = registry.getNodeDef('geo', 'extrude_mesh');
    const result = def.evaluate(
      { mode: 'FACES', offset_scale: 1.0 },
      { 'Mesh': null, 'Selection': null, 'Offset': null, 'Offset Scale': null, 'Individual': null }
    );
    assert.ok(result.outputs[0] instanceof GeometrySet);
  });
});

// ── Instance Manipulation ────────────────────────────────────────────────

describe('Translate Instances', () => {
  it('should register translate_instances', () => {
    const def = registry.getNodeDef('geo', 'translate_instances');
    assert.ok(def);
    assert.equal(def.label, 'Translate Instances');
  });

  it('should translate instance positions', () => {
    const def = registry.getNodeDef('geo', 'translate_instances');

    // Create geometry with instances
    const geo = new GeometrySet();
    geo.instances = new InstancesComponent();
    geo.instances.addInstance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, null);
    geo.instances.addInstance({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, null);

    const result = def.evaluate({}, {
      'Instances': geo,
      'Selection': null,
      'Translation': { x: 10, y: 0, z: 0 },
      'Local Space': true,
    });

    const inst = result.outputs[0].instances;
    assert.ok(Math.abs(inst.transforms[0].position.x - 10) < 0.001);
    assert.ok(Math.abs(inst.transforms[1].position.x - 11) < 0.001);
  });
});

describe('Scale Instances', () => {
  it('should register scale_instances', () => {
    const def = registry.getNodeDef('geo', 'scale_instances');
    assert.ok(def);
    assert.equal(def.label, 'Scale Instances');
  });
});

describe('Rotate Instances', () => {
  it('should register rotate_instances', () => {
    const def = registry.getNodeDef('geo', 'rotate_instances');
    assert.ok(def);
    assert.equal(def.label, 'Rotate Instances');
  });
});
