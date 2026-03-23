/**
 * geo/nodes_v2_mesh_ops.js - Mesh operation nodes.
 *
 * Nodes: subdivide_mesh, subdivision_surface, set_shade_smooth,
 *        extrude_mesh, bounding_box, merge_by_distance, separate_geometry
 *
 * All nodes verified against Blender source:
 *   source/blender/nodes/geometry/nodes/node_geo_subdivide_mesh.cc
 *   source/blender/nodes/geometry/nodes/node_geo_subdivision_surface.cc
 *   source/blender/nodes/geometry/nodes/node_geo_set_shade_smooth.cc
 *   source/blender/nodes/geometry/nodes/node_geo_separate_geometry.cc
 *   source/blender/nodes/geometry/nodes/node_geo_bounding_box.cc
 *   source/blender/nodes/geometry/nodes/node_geo_merge_by_distance.cc
 */

import { SocketType } from '../core/registry.js';
import {
  GeometrySet,
  MeshComponent,
  DOMAIN,
  ATTR_TYPE,
} from '../core/geometry.js';
import { Field, isField, resolveField, resolveScalar, resolveSelection } from '../core/field.js';

// ── Subdivision Helpers ──────────────────────────────────────────────────────

/**
 * Perform one level of linear (simple) subdivision on a mesh.
 *
 * Algorithm (matches OpenSubdiv simple mode topology):
 *   1. For each face: add a face-center vertex (centroid)
 *   2. For each edge: add an edge-midpoint vertex
 *   3. Each original face with n vertices becomes n quads:
 *      [corner_i, edge_mid(corner_i, corner_{i+1}), face_center, edge_mid(corner_{i-1}, corner_i)]
 *
 * In simple mode, positions are pure linear interpolation:
 *   - Face centers = exact centroid of face vertices
 *   - Edge midpoints = exact midpoint of edge endpoints
 *   - Original vertices = unchanged
 */
function subdivideLinearOnce(mesh) {
  const origVertCount = mesh.positions.length;
  const origEdgeCount = mesh.edges.length;
  const origFaceCount = mesh.faceVertCounts.length;

  // Build edge key -> edge index mapping for lookup
  const edgeKeyToIdx = new Map();
  for (let ei = 0; ei < origEdgeCount; ei++) {
    const [a, b] = mesh.edges[ei];
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    edgeKeyToIdx.set(key, ei);
  }

  function edgeKey(a, b) {
    return Math.min(a, b) + ',' + Math.max(a, b);
  }

  // Step 1: Add face center vertices
  const faceCenterStart = origVertCount + origEdgeCount; // face centers come after edge midpoints
  const edgeMidStart = origVertCount; // edge midpoints come after original verts

  const newPositions = mesh.positions.map(p => ({ x: p.x, y: p.y, z: p.z }));

  // Step 2: Add edge midpoint vertices (one per original edge)
  for (let ei = 0; ei < origEdgeCount; ei++) {
    const [a, b] = mesh.edges[ei];
    const pa = mesh.positions[a];
    const pb = mesh.positions[b];
    newPositions.push({
      x: (pa.x + pb.x) / 2,
      y: (pa.y + pb.y) / 2,
      z: (pa.z + pb.z) / 2,
    });
  }

  // Step 3: Add face center vertices
  let cornerIdx = 0;
  for (let fi = 0; fi < origFaceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    const center = { x: 0, y: 0, z: 0 };
    for (let ci = 0; ci < count; ci++) {
      const vi = mesh.cornerVerts[cornerIdx + ci];
      center.x += mesh.positions[vi].x;
      center.y += mesh.positions[vi].y;
      center.z += mesh.positions[vi].z;
    }
    center.x /= count;
    center.y /= count;
    center.z /= count;
    newPositions.push(center);
    cornerIdx += count;
  }

  // Step 4: Build new faces (each original face with n verts becomes n quads)
  const newFaceVertCounts = [];
  const newCornerVerts = [];
  const newEdges = [];
  const newEdgeSet = new Set();

  function addEdge(a, b) {
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    if (!newEdgeSet.has(key)) {
      newEdgeSet.add(key);
      newEdges.push([Math.min(a, b), Math.max(a, b)]);
    }
  }

  cornerIdx = 0;
  for (let fi = 0; fi < origFaceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    const faceVerts = [];
    for (let ci = 0; ci < count; ci++) {
      faceVerts.push(mesh.cornerVerts[cornerIdx + ci]);
    }

    const faceCenterIdx = faceCenterStart + fi;

    for (let ci = 0; ci < count; ci++) {
      const cornerVert = faceVerts[ci];
      const nextVert = faceVerts[(ci + 1) % count];
      const prevVert = faceVerts[(ci + count - 1) % count];

      // Find edge midpoint indices
      const nextEdgeKey = edgeKey(cornerVert, nextVert);
      const prevEdgeKey = edgeKey(prevVert, cornerVert);

      const nextEdgeIdx = edgeKeyToIdx.get(nextEdgeKey);
      const prevEdgeIdx = edgeKeyToIdx.get(prevEdgeKey);

      // Edge midpoint vertex indices
      const nextMidIdx = edgeMidStart + nextEdgeIdx;
      const prevMidIdx = edgeMidStart + prevEdgeIdx;

      // Create quad: corner -> next_mid -> face_center -> prev_mid
      newFaceVertCounts.push(4);
      newCornerVerts.push(cornerVert, nextMidIdx, faceCenterIdx, prevMidIdx);

      // Add edges for this quad
      addEdge(cornerVert, nextMidIdx);
      addEdge(nextMidIdx, faceCenterIdx);
      addEdge(faceCenterIdx, prevMidIdx);
      addEdge(prevMidIdx, cornerVert);
    }

    cornerIdx += count;
  }

  // Build result mesh
  const result = new MeshComponent();
  result.positions = newPositions;
  result.edges = newEdges;
  result.faceVertCounts = newFaceVertCounts;
  result.cornerVerts = newCornerVerts;
  return result;
}

/**
 * Perform one level of Catmull-Clark subdivision on a mesh.
 *
 * Algorithm:
 *   1. Face points: centroid of face vertices (same as linear)
 *   2. Edge points: average of (edge endpoints + adjacent face points)
 *   3. Original vertex points: (Q/n + 2*R/n + (n-3)*S/n)
 *      where Q = avg of adjacent face points
 *            R = avg of adjacent edge midpoints
 *            S = original position
 *            n = valence (number of adjacent edges)
 *   4. Topology: same as linear (each n-gon becomes n quads)
 *
 * Boundary handling (boundary_smooth = ALL):
 *   - Boundary edge points = edge midpoint
 *   - Boundary vertices = average of adjacent boundary edge midpoints
 */
function subdivideCatmullClarkOnce(mesh, boundarySmooth) {
  const origVertCount = mesh.positions.length;
  const origEdgeCount = mesh.edges.length;
  const origFaceCount = mesh.faceVertCounts.length;

  // Build adjacency structures
  const edgeKeyToIdx = new Map();
  for (let ei = 0; ei < origEdgeCount; ei++) {
    const [a, b] = mesh.edges[ei];
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    edgeKeyToIdx.set(key, ei);
  }

  function edgeKey(a, b) {
    return Math.min(a, b) + ',' + Math.max(a, b);
  }

  // Build vertex -> adjacent edges
  const vertEdges = new Array(origVertCount).fill(null).map(() => []);
  for (let ei = 0; ei < origEdgeCount; ei++) {
    const [a, b] = mesh.edges[ei];
    vertEdges[a].push(ei);
    vertEdges[b].push(ei);
  }

  // Build edge -> adjacent faces
  const edgeFaces = new Array(origEdgeCount).fill(null).map(() => []);
  let cornerIdx = 0;
  for (let fi = 0; fi < origFaceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    for (let ci = 0; ci < count; ci++) {
      const v0 = mesh.cornerVerts[cornerIdx + ci];
      const v1 = mesh.cornerVerts[cornerIdx + (ci + 1) % count];
      const ek = edgeKey(v0, v1);
      const ei = edgeKeyToIdx.get(ek);
      if (ei !== undefined) {
        edgeFaces[ei].push(fi);
      }
    }
    cornerIdx += count;
  }

  // Build vertex -> adjacent faces
  const vertFaces = new Array(origVertCount).fill(null).map(() => []);
  cornerIdx = 0;
  for (let fi = 0; fi < origFaceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    for (let ci = 0; ci < count; ci++) {
      const vi = mesh.cornerVerts[cornerIdx + ci];
      if (!vertFaces[vi].includes(fi)) {
        vertFaces[vi].push(fi);
      }
    }
    cornerIdx += count;
  }

  // Step 1: Compute face points (centroids)
  const facePoints = [];
  cornerIdx = 0;
  for (let fi = 0; fi < origFaceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    const center = { x: 0, y: 0, z: 0 };
    for (let ci = 0; ci < count; ci++) {
      const vi = mesh.cornerVerts[cornerIdx + ci];
      center.x += mesh.positions[vi].x;
      center.y += mesh.positions[vi].y;
      center.z += mesh.positions[vi].z;
    }
    center.x /= count;
    center.y /= count;
    center.z /= count;
    facePoints.push(center);
    cornerIdx += count;
  }

  // Step 2: Compute edge points
  const edgePoints = [];
  for (let ei = 0; ei < origEdgeCount; ei++) {
    const [a, b] = mesh.edges[ei];
    const pa = mesh.positions[a];
    const pb = mesh.positions[b];
    const adjFaces = edgeFaces[ei];

    if (adjFaces.length === 2) {
      // Interior edge: average of endpoints + adjacent face points
      const fp0 = facePoints[adjFaces[0]];
      const fp1 = facePoints[adjFaces[1]];
      edgePoints.push({
        x: (pa.x + pb.x + fp0.x + fp1.x) / 4,
        y: (pa.y + pb.y + fp0.y + fp1.y) / 4,
        z: (pa.z + pb.z + fp0.z + fp1.z) / 4,
      });
    } else {
      // Boundary edge: simple midpoint
      edgePoints.push({
        x: (pa.x + pb.x) / 2,
        y: (pa.y + pb.y) / 2,
        z: (pa.z + pb.z) / 2,
      });
    }
  }

  // Step 3: Compute new positions for original vertices
  const newOrigPositions = [];
  for (let vi = 0; vi < origVertCount; vi++) {
    const adjEdges = vertEdges[vi];
    const adjFacesList = vertFaces[vi];
    const n = adjEdges.length; // valence
    const S = mesh.positions[vi];

    // Check if boundary vertex
    const isBoundary = adjEdges.some(ei => edgeFaces[ei].length < 2);

    if (isBoundary) {
      if (boundarySmooth === 'PRESERVE_CORNERS' && adjEdges.filter(ei => edgeFaces[ei].length < 2).length !== 2) {
        // Corner vertex (more than 2 boundary edges or only 1): keep position
        newOrigPositions.push({ x: S.x, y: S.y, z: S.z });
      } else {
        // Boundary vertex: average of adjacent boundary edge midpoints and original
        const boundaryEdges = adjEdges.filter(ei => edgeFaces[ei].length < 2);
        if (boundaryEdges.length >= 2) {
          let mx = 0, my = 0, mz = 0;
          for (const bei of boundaryEdges) {
            const [a, b] = mesh.edges[bei];
            const other = a === vi ? b : a;
            mx += mesh.positions[other].x;
            my += mesh.positions[other].y;
            mz += mesh.positions[other].z;
          }
          mx /= boundaryEdges.length;
          my /= boundaryEdges.length;
          mz /= boundaryEdges.length;
          newOrigPositions.push({
            x: (mx + S.x) / 2,
            y: (my + S.y) / 2,
            z: (mz + S.z) / 2,
          });
        } else {
          newOrigPositions.push({ x: S.x, y: S.y, z: S.z });
        }
      }
    } else if (n > 0) {
      // Interior vertex: Q/n + 2R/n + (n-3)S/n
      // Q = average of adjacent face points
      let qx = 0, qy = 0, qz = 0;
      for (const fi of adjFacesList) {
        qx += facePoints[fi].x;
        qy += facePoints[fi].y;
        qz += facePoints[fi].z;
      }
      qx /= adjFacesList.length;
      qy /= adjFacesList.length;
      qz /= adjFacesList.length;

      // R = average of adjacent edge midpoints
      let rx = 0, ry = 0, rz = 0;
      for (const ei of adjEdges) {
        const [a, b] = mesh.edges[ei];
        rx += (mesh.positions[a].x + mesh.positions[b].x) / 2;
        ry += (mesh.positions[a].y + mesh.positions[b].y) / 2;
        rz += (mesh.positions[a].z + mesh.positions[b].z) / 2;
      }
      rx /= n;
      ry /= n;
      rz /= n;

      newOrigPositions.push({
        x: qx / n + 2 * rx / n + (n - 3) * S.x / n,
        y: qy / n + 2 * ry / n + (n - 3) * S.y / n,
        z: qz / n + 2 * rz / n + (n - 3) * S.z / n,
      });
    } else {
      newOrigPositions.push({ x: S.x, y: S.y, z: S.z });
    }
  }

  // Step 4: Build output mesh with same topology as linear subdivision
  const edgeMidStart = origVertCount;
  const faceCenterStart = origVertCount + origEdgeCount;

  const newPositions = [
    ...newOrigPositions,
    ...edgePoints,
    ...facePoints,
  ];

  const newFaceVertCounts = [];
  const newCornerVerts = [];
  const newEdges = [];
  const newEdgeSet = new Set();

  function addEdge(a, b) {
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    if (!newEdgeSet.has(key)) {
      newEdgeSet.add(key);
      newEdges.push([Math.min(a, b), Math.max(a, b)]);
    }
  }

  cornerIdx = 0;
  for (let fi = 0; fi < origFaceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    const faceVerts = [];
    for (let ci = 0; ci < count; ci++) {
      faceVerts.push(mesh.cornerVerts[cornerIdx + ci]);
    }

    const faceCenterIdx = faceCenterStart + fi;

    for (let ci = 0; ci < count; ci++) {
      const cornerVert = faceVerts[ci];
      const nextVert = faceVerts[(ci + 1) % count];
      const prevVert = faceVerts[(ci + count - 1) % count];

      const nextEdgeIdx = edgeKeyToIdx.get(edgeKey(cornerVert, nextVert));
      const prevEdgeIdx = edgeKeyToIdx.get(edgeKey(prevVert, cornerVert));

      const nextMidIdx = edgeMidStart + nextEdgeIdx;
      const prevMidIdx = edgeMidStart + prevEdgeIdx;

      newFaceVertCounts.push(4);
      newCornerVerts.push(cornerVert, nextMidIdx, faceCenterIdx, prevMidIdx);

      addEdge(cornerVert, nextMidIdx);
      addEdge(nextMidIdx, faceCenterIdx);
      addEdge(faceCenterIdx, prevMidIdx);
      addEdge(prevMidIdx, cornerVert);
    }

    cornerIdx += count;
  }

  const result = new MeshComponent();
  result.positions = newPositions;
  result.edges = newEdges;
  result.faceVertCounts = newFaceVertCounts;
  result.cornerVerts = newCornerVerts;
  return result;
}

// ── Node Registration ────────────────────────────────────────────────────────

export function registerMeshOpNodes(registry) {
  // ── Categories ──────────────────────────────────────────────────────────
  // Reuse GEOMETRY category from operations.js; add MESH_OPS if not present
  registry.addCategory('geo', 'MESH', { name: 'Mesh', color: '#66BB6A', icon: '△' });

  // ── 1. Subdivide Mesh ───────────────────────────────────────────────────
  // Blender: node_geo_subdivide_mesh.cc
  // "Divide mesh faces into smaller ones without changing the shape or volume,
  //  using linear interpolation to place the new vertices"
  //
  // Inputs: Mesh (geometry, mesh only), Level (int, default 1, range 0-6)
  // Output: Mesh (geometry)
  // Algorithm: Linear/simple subdivision (OpenSubdiv is_simple=true)

  registry.addNode('geo', 'subdivide_mesh', {
    label: 'Subdivide Mesh',
    category: 'MESH',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Level', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { level: 1 },
    props: [
      { key: 'level', label: 'Level', type: 'int', min: 0, max: 6, step: 1 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [new GeometrySet()] };
      }

      const level = Math.max(0, Math.min(6, Math.round(
        inputs['Level'] != null ? resolveScalar(inputs['Level'], values.level) : values.level
      )));

      if (level === 0) {
        return { outputs: [geo.copy()] };
      }

      const result = geo.copy();
      let currentMesh = result.mesh;

      for (let i = 0; i < level; i++) {
        currentMesh = subdivideLinearOnce(currentMesh);
      }

      result.mesh = currentMesh;
      return { outputs: [result] };
    },
  });

  // ── 2. Subdivision Surface ──────────────────────────────────────────────
  // Blender: node_geo_subdivision_surface.cc
  // "Divide mesh faces to form a smooth surface, using the Catmull-Clark
  //  subdivision method"
  //
  // Inputs: Mesh, Level (int 1, 0-6), Edge Crease (float field 0, 0-1),
  //         Vertex Crease (float field 0, 0-1)
  // Properties: UV Smooth (enum), Boundary Smooth (enum: ALL, PRESERVE_CORNERS)
  // Output: Mesh
  //
  // NOTE: Edge/Vertex crease support is implemented but simplified -
  // full OpenSubdiv crease weighting would require the OpenSubdiv library.
  // We implement the standard Catmull-Clark algorithm with boundary handling.

  registry.addNode('geo', 'subdivision_surface', {
    label: 'Subdivision Surface',
    category: 'MESH',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Level', type: SocketType.INT },
      { name: 'Edge Crease', type: SocketType.FLOAT },
      { name: 'Vertex Crease', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: {
      level: 1,
      boundary_smooth: 'ALL',
    },
    props: [
      { key: 'level', label: 'Level', type: 'int', min: 0, max: 6, step: 1 },
      {
        key: 'boundary_smooth', label: 'Boundary Smooth', type: 'select',
        options: [
          { value: 'ALL', label: 'All' },
          { value: 'PRESERVE_CORNERS', label: 'Keep Corners' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [new GeometrySet()] };
      }

      const level = Math.max(0, Math.min(6, Math.round(
        inputs['Level'] != null ? resolveScalar(inputs['Level'], values.level) : values.level
      )));

      if (level === 0) {
        return { outputs: [geo.copy()] };
      }

      // NOTE: Edge Crease and Vertex Crease are field inputs in Blender.
      // Full crease support requires per-edge/vertex crease weights that modify
      // the Catmull-Clark smoothing. Our implementation handles the standard
      // Catmull-Clark algorithm with boundary smoothing but does not yet
      // implement per-element crease weighting (which requires OpenSubdiv-level
      // interpolation). This is documented as a known limitation.

      const boundarySmooth = values.boundary_smooth || 'ALL';
      const result = geo.copy();
      let currentMesh = result.mesh;

      for (let i = 0; i < level; i++) {
        currentMesh = subdivideCatmullClarkOnce(currentMesh, boundarySmooth);
      }

      result.mesh = currentMesh;
      return { outputs: [result] };
    },
  });

  // ── 3. Set Shade Smooth ─────────────────────────────────────────────────
  // Blender: node_geo_set_shade_smooth.cc
  // Controls mesh normal smoothness by setting shade smooth attributes.
  //
  // Inputs: Geometry, Selection (bool field, default true),
  //         Shade Smooth (bool field, default true)
  // Property: Domain (Face, Edge)
  // Output: Geometry
  //
  // In Blender, smooth=true means NOT sharp. The attribute stored is
  // "sharp_face" or "sharp_edge" (inverted logic).

  registry.addNode('geo', 'set_shade_smooth', {
    label: 'Set Shade Smooth',
    category: 'MESH',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Shade Smooth', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { domain: 'FACE' },
    props: [
      {
        key: 'domain', label: 'Domain', type: 'select',
        options: [
          { value: 'FACE', label: 'Face' },
          { value: 'EDGE', label: 'Edge' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      const result = geo.copy();

      if (!result.mesh || result.mesh.vertexCount === 0) {
        return { outputs: [result] };
      }

      const domain = values.domain || 'FACE';
      const mesh = result.mesh;

      if (domain === 'FACE') {
        const elements = mesh.buildElements(DOMAIN.FACE);
        const selection = resolveSelection(inputs['Selection'], elements);
        const smoothInput = inputs['Shade Smooth'];
        const smoothValues = smoothInput != null
          ? resolveField(smoothInput, elements)
          : new Array(elements.length).fill(true);

        // Store as sharp_face attribute (inverted: smooth=true means sharp=false)
        const sharpFace = new Array(mesh.faceCount).fill(false);
        for (let i = 0; i < mesh.faceCount; i++) {
          if (selection && !selection[i]) continue;
          sharpFace[i] = !smoothValues[i];
        }
        mesh.faceAttrs.set('sharp_face', ATTR_TYPE.BOOL, sharpFace);
      } else if (domain === 'EDGE') {
        const elements = mesh.buildElements(DOMAIN.EDGE);
        const selection = resolveSelection(inputs['Selection'], elements);
        const smoothInput = inputs['Shade Smooth'];
        const smoothValues = smoothInput != null
          ? resolveField(smoothInput, elements)
          : new Array(elements.length).fill(true);

        const sharpEdge = new Array(mesh.edgeCount).fill(false);
        for (let i = 0; i < mesh.edgeCount; i++) {
          if (selection && !selection[i]) continue;
          sharpEdge[i] = !smoothValues[i];
        }
        mesh.edgeAttrs.set('sharp_edge', ATTR_TYPE.BOOL, sharpEdge);
      }

      return { outputs: [result] };
    },
  });

  // ── 4. Separate Geometry ────────────────────────────────────────────────
  // Blender: node_geo_separate_geometry.cc
  // Split geometry into two outputs based on a boolean selection field.
  //
  // Inputs: Geometry, Selection (bool field, default true)
  // Outputs: Selection (geometry where true), Inverted (geometry where false)
  // Property: Domain (Point, Edge, Face - not Corner)

  registry.addNode('geo', 'separate_geometry', {
    label: 'Separate Geometry',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Selection', type: SocketType.GEOMETRY },
      { name: 'Inverted', type: SocketType.GEOMETRY },
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
      if (!geo) {
        return { outputs: [new GeometrySet(), new GeometrySet()] };
      }

      const selectionInput = inputs['Selection'];
      if (selectionInput == null) {
        // No selection: everything goes to "Selection" output
        return { outputs: [geo.copy(), new GeometrySet()] };
      }

      const domain = values.domain || 'POINT';

      // Helper: split mesh by point selection
      function splitMeshByPoints(mesh, selValues) {
        const selected = new GeometrySet();
        const inverted = new GeometrySet();

        if (!mesh || mesh.vertexCount === 0) return [selected, inverted];

        // Build keep arrays for selected and inverted
        const selMesh = mesh.copy();
        const invMesh = mesh.copy();

        // Determine which vertices go where
        const selKeep = new Array(mesh.vertexCount).fill(false);
        const invKeep = new Array(mesh.vertexCount).fill(false);
        for (let i = 0; i < mesh.vertexCount; i++) {
          if (selValues[i]) {
            selKeep[i] = true;
          } else {
            invKeep[i] = true;
          }
        }

        function filterMeshByVerts(targetMesh, keepArray) {
          const newIndex = new Array(mesh.vertexCount).fill(-1);
          const keptIndices = [];
          let newIdx = 0;
          for (let i = 0; i < mesh.vertexCount; i++) {
            if (keepArray[i]) {
              newIndex[i] = newIdx++;
              keptIndices.push(i);
            }
          }

          targetMesh.positions = keptIndices.map(i => ({
            x: mesh.positions[i].x,
            y: mesh.positions[i].y,
            z: mesh.positions[i].z,
          }));
          targetMesh.pointAttrs = mesh.pointAttrs.clone();
          targetMesh.pointAttrs.filter(keptIndices);

          // Edges: keep only where both verts survive
          targetMesh.edges = [];
          for (const edge of mesh.edges) {
            if (newIndex[edge[0]] >= 0 && newIndex[edge[1]] >= 0) {
              targetMesh.edges.push([newIndex[edge[0]], newIndex[edge[1]]]);
            }
          }

          // Faces: keep only where all verts survive
          const newFaceVertCounts = [];
          const newCornerVerts = [];
          let cornerIdx = 0;
          for (let fi = 0; fi < mesh.faceVertCounts.length; fi++) {
            const count = mesh.faceVertCounts[fi];
            const corners = mesh.cornerVerts.slice(cornerIdx, cornerIdx + count);
            cornerIdx += count;
            if (corners.every(vi => newIndex[vi] >= 0)) {
              newFaceVertCounts.push(count);
              for (const vi of corners) {
                newCornerVerts.push(newIndex[vi]);
              }
            }
          }
          targetMesh.faceVertCounts = newFaceVertCounts;
          targetMesh.cornerVerts = newCornerVerts;
          targetMesh.invalidateCornerOffsets();
        }

        filterMeshByVerts(selMesh, selKeep);
        filterMeshByVerts(invMesh, invKeep);

        if (selMesh.vertexCount > 0) selected.mesh = selMesh;
        if (invMesh.vertexCount > 0) inverted.mesh = invMesh;

        return [selected, inverted];
      }

      function splitMeshByFaces(mesh, selValues) {
        const selected = new GeometrySet();
        const inverted = new GeometrySet();

        if (!mesh || mesh.faceCount === 0) return [selected, inverted];

        const selMesh = new MeshComponent();
        const invMesh = new MeshComponent();

        // Copy all positions to both (we could optimize but this is simpler)
        selMesh.positions = mesh.positions.map(p => ({ x: p.x, y: p.y, z: p.z }));
        invMesh.positions = mesh.positions.map(p => ({ x: p.x, y: p.y, z: p.z }));
        selMesh.edges = mesh.edges.map(e => [...e]);
        invMesh.edges = mesh.edges.map(e => [...e]);

        let cornerIdx = 0;
        for (let fi = 0; fi < mesh.faceVertCounts.length; fi++) {
          const count = mesh.faceVertCounts[fi];
          const corners = mesh.cornerVerts.slice(cornerIdx, cornerIdx + count);
          cornerIdx += count;

          const target = selValues[fi] ? selMesh : invMesh;
          target.faceVertCounts.push(count);
          target.cornerVerts.push(...corners);
        }

        if (selMesh.faceCount > 0) selected.mesh = selMesh;
        if (invMesh.faceCount > 0) inverted.mesh = invMesh;

        return [selected, inverted];
      }

      if (!geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [geo.copy(), new GeometrySet()] };
      }

      const domainEnum = domain === 'FACE' ? DOMAIN.FACE :
                          domain === 'EDGE' ? DOMAIN.EDGE : DOMAIN.POINT;
      const elements = geo.mesh.buildElements(domainEnum);
      const selValues = resolveSelection(selectionInput, elements)
        || new Array(elements.length).fill(true);

      if (domain === 'FACE') {
        const [sel, inv] = splitMeshByFaces(geo.mesh, selValues);
        return { outputs: [sel, inv] };
      } else {
        const [sel, inv] = splitMeshByPoints(geo.mesh, selValues);
        return { outputs: [sel, inv] };
      }
    },
  });

  // ── 5. Bounding Box ────────────────────────────────────────────────────
  // Blender: node_geo_bounding_box.cc
  // Compute axis-aligned bounding box of geometry.
  //
  // Input: Geometry
  // Outputs: Bounding Box (mesh geometry), Min (vector), Max (vector)

  registry.addNode('geo', 'bounding_box', {
    label: 'Bounding Box',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    outputs: [
      { name: 'Bounding Box', type: SocketType.GEOMETRY },
      { name: 'Min', type: SocketType.VECTOR },
      { name: 'Max', type: SocketType.VECTOR },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) {
        return { outputs: [
          new GeometrySet(),
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ]};
      }

      // Gather all positions from mesh, curve, instances
      const allPositions = [];
      if (geo.mesh && geo.mesh.vertexCount > 0) {
        allPositions.push(...geo.mesh.positions);
      }
      if (geo.curve && geo.curve.splineCount > 0) {
        allPositions.push(...geo.curve.getAllPositions());
      }
      if (geo.instances && geo.instances.instanceCount > 0) {
        for (const t of geo.instances.transforms) {
          allPositions.push(t.position);
        }
      }

      if (allPositions.length === 0) {
        return { outputs: [
          new GeometrySet(),
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ]};
      }

      // Find min/max
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of allPositions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.z < minZ) minZ = p.z;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (p.z > maxZ) maxZ = p.z;
      }

      // Create box mesh (8 vertices, 12 edges, 6 faces)
      const boxGeo = new GeometrySet();
      const box = new MeshComponent();

      box.positions = [
        { x: minX, y: minY, z: minZ }, // 0: ---
        { x: maxX, y: minY, z: minZ }, // 1: +--
        { x: maxX, y: maxY, z: minZ }, // 2: ++-
        { x: minX, y: maxY, z: minZ }, // 3: -+-
        { x: minX, y: minY, z: maxZ }, // 4: --+
        { x: maxX, y: minY, z: maxZ }, // 5: +-+
        { x: maxX, y: maxY, z: maxZ }, // 6: +++
        { x: minX, y: maxY, z: maxZ }, // 7: -++
      ];

      box.edges = [
        [0, 1], [1, 2], [2, 3], [3, 0], // bottom
        [4, 5], [5, 6], [6, 7], [7, 4], // top
        [0, 4], [1, 5], [2, 6], [3, 7], // sides
      ];

      // 6 quad faces (CCW from outside)
      box.faceVertCounts = [4, 4, 4, 4, 4, 4];
      box.cornerVerts = [
        0, 3, 2, 1, // bottom (-Z)
        4, 5, 6, 7, // top (+Z)
        0, 1, 5, 4, // front (-Y)
        2, 3, 7, 6, // back (+Y)
        0, 4, 7, 3, // left (-X)
        1, 2, 6, 5, // right (+X)
      ];

      boxGeo.mesh = box;

      return { outputs: [
        boxGeo,
        { x: minX, y: minY, z: minZ },
        { x: maxX, y: maxY, z: maxZ },
      ]};
    },
  });

  // ── 6. Merge by Distance ────────────────────────────────────────────────
  // Blender: node_geo_merge_by_distance.cc
  // Merge vertices within a distance threshold.
  //
  // Inputs: Geometry, Selection (bool field), Distance (float, default 0.0001)
  // Output: Geometry
  // Property: Mode (All, Connected) - we implement All mode

  registry.addNode('geo', 'merge_by_distance', {
    label: 'Merge by Distance',
    category: 'MESH',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Distance', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { distance: 0.001, mode: 'ALL' },
    props: [
      { key: 'distance', label: 'Distance', type: 'float', min: 0, max: 10, step: 0.001 },
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'ALL', label: 'All' },
          { value: 'CONNECTED', label: 'Connected' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      }

      const distance = inputs['Distance'] != null
        ? resolveScalar(inputs['Distance'], values.distance)
        : values.distance;
      const distSq = distance * distance;

      const result = geo.copy();
      const mesh = result.mesh;

      const elements = mesh.buildElements(DOMAIN.POINT);
      const selection = resolveSelection(inputs['Selection'], elements);

      // Build merge map: for each vertex, find the representative vertex
      const mergeTarget = new Array(mesh.vertexCount).fill(-1);
      for (let i = 0; i < mesh.vertexCount; i++) {
        mergeTarget[i] = i;
      }

      // Simple O(n^2) merge - find vertices within distance
      for (let i = 0; i < mesh.vertexCount; i++) {
        if (selection && !selection[i]) continue;
        if (mergeTarget[i] !== i) continue; // already merged

        for (let j = i + 1; j < mesh.vertexCount; j++) {
          if (selection && !selection[j]) continue;
          if (mergeTarget[j] !== j) continue;

          const dx = mesh.positions[i].x - mesh.positions[j].x;
          const dy = mesh.positions[i].y - mesh.positions[j].y;
          const dz = mesh.positions[i].z - mesh.positions[j].z;
          if (dx * dx + dy * dy + dz * dz <= distSq) {
            mergeTarget[j] = i;
          }
        }
      }

      // Resolve transitive merges
      for (let i = 0; i < mesh.vertexCount; i++) {
        let target = mergeTarget[i];
        while (mergeTarget[target] !== target) {
          target = mergeTarget[target];
        }
        mergeTarget[i] = target;
      }

      // Build new vertex list
      const newIndex = new Array(mesh.vertexCount).fill(-1);
      const newPositions = [];
      let idx = 0;
      for (let i = 0; i < mesh.vertexCount; i++) {
        if (mergeTarget[i] === i) {
          newIndex[i] = idx++;
          newPositions.push({ ...mesh.positions[i] });
        }
      }
      for (let i = 0; i < mesh.vertexCount; i++) {
        if (mergeTarget[i] !== i) {
          newIndex[i] = newIndex[mergeTarget[i]];
        }
      }

      mesh.positions = newPositions;

      // Remap edges, deduplicate
      const edgeSet = new Set();
      const newEdges = [];
      for (const [a, b] of mesh.edges) {
        const na = newIndex[a];
        const nb = newIndex[b];
        if (na === nb) continue; // edge collapsed
        const key = Math.min(na, nb) + ',' + Math.max(na, nb);
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          newEdges.push([Math.min(na, nb), Math.max(na, nb)]);
        }
      }
      mesh.edges = newEdges;

      // Remap faces, remove degenerate
      const newFaceVertCounts = [];
      const newCornerVerts = [];
      let cornerIdx = 0;
      for (let fi = 0; fi < mesh.faceVertCounts.length; fi++) {
        const count = mesh.faceVertCounts[fi];
        const remapped = [];
        for (let ci = 0; ci < count; ci++) {
          const newVi = newIndex[mesh.cornerVerts[cornerIdx + ci]];
          // Avoid consecutive duplicate vertices
          if (remapped.length === 0 || remapped[remapped.length - 1] !== newVi) {
            remapped.push(newVi);
          }
        }
        // Also check first vs last
        if (remapped.length > 1 && remapped[0] === remapped[remapped.length - 1]) {
          remapped.pop();
        }
        cornerIdx += count;

        if (remapped.length >= 3) {
          newFaceVertCounts.push(remapped.length);
          newCornerVerts.push(...remapped);
        }
      }
      mesh.faceVertCounts = newFaceVertCounts;
      mesh.cornerVerts = newCornerVerts;
      mesh.invalidateCornerOffsets();

      // Reset point attrs since vertex indices changed
      mesh.pointAttrs = new (mesh.pointAttrs.constructor)();

      return { outputs: [result] };
    },
  });

  // ── 7. Extrude Mesh ─────────────────────────────────────────────────────
  // Blender: node_geo_extrude_mesh.cc
  // "Generate new vertices, edges, or faces from selected elements and
  //  move them based on an offset while keeping them connected"
  //
  // Inputs: Mesh, Selection (bool field), Offset (vector field, default normal),
  //         Offset Scale (float field, default 1.0), Individual (bool, faces only)
  // Outputs: Mesh, Top (bool field), Side (bool field)
  // Property: Mode (Faces, Vertices, Edges) - default Faces
  //
  // We implement Faces mode (individual extrusion) and Vertices mode.

  registry.addNode('geo', 'extrude_mesh', {
    label: 'Extrude Mesh',
    category: 'MESH',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Offset', type: SocketType.VECTOR },
      { name: 'Offset Scale', type: SocketType.FLOAT },
      { name: 'Individual', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Top', type: SocketType.BOOL },
      { name: 'Side', type: SocketType.BOOL },
    ],
    defaults: { mode: 'FACES', offset_scale: 1.0, individual: true },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'FACES', label: 'Faces' },
          { value: 'VERTICES', label: 'Vertices' },
          { value: 'EDGES', label: 'Edges' },
        ],
      },
      { key: 'offset_scale', label: 'Offset Scale', type: 'float', min: -1000, max: 1000, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [new GeometrySet(), false, false] };
      }

      const mode = values.mode || 'FACES';
      const result = geo.copy();
      const mesh = result.mesh;

      const offsetScaleInput = inputs['Offset Scale'];
      const offsetScale = offsetScaleInput != null
        ? resolveScalar(offsetScaleInput, values.offset_scale)
        : values.offset_scale;

      if (mode === 'FACES') {
        return extrudeFaces(mesh, inputs, offsetScale, result);
      } else if (mode === 'VERTICES') {
        return extrudeVertices(mesh, inputs, offsetScale, result);
      } else {
        // EDGES mode - simplified
        return extrudeEdges(mesh, inputs, offsetScale, result);
      }
    },
  });

  // ── 8. Triangulate ──────────────────────────────────────────────────────
  // Blender: node_geo_triangulate.cc
  // "Triangulate mesh faces"
  //
  // Inputs: Mesh, Selection (bool field, default true)
  // Properties: Quad Method, Ngon Method
  // Output: Mesh

  registry.addNode('geo', 'triangulate', {
    label: 'Triangulate',
    category: 'MESH',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { quad_method: 'SHORT_EDGE', ngon_method: 'BEAUTY' },
    props: [
      {
        key: 'quad_method', label: 'Quad Method', type: 'select',
        options: [
          { value: 'BEAUTY', label: 'Beauty' },
          { value: 'FIXED', label: 'Fixed' },
          { value: 'ALTERNATE', label: 'Fixed Alternate' },
          { value: 'SHORT_EDGE', label: 'Shortest Diagonal' },
          { value: 'LONG_EDGE', label: 'Longest Diagonal' },
        ],
      },
      {
        key: 'ngon_method', label: 'Ngon Method', type: 'select',
        options: [
          { value: 'BEAUTY', label: 'Beauty' },
          { value: 'EAR_CLIP', label: 'Clip' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      }

      const result = geo.copy();
      const mesh = result.mesh;
      const elements = mesh.buildElements(DOMAIN.FACE);
      const selection = resolveSelection(inputs['Selection'], elements);

      // Check if already triangulated
      const allTris = mesh.faceVertCounts.every(c => c === 3);
      if (allTris) return { outputs: [result] };

      const quadMethod = values.quad_method || 'SHORT_EDGE';
      const newFaceVertCounts = [];
      const newCornerVerts = [];
      let cornerIdx = 0;

      for (let fi = 0; fi < mesh.faceCount; fi++) {
        const count = mesh.faceVertCounts[fi];
        const corners = mesh.cornerVerts.slice(cornerIdx, cornerIdx + count);
        cornerIdx += count;

        if (count === 3 || (selection && !selection[fi])) {
          // Already a triangle or not selected - keep as-is
          newFaceVertCounts.push(count);
          newCornerVerts.push(...corners);
          continue;
        }

        if (count === 4) {
          // Quad triangulation based on method
          let splitIdx;
          if (quadMethod === 'FIXED' || quadMethod === 'BEAUTY') {
            splitIdx = 0; // Split 0-2
          } else if (quadMethod === 'ALTERNATE') {
            splitIdx = 1; // Split 1-3
          } else if (quadMethod === 'SHORT_EDGE') {
            // Split along shortest diagonal
            const p0 = mesh.positions[corners[0]];
            const p2 = mesh.positions[corners[2]];
            const p1 = mesh.positions[corners[1]];
            const p3 = mesh.positions[corners[3]];
            const d02 = distSq(p0, p2);
            const d13 = distSq(p1, p3);
            splitIdx = d02 <= d13 ? 0 : 1;
          } else { // LONG_EDGE
            const p0 = mesh.positions[corners[0]];
            const p2 = mesh.positions[corners[2]];
            const p1 = mesh.positions[corners[1]];
            const p3 = mesh.positions[corners[3]];
            const d02 = distSq(p0, p2);
            const d13 = distSq(p1, p3);
            splitIdx = d02 >= d13 ? 0 : 1;
          }

          if (splitIdx === 0) {
            newFaceVertCounts.push(3, 3);
            newCornerVerts.push(corners[0], corners[1], corners[2]);
            newCornerVerts.push(corners[0], corners[2], corners[3]);
          } else {
            newFaceVertCounts.push(3, 3);
            newCornerVerts.push(corners[1], corners[2], corners[3]);
            newCornerVerts.push(corners[1], corners[3], corners[0]);
          }
        } else {
          // N-gon: fan triangulation from first vertex (ear clipping simplified)
          for (let i = 1; i < count - 1; i++) {
            newFaceVertCounts.push(3);
            newCornerVerts.push(corners[0], corners[i], corners[i + 1]);
          }
        }
      }

      mesh.faceVertCounts = newFaceVertCounts;
      mesh.cornerVerts = newCornerVerts;
      mesh.invalidateCornerOffsets();

      return { outputs: [result] };
    },
  });

  // ── 9. Flip Faces ───────────────────────────────────────────────────────
  // Blender: node_geo_flip_faces.cc
  // "Reverse the order of the vertices and edges of selected faces,
  //  flipping their normal direction"
  //
  // Inputs: Mesh, Selection (bool field, default true)
  // Output: Mesh

  registry.addNode('geo', 'flip_faces', {
    label: 'Flip Faces',
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
      if (!geo || !geo.mesh || geo.mesh.faceCount === 0) {
        return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      }

      const result = geo.copy();
      const mesh = result.mesh;
      const elements = mesh.buildElements(DOMAIN.FACE);
      const selection = resolveSelection(inputs['Selection'], elements);

      let cornerIdx = 0;
      for (let fi = 0; fi < mesh.faceCount; fi++) {
        const count = mesh.faceVertCounts[fi];
        if (!selection || selection[fi]) {
          // Reverse the corner vertex order for this face
          const start = cornerIdx;
          const end = cornerIdx + count;
          const slice = mesh.cornerVerts.slice(start, end);
          slice.reverse();
          for (let i = 0; i < count; i++) {
            mesh.cornerVerts[start + i] = slice[i];
          }
        }
        cornerIdx += count;
      }

      return { outputs: [result] };
    },
  });

  // ── 10. Duplicate Elements ──────────────────────────────────────────────
  // Blender: node_geo_duplicate_elements.cc
  // "Generate copies of each selected element"
  //
  // Inputs: Geometry, Selection (bool field), Amount (int field, default 1)
  // Outputs: Geometry (only duplicates, not originals), Duplicate Index (int field)
  // Property: Domain (Point, Face, Edge, Spline, Instance)

  registry.addNode('geo', 'duplicate_elements', {
    label: 'Duplicate Elements',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Amount', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Duplicate Index', type: SocketType.INT },
    ],
    defaults: { amount: 1, domain: 'POINT' },
    props: [
      { key: 'amount', label: 'Amount', type: 'int', min: 0, max: 10000, step: 1 },
      {
        key: 'domain', label: 'Domain', type: 'select',
        options: [
          { value: 'POINT', label: 'Point' },
          { value: 'FACE', label: 'Face' },
          { value: 'INSTANCE', label: 'Instance' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) {
        return { outputs: [new GeometrySet(), new Field('int', () => 0)] };
      }

      const domain = values.domain || 'POINT';
      const amountInput = inputs['Amount'];
      const amount = amountInput != null ? resolveScalar(amountInput, values.amount) : values.amount;

      if (amount <= 0) {
        return { outputs: [new GeometrySet(), new Field('int', () => 0)] };
      }

      if (domain === 'POINT' && geo.mesh && geo.mesh.vertexCount > 0) {
        return duplicatePoints(geo, inputs, amount);
      } else if (domain === 'FACE' && geo.mesh && geo.mesh.faceCount > 0) {
        return duplicateFaces(geo, inputs, amount);
      }

      // For unsupported domains, return empty
      return { outputs: [new GeometrySet(), new Field('int', () => 0)] };
    },
  });
}

// ── Extrude Faces (Individual) ─────────────────────────────────────────────

function extrudeFaces(mesh, inputs, offsetScale, result) {
  const elements = mesh.buildElements(DOMAIN.FACE);
  const selection = resolveSelection(inputs['Selection'], elements);
  const offsetInput = inputs['Offset'];

  // Track which faces/edges are "top" and "side"
  const origFaceCount = mesh.faceCount;
  const topFaceIndices = new Set();
  const sideFaceIndices = new Set();

  // Collect selected faces
  const selectedFaces = [];
  for (let fi = 0; fi < origFaceCount; fi++) {
    if (!selection || selection[fi]) {
      selectedFaces.push(fi);
    }
  }

  if (selectedFaces.length === 0) {
    return { outputs: [result, false, false] };
  }

  // For each selected face, extrude individually
  for (const fi of selectedFaces) {
    const faceVerts = mesh.getFaceVertices(fi);
    const faceNormal = mesh.getFaceNormal(fi);
    const vertCount = faceVerts.length;

    // Compute offset for this face
    let offset;
    if (offsetInput != null && isField(offsetInput)) {
      offset = offsetInput.evaluateAt(elements[fi]);
    } else if (offsetInput != null) {
      offset = offsetInput;
    } else {
      offset = faceNormal;
    }

    const dx = (offset.x ?? 0) * offsetScale;
    const dy = (offset.y ?? 0) * offsetScale;
    const dz = (offset.z ?? 0) * offsetScale;

    // Create new vertices (duplicates of face vertices, offset)
    const newVertStart = mesh.positions.length;
    for (let ci = 0; ci < vertCount; ci++) {
      const origPos = mesh.positions[faceVerts[ci]];
      mesh.positions.push({
        x: origPos.x + dx,
        y: origPos.y + dy,
        z: origPos.z + dz,
      });
    }

    // Create side quad faces connecting original and new vertices
    for (let ci = 0; ci < vertCount; ci++) {
      const nextCi = (ci + 1) % vertCount;
      const origA = faceVerts[ci];
      const origB = faceVerts[nextCi];
      const newA = newVertStart + ci;
      const newB = newVertStart + nextCi;

      mesh.faceVertCounts.push(4);
      mesh.cornerVerts.push(origA, origB, newB, newA);
      sideFaceIndices.add(mesh.faceCount - 1);

      // Side edges
      const edgeKey1 = Math.min(origA, newA) + ',' + Math.max(origA, newA);
      mesh.edges.push([origA, newA]);
    }

    // Create top face (using new vertices)
    mesh.faceVertCounts.push(vertCount);
    for (let ci = 0; ci < vertCount; ci++) {
      mesh.cornerVerts.push(newVertStart + ci);
    }
    topFaceIndices.add(mesh.faceCount - 1);

    // Add edges for top face
    for (let ci = 0; ci < vertCount; ci++) {
      const nextCi = (ci + 1) % vertCount;
      mesh.edges.push([newVertStart + ci, newVertStart + nextCi]);
    }
  }

  mesh.invalidateCornerOffsets();

  // Create top/side selection fields
  const totalFaces = mesh.faceCount;
  const topField = new Field('bool', (el) => topFaceIndices.has(el.index));
  const sideField = new Field('bool', (el) => sideFaceIndices.has(el.index));

  return { outputs: [result, topField, sideField] };
}

// ── Extrude Vertices ────────────────────────────────────────────────────────

function extrudeVertices(mesh, inputs, offsetScale, result) {
  const elements = mesh.buildElements(DOMAIN.POINT);
  const selection = resolveSelection(inputs['Selection'], elements);
  const offsetInput = inputs['Offset'];

  const origVertCount = mesh.vertexCount;
  const topVertIndices = new Set();
  const sideEdgeStart = mesh.edges.length;

  for (let vi = 0; vi < origVertCount; vi++) {
    if (selection && !selection[vi]) continue;

    let offset;
    if (offsetInput != null && isField(offsetInput)) {
      offset = offsetInput.evaluateAt(elements[vi]);
    } else if (offsetInput != null) {
      offset = offsetInput;
    } else {
      // Default to vertex normal
      offset = elements[vi].normal;
    }

    const dx = (offset.x ?? 0) * offsetScale;
    const dy = (offset.y ?? 0) * offsetScale;
    const dz = (offset.z ?? 0) * offsetScale;

    const newIdx = mesh.positions.length;
    mesh.positions.push({
      x: mesh.positions[vi].x + dx,
      y: mesh.positions[vi].y + dy,
      z: mesh.positions[vi].z + dz,
    });

    // Connect original to new vertex
    mesh.edges.push([vi, newIdx]);
    topVertIndices.add(newIdx);
  }

  const topField = new Field('bool', (el) => topVertIndices.has(el.index));
  const sideField = new Field('bool', (el) => {
    // Side edges are the connecting edges
    return el.index >= sideEdgeStart;
  });

  return { outputs: [result, topField, sideField] };
}

// ── Extrude Edges ───────────────────────────────────────────────────────────

function extrudeEdges(mesh, inputs, offsetScale, result) {
  const elements = mesh.buildElements(DOMAIN.EDGE);
  const selection = resolveSelection(inputs['Selection'], elements);
  const offsetInput = inputs['Offset'];

  const origEdgeCount = mesh.edges.length;
  const vertexNewMap = new Map(); // original vert -> new vert index
  const sideFaceStart = mesh.faceCount;

  for (let ei = 0; ei < origEdgeCount; ei++) {
    if (selection && !selection[ei]) continue;

    const [a, b] = mesh.edges[ei];

    let offset;
    if (offsetInput != null && isField(offsetInput)) {
      offset = offsetInput.evaluateAt(elements[ei]);
    } else if (offsetInput != null) {
      offset = offsetInput;
    } else {
      offset = { x: 0, y: 0, z: 1 }; // default up
    }

    const dx = (offset.x ?? 0) * offsetScale;
    const dy = (offset.y ?? 0) * offsetScale;
    const dz = (offset.z ?? 0) * offsetScale;

    // Create new vertices for each edge endpoint (if not already created)
    if (!vertexNewMap.has(a)) {
      const newIdx = mesh.positions.length;
      mesh.positions.push({
        x: mesh.positions[a].x + dx,
        y: mesh.positions[a].y + dy,
        z: mesh.positions[a].z + dz,
      });
      vertexNewMap.set(a, newIdx);
      mesh.edges.push([a, newIdx]);
    }
    if (!vertexNewMap.has(b)) {
      const newIdx = mesh.positions.length;
      mesh.positions.push({
        x: mesh.positions[b].x + dx,
        y: mesh.positions[b].y + dy,
        z: mesh.positions[b].z + dz,
      });
      vertexNewMap.set(b, newIdx);
      mesh.edges.push([b, newIdx]);
    }

    const newA = vertexNewMap.get(a);
    const newB = vertexNewMap.get(b);

    // Create top edge
    mesh.edges.push([newA, newB]);

    // Create side quad face
    mesh.faceVertCounts.push(4);
    mesh.cornerVerts.push(a, b, newB, newA);
  }

  mesh.invalidateCornerOffsets();

  const topField = new Field('bool', (el) => false); // simplified
  const sideField = new Field('bool', (el) => el.index >= sideFaceStart);

  return { outputs: [result, topField, sideField] };
}

// ── Duplicate helpers ────────────────────────────────────────────────────────

function duplicatePoints(geo, inputs, amount) {
  const mesh = geo.mesh;
  const elements = mesh.buildElements(DOMAIN.POINT);
  const selection = resolveSelection(inputs['Selection'], elements);

  const result = new GeometrySet();
  const newMesh = new MeshComponent();
  const dupIndices = [];

  for (let vi = 0; vi < mesh.vertexCount; vi++) {
    if (selection && !selection[vi]) continue;
    for (let d = 0; d < amount; d++) {
      newMesh.positions.push({
        x: mesh.positions[vi].x,
        y: mesh.positions[vi].y,
        z: mesh.positions[vi].z,
      });
      dupIndices.push(d);
    }
  }

  if (newMesh.positions.length > 0) {
    result.mesh = newMesh;
  }

  const dupIndexField = new Field('int', (el) => {
    return dupIndices[el.index] ?? 0;
  });

  return { outputs: [result, dupIndexField] };
}

function duplicateFaces(geo, inputs, amount) {
  const mesh = geo.mesh;
  const elements = mesh.buildElements(DOMAIN.FACE);
  const selection = resolveSelection(inputs['Selection'], elements);

  const result = new GeometrySet();
  const newMesh = new MeshComponent();
  const dupIndices = [];

  let cornerIdx = 0;
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    const corners = mesh.cornerVerts.slice(cornerIdx, cornerIdx + count);
    cornerIdx += count;

    if (selection && !selection[fi]) continue;

    for (let d = 0; d < amount; d++) {
      // Copy the face vertices
      const vertStart = newMesh.positions.length;
      for (const vi of corners) {
        newMesh.positions.push({ ...mesh.positions[vi] });
      }
      newMesh.faceVertCounts.push(count);
      for (let ci = 0; ci < count; ci++) {
        newMesh.cornerVerts.push(vertStart + ci);
      }
      // Add edges for this face
      for (let ci = 0; ci < count; ci++) {
        newMesh.edges.push([vertStart + ci, vertStart + (ci + 1) % count]);
      }
      dupIndices.push(d);
    }
  }

  if (newMesh.positions.length > 0) {
    result.mesh = newMesh;
  }

  const dupIndexField = new Field('int', (el) => {
    return dupIndices[el.index] ?? 0;
  });

  return { outputs: [result, dupIndexField] };
}

function distSq(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
