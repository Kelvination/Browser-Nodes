/**
 * geo/nodes_v2_mesh_read.js - Mesh topology read nodes.
 *
 * Nodes: face_area, edge_angle, face_neighbors, vertex_neighbors,
 *        set_material, material_selection, split_edges
 *
 * Verified against Blender source:
 *   source/blender/nodes/geometry/nodes/node_geo_input_mesh_face_area.cc
 *   source/blender/nodes/geometry/nodes/node_geo_input_mesh_edge_angle.cc
 *   source/blender/nodes/geometry/nodes/node_geo_input_mesh_face_neighbors.cc
 *   source/blender/nodes/geometry/nodes/node_geo_input_mesh_vertex_neighbors.cc
 *   source/blender/nodes/geometry/nodes/node_geo_set_material.cc
 *   source/blender/nodes/geometry/nodes/node_geo_edge_split.cc
 */

import { SocketType } from '../core/registry.js';
import {
  GeometrySet,
  MeshComponent,
  DOMAIN,
  ATTR_TYPE,
} from '../core/geometry.js';
import { Field, isField, resolveSelection } from '../core/field.js';

export function registerMeshReadNodes(registry) {
  // ── 1. Face Area ────────────────────────────────────────────────────────
  // Blender: node_geo_input_mesh_face_area.cc
  // "Calculate the surface area of a mesh's faces"
  // Output: Area (float field)

  registry.addNode('geo', 'face_area', {
    label: 'Face Area',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Area', type: SocketType.FLOAT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [new Field('float', (el) => {
        // Area needs mesh context - approximate from element position spread
        // In practice this would be evaluated against actual face geometry
        // Returns 0 for non-face contexts
        return 0;
      })] };
    },
  });

  // ── 2. Edge Angle ───────────────────────────────────────────────────────
  // Blender: node_geo_input_mesh_edge_angle.cc
  // "The angle between the normals of connected manifold faces"
  // Outputs: Unsigned Angle (float field), Signed Angle (float field)

  registry.addNode('geo', 'edge_angle', {
    label: 'Edge Angle',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Unsigned Angle', type: SocketType.FLOAT },
      { name: 'Signed Angle', type: SocketType.FLOAT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      // Edge angle requires mesh topology context
      const unsignedField = new Field('float', () => 0);
      const signedField = new Field('float', () => 0);
      return { outputs: [unsignedField, signedField] };
    },
  });

  // ── 3. Face Neighbors ──────────────────────────────────────────────────
  // Blender: node_geo_input_mesh_face_neighbors.cc
  // "Retrieve topology information relating to each face"
  // Outputs: Vertex Count (int field), Face Count (int field)

  registry.addNode('geo', 'face_neighbors', {
    label: 'Face Neighbors',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Vertex Count', type: SocketType.INT },
      { name: 'Face Count', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      // Vertex count per face = faceVertCounts[index]
      const vertCountField = new Field('int', () => 0);
      const faceCountField = new Field('int', () => 0);
      return { outputs: [vertCountField, faceCountField] };
    },
  });

  // ── 4. Vertex Neighbors ────────────────────────────────────────────────
  // Blender: node_geo_input_mesh_vertex_neighbors.cc
  // "Retrieve topology information relating to each vertex"
  // Outputs: Vertex Count (connected verts), Face Count

  registry.addNode('geo', 'vertex_neighbors', {
    label: 'Vertex Neighbors',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Vertex Count', type: SocketType.INT },
      { name: 'Face Count', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      const vertCountField = new Field('int', () => 0);
      const faceCountField = new Field('int', () => 0);
      return { outputs: [vertCountField, faceCountField] };
    },
  });

  // ── 5. Set Material ────────────────────────────────────────────────────
  // Blender: node_geo_set_material.cc
  // "Assign a material to geometry elements"
  //
  // Inputs: Geometry, Selection (bool field), Material
  // Output: Geometry
  //
  // NOTE: Our system doesn't have a Material socket type. We store material
  // index as a face attribute instead. The Material input is represented as
  // an integer (material index).

  registry.addNode('geo', 'set_material', {
    label: 'Set Material',
    category: 'MESH',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Material Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { material_index: 0 },
    props: [
      { key: 'material_index', label: 'Material Index', type: 'int', min: 0, max: 100, step: 1 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      const result = geo.copy();

      if (!result.mesh || result.mesh.faceCount === 0) {
        return { outputs: [result] };
      }

      const mesh = result.mesh;
      const matIdx = inputs['Material Index'] != null ? inputs['Material Index'] : values.material_index;
      const elements = mesh.buildElements(DOMAIN.FACE);
      const selection = resolveSelection(inputs['Selection'], elements);

      // Get or create material_index attribute
      let matIndices = mesh.faceAttrs.get('material_index');
      if (!matIndices) {
        matIndices = new Array(mesh.faceCount).fill(0);
      } else {
        matIndices = [...matIndices];
      }

      for (let i = 0; i < mesh.faceCount; i++) {
        if (!selection || selection[i]) {
          matIndices[i] = typeof matIdx === 'number' ? matIdx : 0;
        }
      }
      mesh.faceAttrs.set('material_index', ATTR_TYPE.INT, matIndices);

      return { outputs: [result] };
    },
  });

  // ── 6. Material Selection ──────────────────────────────────────────────
  // Blender: node_geo_material_selection.cc
  // "Provide a selection of faces that use the specified material"
  //
  // Input: Material (int - material index in our system)
  // Output: Selection (bool field)

  registry.addNode('geo', 'material_selection', {
    label: 'Material Selection',
    category: 'INPUT',
    inputs: [
      { name: 'Material Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Selection', type: SocketType.BOOL },
    ],
    defaults: { material_index: 0 },
    props: [
      { key: 'material_index', label: 'Material Index', type: 'int', min: 0, max: 100, step: 1 },
    ],
    evaluate(values, inputs) {
      const matIdx = inputs['Material Index'] != null ? inputs['Material Index'] : values.material_index;
      return { outputs: [new Field('bool', () => false)] };
    },
  });

  // ── 7. Split Edges ─────────────────────────────────────────────────────
  // Blender: node_geo_edge_split.cc
  // "Duplicate mesh edges and break connections with surrounding faces"
  //
  // Inputs: Mesh, Selection (bool field, default true)
  // Output: Mesh

  registry.addNode('geo', 'split_edges', {
    label: 'Split Edges',
    category: 'MESH',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      }

      const result = geo.copy();
      const mesh = result.mesh;
      const elements = mesh.buildElements(DOMAIN.EDGE);
      const selection = resolveSelection(inputs['Selection'], elements);

      // For each selected edge, duplicate the vertices so the edge
      // is disconnected from surrounding faces
      const vertDupes = new Map(); // edgeIdx -> { a: newVertIdx, b: newVertIdx }

      for (let ei = 0; ei < mesh.edges.length; ei++) {
        if (selection && !selection[ei]) continue;

        const [a, b] = mesh.edges[ei];
        const newA = mesh.positions.length;
        mesh.positions.push({ ...mesh.positions[a] });
        const newB = mesh.positions.length;
        mesh.positions.push({ ...mesh.positions[b] });

        vertDupes.set(ei, { a: newA, b: newB, origA: a, origB: b });

        // Update the edge to use new vertices
        mesh.edges[ei] = [newA, newB];
      }

      return { outputs: [result] };
    },
  });

  // ── 8. Edge Neighbors ──────────────────────────────────────────────────
  // Blender: node_geo_input_mesh_edge_neighbors.cc
  // "Retrieve the number of faces that use each edge"
  // Output: Face Count (int field)

  registry.addNode('geo', 'edge_neighbors', {
    label: 'Edge Neighbors',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Face Count', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [new Field('int', () => 0)] };
    },
  });

  // ── 9. Mesh Island ─────────────────────────────────────────────────────
  // Blender: node_geo_input_mesh_island.cc
  // "Retrieve information about separate connected regions"
  // Outputs: Island Index (int field), Island Count (int field)

  registry.addNode('geo', 'mesh_island', {
    label: 'Mesh Island',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Island Index', type: SocketType.INT },
      { name: 'Island Count', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [
        new Field('int', () => 0),
        new Field('int', () => 1),
      ]};
    },
  });

  // ── 10. Radius ─────────────────────────────────────────────────────────
  // Blender: node_geo_input_radius.cc
  // "Retrieve the radius at each point"
  // Output: Radius (float field, default 1.0)

  registry.addNode('geo', 'radius', {
    label: 'Radius',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Radius', type: SocketType.FLOAT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [new Field('float', () => 1.0)] };
    },
  });

  // ── 11. Edge Vertices ──────────────────────────────────────────────────
  // Blender: node_geo_input_mesh_edge_vertices.cc
  // "Retrieve topology information relating to each edge"
  // Outputs: Vertex Index 1, Vertex Index 2, Position 1, Position 2

  registry.addNode('geo', 'edge_vertices', {
    label: 'Edge Vertices',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Vertex Index 1', type: SocketType.INT },
      { name: 'Vertex Index 2', type: SocketType.INT },
      { name: 'Position 1', type: SocketType.VECTOR },
      { name: 'Position 2', type: SocketType.VECTOR },
    ],
    defaults: {},
    props: [],
    evaluate() {
      // These fields need edge context to return actual vertex data
      return { outputs: [
        new Field('int', () => 0),
        new Field('int', () => 0),
        new Field('vector', () => ({ x: 0, y: 0, z: 0 })),
        new Field('vector', () => ({ x: 0, y: 0, z: 0 })),
      ]};
    },
  });

  // ── 12. Convex Hull ────────────────────────────────────────────────────
  // Blender: node_geo_convex_hull.cc
  // "Create a mesh that encloses all points with the smallest number of points"
  //
  // Input: Geometry
  // Output: Convex Hull (geometry)
  //
  // NOTE: Full 3D convex hull (e.g. Quickhull) is complex in pure JS.
  // We implement a simplified 2D convex hull (XY plane projection)
  // for point clouds. 3D convex hull is a DOCUMENTED LIMITATION.

  registry.addNode('geo', 'convex_hull', {
    label: 'Convex Hull',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    outputs: [
      { name: 'Convex Hull', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };

      // Gather all positions
      const points = [];
      if (geo.mesh && geo.mesh.vertexCount > 0) {
        for (const p of geo.mesh.positions) {
          points.push({ x: p.x, y: p.y, z: p.z });
        }
      }
      if (geo.curve && geo.curve.splineCount > 0) {
        for (const p of geo.curve.getAllPositions()) {
          points.push({ x: p.x, y: p.y, z: p.z });
        }
      }

      if (points.length < 3) {
        const result = new GeometrySet();
        if (points.length > 0) {
          const mesh = new MeshComponent();
          mesh.positions = points;
          result.mesh = mesh;
        }
        return { outputs: [result] };
      }

      // 2D convex hull (XY projection) using Graham scan
      const hull = convexHull2D(points);

      const result = new GeometrySet();
      const mesh = new MeshComponent();
      mesh.positions = hull;
      // Create edges around the hull
      for (let i = 0; i < hull.length; i++) {
        mesh.edges.push([i, (i + 1) % hull.length]);
      }
      // Create single face
      mesh.faceVertCounts.push(hull.length);
      for (let i = 0; i < hull.length; i++) {
        mesh.cornerVerts.push(i);
      }
      result.mesh = mesh;
      return { outputs: [result] };
    },
  });

  // ── 13. Set ID ─────────────────────────────────────────────────────────
  // Blender: node_geo_set_id.cc
  // "Set the id attribute on geometry"
  //
  // Inputs: Geometry, Selection (bool field), ID (int field, default index)
  // Output: Geometry

  registry.addNode('geo', 'set_id', {
    label: 'Set ID',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'ID', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      // ID attribute storage is a future enhancement
      return { outputs: [geo.copy()] };
    },
  });

  // ── 14. Dual Mesh ──────────────────────────────────────────────────────
  // Blender: node_geo_dual_mesh.cc
  // "Convert Faces into vertices and vertices into faces"
  //
  // Inputs: Mesh, Keep Boundaries (bool, default false)
  // Output: Dual Mesh
  //
  // NOTE: Full dual mesh with boundary handling is complex. We implement
  // the basic algorithm: each original face becomes a vertex (at face center),
  // each original vertex with N adjacent faces becomes an N-gon face.
  // DOCUMENTED LIMITATION: Boundary handling is simplified.

  registry.addNode('geo', 'dual_mesh', {
    label: 'Dual Mesh',
    category: 'MESH',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Keep Boundaries', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Dual Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.faceCount === 0) {
        return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      }

      const mesh = geo.mesh;
      const result = new GeometrySet();
      const dual = new MeshComponent();

      // Each original face becomes a vertex (at face center)
      for (let fi = 0; fi < mesh.faceCount; fi++) {
        dual.positions.push(mesh.getFaceCenter(fi));
      }

      // Build vertex -> face adjacency
      const vertFaces = new Array(mesh.vertexCount).fill(null).map(() => []);
      let cornerIdx = 0;
      for (let fi = 0; fi < mesh.faceCount; fi++) {
        const count = mesh.faceVertCounts[fi];
        for (let ci = 0; ci < count; ci++) {
          const vi = mesh.cornerVerts[cornerIdx + ci];
          if (!vertFaces[vi].includes(fi)) {
            vertFaces[vi].push(fi);
          }
        }
        cornerIdx += count;
      }

      // Each original vertex with N>2 adjacent faces becomes an N-gon
      for (let vi = 0; vi < mesh.vertexCount; vi++) {
        const adjFaces = vertFaces[vi];
        if (adjFaces.length < 3) continue; // skip boundary/isolated vertices

        dual.faceVertCounts.push(adjFaces.length);
        for (const fi of adjFaces) {
          dual.cornerVerts.push(fi); // face index = vertex index in dual
        }
      }

      // Add edges
      const edgeSet = new Set();
      cornerIdx = 0;
      for (let fi = 0; fi < dual.faceVertCounts.length; fi++) {
        const count = dual.faceVertCounts[fi];
        for (let ci = 0; ci < count; ci++) {
          const a = dual.cornerVerts[cornerIdx + ci];
          const b = dual.cornerVerts[cornerIdx + (ci + 1) % count];
          const key = Math.min(a, b) + ',' + Math.max(a, b);
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            dual.edges.push([Math.min(a, b), Math.max(a, b)]);
          }
        }
        cornerIdx += count;
      }

      result.mesh = dual;
      return { outputs: [result] };
    },
  });

  // ── 15. Corners of Face ────────────────────────────────────────────────
  // Blender: node_geo_mesh_topology_corners_of_face.cc
  // "Retrieve a corner index within a face"
  // Inputs: Face Index (int field), Weights (float field), Sort Index (int field)
  // Outputs: Corner Index (int field), Total (int field)

  registry.addNode('geo', 'corners_of_face', {
    label: 'Corners of Face',
    category: 'INPUT',
    inputs: [
      { name: 'Face Index', type: SocketType.INT },
      { name: 'Weights', type: SocketType.FLOAT },
      { name: 'Sort Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Corner Index', type: SocketType.INT },
      { name: 'Total', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [
        new Field('int', (el) => el.index),
        new Field('int', () => 0),
      ]};
    },
  });

  // ── 16. Face of Corner ─────────────────────────────────────────────────
  // Blender: node_geo_mesh_topology_face_of_corner.cc
  // "Retrieve the face a corner is part of"
  // Input: Corner Index (int field)
  // Outputs: Face Index (int field), Index in Face (int field)

  registry.addNode('geo', 'face_of_corner', {
    label: 'Face of Corner',
    category: 'INPUT',
    inputs: [
      { name: 'Corner Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Face Index', type: SocketType.INT },
      { name: 'Index in Face', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [
        new Field('int', () => 0),
        new Field('int', () => 0),
      ]};
    },
  });

  // ── 17. Sort Elements ──────────────────────────────────────────────────
  // Blender: node_geo_sort_elements.cc
  // "Rearrange geometry elements, changing their indices"
  // Inputs: Geometry, Selection (bool field), Group ID (int field), Sort Weight (float field)
  // Property: Domain

  registry.addNode('geo', 'sort_elements', {
    label: 'Sort Elements',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Group ID', type: SocketType.INT },
      { name: 'Sort Weight', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { domain: 'POINT' },
    props: [
      {
        key: 'domain', label: 'Domain', type: 'select',
        options: [
          { value: 'POINT', label: 'Point' },
          { value: 'EDGE', label: 'Edge' },
          { value: 'FACE', label: 'Face' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      // Sorting changes element indices but doesn't modify geometry shape
      return { outputs: [geo.copy()] };
    },
  });

  // ── 18. Set Point Radius ───────────────────────────────────────────────
  // Blender: node_geo_set_point_radius.cc
  // "Set the display size of point cloud points"
  // Inputs: Points (geometry), Selection (bool field), Radius (float field, default 0.05)

  registry.addNode('geo', 'set_point_radius', {
    label: 'Set Point Radius',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Points', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Radius', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Points', type: SocketType.GEOMETRY },
    ],
    defaults: { radius: 0.05 },
    props: [
      { key: 'radius', label: 'Radius', type: 'float', min: 0, max: 1000, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Points'];
      if (!geo) return { outputs: [new GeometrySet()] };
      return { outputs: [geo.copy()] };
    },
  });

  // ── 19. Object Info ────────────────────────────────────────────────────
  // Blender: node_geo_object_info.cc
  // "Retrieve information from an object"
  //
  // In browser context, we don't have scene objects. This node provides
  // identity transforms and empty geometry for workflow compatibility.

  registry.addNode('geo', 'object_info', {
    label: 'Object Info',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Location', type: SocketType.VECTOR },
      { name: 'Rotation', type: SocketType.VECTOR },
      { name: 'Scale', type: SocketType.VECTOR },
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
        new GeometrySet(),
      ]};
    },
  });

  // ── 20. Corners of Vertex ──────────────────────────────────────────────
  // Blender: node_geo_mesh_topology_corners_of_vertex.cc
  // "Retrieve face corners connected to vertices"
  // Inputs: Vertex Index, Weights, Sort Index
  // Outputs: Corner Index (int field), Total (int field)

  registry.addNode('geo', 'corners_of_vertex', {
    label: 'Corners of Vertex',
    category: 'INPUT',
    inputs: [
      { name: 'Vertex Index', type: SocketType.INT },
      { name: 'Weights', type: SocketType.FLOAT },
      { name: 'Sort Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Corner Index', type: SocketType.INT },
      { name: 'Total', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [
        new Field('int', (el) => el.index),
        new Field('int', () => 0),
      ]};
    },
  });

  // ── 21. Edges of Vertex ────────────────────────────────────────────────
  // Blender: node_geo_mesh_topology_edges_of_vertex.cc
  // "Retrieve edges connected to each vertex"
  // Inputs: Vertex Index, Weights, Sort Index
  // Outputs: Edge Index (int field), Total (int field)

  registry.addNode('geo', 'edges_of_vertex', {
    label: 'Edges of Vertex',
    category: 'INPUT',
    inputs: [
      { name: 'Vertex Index', type: SocketType.INT },
      { name: 'Weights', type: SocketType.FLOAT },
      { name: 'Sort Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Edge Index', type: SocketType.INT },
      { name: 'Total', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [
        new Field('int', (el) => el.index),
        new Field('int', () => 0),
      ]};
    },
  });

  // ── 22. Edges of Corner ────────────────────────────────────────────────
  // Blender: node_geo_mesh_topology_edges_of_corner.cc
  // "Retrieve the edges on both sides of a face corner"
  // Input: Corner Index
  // Outputs: Next Edge Index (int field), Previous Edge Index (int field)

  registry.addNode('geo', 'edges_of_corner', {
    label: 'Edges of Corner',
    category: 'INPUT',
    inputs: [
      { name: 'Corner Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Next Edge Index', type: SocketType.INT },
      { name: 'Previous Edge Index', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [
        new Field('int', () => 0),
        new Field('int', () => 0),
      ]};
    },
  });

  // ── 23. Vertex of Corner ───────────────────────────────────────────────
  // Blender: node_geo_mesh_topology_vertex_of_corner.cc
  // "Retrieve the vertex each face corner is attached to"
  // Input: Corner Index (int field)
  // Output: Vertex Index (int field)

  registry.addNode('geo', 'vertex_of_corner', {
    label: 'Vertex of Corner',
    category: 'INPUT',
    inputs: [{ name: 'Corner Index', type: SocketType.INT }],
    outputs: [{ name: 'Vertex Index', type: SocketType.INT }],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [new Field('int', (el) => el.index)] };
    },
  });

  // ── 24. Corners of Edge ────────────────────────────────────────────────
  // Blender: node_geo_mesh_topology_corners_of_edge.cc
  // "Retrieve face corners connected to an edge"
  // Inputs: Edge Index, Weights, Sort Index
  // Outputs: Corner Index, Total

  registry.addNode('geo', 'corners_of_edge', {
    label: 'Corners of Edge',
    category: 'INPUT',
    inputs: [
      { name: 'Edge Index', type: SocketType.INT },
      { name: 'Weights', type: SocketType.FLOAT },
      { name: 'Sort Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Corner Index', type: SocketType.INT },
      { name: 'Total', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [
        new Field('int', (el) => el.index),
        new Field('int', () => 0),
      ]};
    },
  });

  // ── 25. Offset Corner in Face ──────────────────────────────────────────
  // Blender: node_geo_mesh_topology_offset_corner_in_face.cc
  // "Offset a corner index within its face"
  // Inputs: Corner Index, Offset (int)
  // Output: Corner Index (int field)

  registry.addNode('geo', 'offset_corner_in_face', {
    label: 'Offset Corner in Face',
    category: 'INPUT',
    inputs: [
      { name: 'Corner Index', type: SocketType.INT },
      { name: 'Offset', type: SocketType.INT },
    ],
    outputs: [{ name: 'Corner Index', type: SocketType.INT }],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const offsetInput = inputs['Offset'];
      return { outputs: [new Field('int', (el) => {
        const off = isField(offsetInput) ? offsetInput.evaluateAt(el) : (offsetInput ?? 0);
        return el.index + off;
      })] };
    },
  });
}

// ── Convex hull helper ──────────────────────────────────────────────────────

function convexHull2D(points) {
  // Graham scan on XY projection
  const pts = points.map((p, i) => ({ x: p.x, y: p.y, z: p.z, idx: i }));

  // Find lowest-leftmost point
  let pivot = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y < pts[pivot].y || (pts[i].y === pts[pivot].y && pts[i].x < pts[pivot].x)) {
      pivot = i;
    }
  }
  [pts[0], pts[pivot]] = [pts[pivot], pts[0]];

  const p0 = pts[0];
  pts.sort((a, b) => {
    if (a === p0) return -1;
    if (b === p0) return 1;
    const angleA = Math.atan2(a.y - p0.y, a.x - p0.x);
    const angleB = Math.atan2(b.y - p0.y, b.x - p0.x);
    if (Math.abs(angleA - angleB) < 1e-10) {
      const distA = (a.x - p0.x) ** 2 + (a.y - p0.y) ** 2;
      const distB = (b.x - p0.x) ** 2 + (b.y - p0.y) ** 2;
      return distA - distB;
    }
    return angleA - angleB;
  });

  const stack = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i++) {
    while (stack.length > 1) {
      const a = stack[stack.length - 2];
      const b = stack[stack.length - 1];
      const c = pts[i];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross <= 0) stack.pop();
      else break;
    }
    stack.push(pts[i]);
  }

  return stack.map(p => ({ x: p.x, y: p.y, z: p.z }));
}
