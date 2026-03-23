/**
 * Integration tests for newly implemented geometry nodes.
 *
 * Tests realistic pipelines involving subdivide mesh, subdivision surface,
 * sampling nodes, and other commonly-used nodes working together.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../../core/registry.js';
import { NodeGraph } from '../../core/graph.js';
import { GeometrySet } from '../../core/geometry.js';
import { isField, Field } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerCurveNodes } from '../../geo/nodes_v2_curves.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';
import { registerPointOpNodes } from '../../geo/nodes_v2_point_ops.js';
import { registerRotationNodes } from '../../geo/nodes_v2_rotation.js';
import { registerMeshOpNodes } from '../../geo/nodes_v2_mesh_ops.js';
import { registerUtilityNodes } from '../../geo/nodes_v2_utilities.js';
import { registerSamplingNodes } from '../../geo/nodes_v2_sampling.js';
import { registerMeshReadNodes } from '../../geo/nodes_v2_mesh_read.js';

before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerCurveNodes(registry);
  registerFieldNodes(registry);
  registerPointOpNodes(registry);
  registerRotationNodes(registry);
  registerMeshOpNodes(registry);
  registerUtilityNodes(registry);
  registerSamplingNodes(registry);
  registerMeshReadNodes(registry);
});

// Helper: evaluate a node directly
function evalNode(typeId, values, inputs) {
  const def = registry.getNodeDef('geo', typeId);
  if (!def) throw new Error(`Node not found: ${typeId}`);
  return def.evaluate(values, inputs);
}

// ── Subdivide Mesh Pipeline ──────────────────────────────────────────────

describe('Subdivide Mesh Pipeline', () => {
  it('should subdivide a cube and maintain structure', () => {
    // Create cube
    const cubeResult = evalNode('mesh_cube', { sizeX: 2, sizeY: 2, sizeZ: 2, verticesX: 2, verticesY: 2, verticesZ: 2 }, {});
    const cube = cubeResult.outputs[0];
    assert.ok(cube.mesh, 'cube should have mesh');
    const origVerts = cube.mesh.vertexCount;
    const origFaces = cube.mesh.faceCount;

    // Subdivide at level 1
    const subResult = evalNode('subdivide_mesh', { level: 1 }, {
      'Mesh': cube, 'Level': 1,
    });
    const subdMesh = subResult.outputs[0];
    assert.ok(subdMesh.mesh.vertexCount > origVerts, 'should have more vertices');
    assert.ok(subdMesh.mesh.faceCount > origFaces, 'should have more faces');

    // All faces should be quads
    for (const c of subdMesh.mesh.faceVertCounts) {
      assert.equal(c, 4, 'all faces should be quads after subdivision');
    }
  });

  it('should chain: Cube → Subdivide → Set Position (offset)', () => {
    const cube = evalNode('mesh_cube', { sizeX: 2, sizeY: 2, sizeZ: 2, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];
    const subd = evalNode('subdivide_mesh', { level: 1 }, {
      'Mesh': cube, 'Level': 1,
    }).outputs[0];

    // Use set_position with offset to shift all vertices
    const offset = { x: 5, y: 0, z: 0 };
    const shifted = evalNode('set_position', { domain: 'POINT' }, {
      'Geometry': subd, 'Selection': null, 'Position': null, 'Offset': offset,
    }).outputs[0];

    // All vertices should be shifted by x+5
    for (const p of shifted.mesh.positions) {
      assert.ok(p.x >= 3.5, `x should be >= 3.5, got ${p.x}`);
    }
  });
});

// ── Subdivision Surface Pipeline ─────────────────────────────────────────

describe('Subdivision Surface Pipeline', () => {
  it('should smooth a cube with Catmull-Clark', () => {
    const cube = evalNode('mesh_cube', { sizeX: 2, sizeY: 2, sizeZ: 2, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];
    let origMaxX = -Infinity;
    for (const p of cube.mesh.positions) if (p.x > origMaxX) origMaxX = p.x;

    const smooth = evalNode('subdivision_surface', {
      level: 1, boundary_smooth: 'ALL',
    }, {
      'Mesh': cube, 'Level': 1, 'Edge Crease': null, 'Vertex Crease': null,
    }).outputs[0];

    let newMaxX = -Infinity;
    for (const p of smooth.mesh.positions) if (p.x > newMaxX) newMaxX = p.x;

    assert.ok(newMaxX <= origMaxX + 0.01, `CC should not expand: ${newMaxX} <= ${origMaxX}`);
    assert.ok(smooth.mesh.faceCount > cube.mesh.faceCount, 'should have more faces');
  });

  it('should produce more vertices at higher levels', () => {
    const grid = evalNode('mesh_grid', { sizeX: 2, sizeY: 2, verticesX: 4, verticesY: 4 }, {}).outputs[0];

    const level1 = evalNode('subdivision_surface', {
      level: 1, boundary_smooth: 'ALL',
    }, {
      'Mesh': grid, 'Level': 1, 'Edge Crease': null, 'Vertex Crease': null,
    }).outputs[0];

    const level2 = evalNode('subdivision_surface', {
      level: 2, boundary_smooth: 'ALL',
    }, {
      'Mesh': grid, 'Level': 2, 'Edge Crease': null, 'Vertex Crease': null,
    }).outputs[0];

    assert.ok(level2.mesh.vertexCount > level1.mesh.vertexCount,
      'level 2 should have more vertices than level 1');
    assert.ok(level2.mesh.faceCount > level1.mesh.faceCount,
      'level 2 should have more faces than level 1');
  });
});

// ── Sampling Pipeline ────────────────────────────────────────────────────

describe('Sampling Pipeline', () => {
  it('should find nearest vertex on a mesh', () => {
    const grid = evalNode('mesh_grid', { sizeX: 2, sizeY: 2, verticesX: 4, verticesY: 4 }, {}).outputs[0];
    const nearestDef = registry.getNodeDef('geo', 'sample_nearest');

    const result = nearestDef.evaluate(
      { domain: 'POINT' },
      { 'Geometry': grid, 'Sample Position': null }
    );

    assert.ok(isField(result.outputs[0]), 'should return index field');

    // Query from a known position near vertex 0
    const idx = result.outputs[0].evaluateAt({
      position: { x: -0.49, y: -0.49, z: 0 },
      index: 0, count: 1,
      normal: { x: 0, y: 0, z: 1 },
    });
    assert.ok(typeof idx === 'number', 'should return a number');
    assert.ok(idx >= 0, 'index should be non-negative');
  });

  it('should compute proximity distance to a mesh', () => {
    const cube = evalNode('mesh_cube', { sizeX: 2, sizeY: 2, sizeZ: 2, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];
    const proxResult = evalNode('geometry_proximity', { target_element: 'POINTS' }, {
      'Target': cube, 'Source Position': null,
    });

    const distField = proxResult.outputs[1];
    assert.ok(isField(distField), 'distance should be a field');

    // Distance from a point near a corner to nearest vertex
    const dist = distField.evaluateAt({
      position: { x: 2, y: 2, z: 2 },
      index: 0, count: 1,
      normal: { x: 0, y: 0, z: 1 },
    });
    assert.ok(typeof dist === 'number', 'distance should be a number');
    assert.ok(dist >= 0, 'distance should be non-negative');
  });

  it('should sample attribute values at specific indices', () => {
    const grid = evalNode('mesh_grid', { sizeX: 2, sizeY: 2, verticesX: 4, verticesY: 4 }, {}).outputs[0];

    // Create a field that returns vertex index * 10
    const valueField = new Field('float', (el) => el.index * 10);

    const sampleResult = evalNode('sample_index', {
      data_type: 'FLOAT', domain: 'POINT', clamp: true,
    }, {
      'Geometry': grid, 'Value': valueField, 'Index': 2,
    });

    assert.ok(isField(sampleResult.outputs[0]), 'should return a field');
    // Evaluating should give index 2 value = 20
    const val = sampleResult.outputs[0].evaluateAt({ index: 0, count: 1, position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } });
    assert.equal(val, 20, 'should sample value at index 2');
  });
});

// ── Extrude + Instance Pipeline ──────────────────────────────────────────

describe('Extrude + Instance Pipeline', () => {
  it('should extrude faces and produce top/side selections', () => {
    const grid = evalNode('mesh_grid', { sizeX: 2, sizeY: 2, verticesX: 4, verticesY: 4 }, {}).outputs[0];
    const origVerts = grid.mesh.vertexCount;

    const extruded = evalNode('extrude_mesh', {
      mode: 'FACES', offset_scale: 0.5,
    }, {
      'Mesh': grid, 'Selection': null,
      'Offset': { x: 0, y: 0, z: 1 }, 'Offset Scale': 0.5, 'Individual': true,
    });

    const mesh = extruded.outputs[0].mesh;
    assert.ok(mesh, 'should have output mesh');
    assert.ok(mesh.vertexCount > origVerts, 'should add vertices');
    assert.ok(extruded.outputs[1] instanceof Field || typeof extruded.outputs[1] === 'boolean', 'Top should be field or bool');
    assert.ok(extruded.outputs[2] instanceof Field || typeof extruded.outputs[2] === 'boolean', 'Side should be field or bool');
  });
});

// ── Mesh Circle + Curve to Mesh Pipeline ─────────────────────────────────

describe('Mesh Circle + Curve Pipeline', () => {
  it('should create circle mesh with different fill types', () => {
    const none = evalNode('mesh_circle', {
      vertices: 12, radius: 1, fill_type: 'NONE',
    }, { 'Vertices': 12, 'Radius': 1 }).outputs[0];
    assert.equal(none.mesh.faceCount, 0);

    const ngon = evalNode('mesh_circle', {
      vertices: 12, radius: 1, fill_type: 'NGON',
    }, { 'Vertices': 12, 'Radius': 1 }).outputs[0];
    assert.equal(ngon.mesh.faceCount, 1);

    const fan = evalNode('mesh_circle', {
      vertices: 12, radius: 1, fill_type: 'TRIANGLE_FAN',
    }, { 'Vertices': 12, 'Radius': 1 }).outputs[0];
    assert.equal(fan.mesh.faceCount, 12);
  });

  it('should create a tube via Curve Circle → Curve to Mesh', () => {
    // Create a line curve (path)
    const line = evalNode('curve_line', {
      startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 2,
    }, {
      'Start': { x: 0, y: 0, z: 0 }, 'End': { x: 0, y: 0, z: 2 },
    }).outputs[0];

    // Create a circle curve (profile)
    const circle = evalNode('curve_circle', {}, {
      'Resolution': 8, 'Radius': 0.5,
    }).outputs[0];

    // Curve to mesh
    const tube = evalNode('curve_to_mesh', {}, {
      'Curve': line, 'Profile Curve': circle, 'Fill Caps': false,
    }).outputs[0];

    assert.ok(tube.mesh, 'should produce a mesh');
    assert.ok(tube.mesh.vertexCount > 0, 'mesh should have vertices');
    assert.ok(tube.mesh.faceCount > 0, 'mesh should have faces');
  });
});

// ── Texture Pipeline ─────────────────────────────────────────────────────

describe('Texture Pipeline', () => {
  it('should produce noise field values in [0,1]', () => {
    const posField = new Field('vector', (el) => el.position);
    const noiseResult = evalNode('noise_texture', {
      scale: 3, detail: 2, roughness: 0.5, lacunarity: 2, distortion: 0,
    }, {
      'Vector': posField, 'Scale': 3, 'Detail': 2,
      'Roughness': 0.5, 'Lacunarity': 2, 'Distortion': 0,
    });

    const noiseField = noiseResult.outputs[0]; // Fac field
    assert.ok(isField(noiseField), 'noise should produce a field');

    // Evaluate at several non-integer positions
    const positions = [
      { x: 0.3, y: 0.7, z: 0.1 },
      { x: 1.5, y: 2.3, z: 0.8 },
      { x: -0.5, y: 0.9, z: 1.2 },
    ];
    for (const pos of positions) {
      const val = noiseField.evaluateAt({
        position: pos, index: 0, count: 1, normal: { x: 0, y: 0, z: 1 },
      });
      assert.ok(val >= 0 && val <= 1, `noise value should be in [0,1], got ${val}`);
    }
  });
});

// ── Switch and Mix Pipeline ──────────────────────────────────────────────

describe('Switch and Mix Pipeline', () => {
  it('should switch between two geometries', () => {
    const cube = evalNode('mesh_cube', { sizeX: 2, sizeY: 2, sizeZ: 2, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];
    const grid = evalNode('mesh_grid', { sizeX: 2, sizeY: 2, verticesX: 4, verticesY: 4 }, {}).outputs[0];

    const result = evalNode('switch', { input_type: 'GEOMETRY' }, {
      'Switch': true, 'False': cube, 'True': grid,
    });

    // Should get the grid (true)
    assert.equal(result.outputs[0].mesh.faceCount, grid.mesh.faceCount);
  });

  it('should mix float values', () => {
    const result = evalNode('mix', { data_type: 'FLOAT', clamp_factor: true }, {
      'Factor': 0.25, 'A': 0, 'B': 100,
    });
    assert.equal(result.outputs[0], 25);
  });
});

// ── Bounding Box Pipeline ────────────────────────────────────────────────

describe('Bounding Box Pipeline', () => {
  it('should compute correct bounds for a cube', () => {
    const cube = evalNode('mesh_cube', { sizeX: 2, sizeY: 2, sizeZ: 2, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];

    const bbox = evalNode('bounding_box', {}, {
      'Geometry': cube,
    });

    const boxGeo = bbox.outputs[0];
    const min = bbox.outputs[1];
    const max = bbox.outputs[2];

    assert.ok(boxGeo.mesh, 'should output box mesh');
    assert.equal(boxGeo.mesh.vertexCount, 8, 'box should have 8 vertices');
    assert.ok(min.x < 0, 'min.x should be negative for centered cube');
    assert.ok(max.x > 0, 'max.x should be positive for centered cube');
    assert.ok(Math.abs(min.x + max.x) < 0.01, 'cube should be centered');
  });
});

// ── Triangulate Pipeline ─────────────────────────────────────────────────

describe('Triangulate Pipeline', () => {
  it('should triangulate a grid', () => {
    const grid = evalNode('mesh_grid', { sizeX: 2, sizeY: 2, verticesX: 4, verticesY: 4 }, {}).outputs[0];
    const origFaces = grid.mesh.faceCount;

    const tris = evalNode('triangulate', {
      quad_method: 'SHORT_EDGE', ngon_method: 'BEAUTY',
    }, {
      'Mesh': grid, 'Selection': null,
    }).outputs[0];

    // All faces should be triangles
    for (const c of tris.mesh.faceVertCounts) {
      assert.equal(c, 3, 'all faces should be triangles');
    }
    // Each quad becomes 2 triangles
    assert.equal(tris.mesh.faceCount, origFaces * 2);
  });
});

// ── Domain Size Pipeline ─────────────────────────────────────────────────

describe('Domain Size Pipeline', () => {
  it('should report correct sizes for a subdivided cube', () => {
    const cube = evalNode('mesh_cube', { sizeX: 2, sizeY: 2, sizeZ: 2, verticesX: 2, verticesY: 2, verticesZ: 2 }, {}).outputs[0];
    const subd = evalNode('subdivide_mesh', { level: 1 }, {
      'Mesh': cube, 'Level': 1,
    }).outputs[0];

    const sizes = evalNode('domain_size', {}, {
      'Geometry': subd,
    });

    const [points, edges, faces, corners, splines, instances] = sizes.outputs;
    assert.ok(points > 0);
    assert.ok(edges > 0);
    assert.ok(faces > 0);
    assert.ok(corners > 0);
    assert.equal(splines, 0);
    assert.equal(instances, 0);
  });
});

// ── Full Registration Check ──────────────────────────────────────────────

describe('Full Node Registration', () => {
  it('should have all key user-requested nodes registered', () => {
    const required = [
      'subdivide_mesh', 'subdivision_surface',
      'geometry_proximity', 'sample_index', 'sample_nearest', 'sample_nearest_surface',
      'extrude_mesh', 'triangulate', 'merge_by_distance', 'bounding_box',
      'set_shade_smooth', 'separate_geometry', 'noise_texture', 'switch',
      'mix', 'capture_attribute', 'duplicate_elements',
      'translate_instances', 'scale_instances', 'rotate_instances',
    ];

    for (const nodeId of required) {
      assert.ok(registry.getNodeDef('geo', nodeId), `${nodeId} should be registered`);
    }
  });

  it('should have at least 150 geometry nodes registered', () => {
    const allNodes = registry.getNodeTypes('geo');
    const count = Object.keys(allNodes).length;
    assert.ok(count >= 150, `should have 150+ nodes, got ${count}`);
  });
});
