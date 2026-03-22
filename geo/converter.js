/**
 * geo/converter.js - Converts GeometrySet to Three.js objects for rendering.
 *
 * This is the ONLY place Three.js touches geometry data.
 * All node evaluation works on real GeometrySet data; this module converts
 * the final result to renderable Three.js meshes/lines at the very end.
 */

import { DOMAIN } from '../core/geometry.js';

/* global THREE */

// ── Coordinate Conversion ────────────────────────────────────────────────────
// Blender uses Z-up; Three.js uses Y-up. We keep geometry data in Blender
// conventions (Z-up) and convert here at render time: swap Y and Z.
function zUpToYUp(x, y, z) {
  return { x, y: z, z: -y };
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Convert a GeometrySet to Three.js objects.
 * Returns { objects: [THREE.Object3D, ...], verts: number, faces: number }
 */
export function geometrySetToThreeJS(geoSet, wireframe = false) {
  const objects = [];
  let totalVerts = 0, totalFaces = 0;

  if (geoSet.hasMesh) {
    const result = meshToThreeJS(geoSet.mesh, wireframe);
    if (result) {
      objects.push(result.object);
      totalVerts += result.verts;
      totalFaces += result.faces;
    }
  }

  if (geoSet.hasCurve) {
    const result = curveToThreeJS(geoSet.curve);
    if (result) {
      objects.push(result.object);
      totalVerts += result.verts;
    }
  }

  if (geoSet.hasInstances) {
    const result = instancesToThreeJS(geoSet.instances, wireframe);
    if (result) {
      for (const obj of result.objects) objects.push(obj);
      totalVerts += result.verts;
      totalFaces += result.faces;
    }
  }

  return { objects, verts: totalVerts, faces: totalFaces };
}

// ── Mesh Conversion ──────────────────────────────────────────────────────────

function meshToThreeJS(mesh, wireframe) {
  if (mesh.vertexCount === 0) return null;

  const geometry = new THREE.BufferGeometry();

  // Positions
  const posArr = new Float32Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount; i++) {
    const p = mesh.positions[i];
    // Z-up (Blender) → Y-up (Three.js): swap Y↔Z, negate new Z
    const conv = zUpToYUp(p.x, p.y, p.z);
    posArr[i * 3] = conv.x;
    posArr[i * 3 + 1] = conv.y;
    posArr[i * 3 + 2] = conv.z;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

  // Build index buffer (triangulate polygons)
  if (mesh.faceCount > 0) {
    const indices = triangulatePolygons(mesh);
    geometry.setIndex(indices);

    // Normals (also convert coordinate space)
    const normals = mesh.computeVertexNormals();
    const normArr = new Float32Array(mesh.vertexCount * 3);
    for (let i = 0; i < normals.length; i++) {
      const n = zUpToYUp(normals[i].x, normals[i].y, normals[i].z);
      normArr[i * 3] = n.x;
      normArr[i * 3 + 1] = n.y;
      normArr[i * 3 + 2] = n.z;
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));

    // UVs if available
    const uvData = mesh.cornerAttrs.get('uv_map');
    if (uvData) {
      const uvArr = buildPerVertexUVs(mesh, uvData);
      if (uvArr) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
      }
    }

    let object;
    if (wireframe) {
      const edges = new THREE.EdgesGeometry(geometry);
      const mat = new THREE.LineBasicMaterial({ color: 0x69f0ae });
      object = new THREE.LineSegments(edges, mat);
    } else {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x69f0ae,
        roughness: 0.5,
        metalness: 0.1,
        side: THREE.DoubleSide,
        flatShading: false,
      });
      object = new THREE.Mesh(geometry, mat);
    }

    return { object, verts: mesh.vertexCount, faces: mesh.faceCount };
  }

  // No faces — render as points or wireframe edges
  if (mesh.edgeCount > 0) {
    const lineIndices = [];
    for (const [a, b] of mesh.edges) {
      lineIndices.push(a, b);
    }
    geometry.setIndex(lineIndices);
    const mat = new THREE.LineBasicMaterial({ color: 0x69f0ae });
    const object = new THREE.LineSegments(geometry, mat);
    return { object, verts: mesh.vertexCount, faces: 0 };
  }

  // Points only
  const mat = new THREE.PointsMaterial({ color: 0x69f0ae, size: 0.05 });
  const object = new THREE.Points(geometry, mat);
  return { object, verts: mesh.vertexCount, faces: 0 };
}

/**
 * Triangulate polygon faces into triangle indices.
 * Uses simple fan triangulation (works for convex polygons).
 */
function triangulatePolygons(mesh) {
  const indices = [];
  let cornerIdx = 0;

  for (let fi = 0; fi < mesh.faceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    if (count < 3) {
      cornerIdx += count;
      continue;
    }

    // Fan triangulation from first vertex
    const v0 = mesh.cornerVerts[cornerIdx];
    for (let j = 1; j < count - 1; j++) {
      indices.push(
        v0,
        mesh.cornerVerts[cornerIdx + j],
        mesh.cornerVerts[cornerIdx + j + 1]
      );
    }
    cornerIdx += count;
  }

  return indices;
}

/**
 * Build per-vertex UV array from per-corner UV data.
 * Simple approach: use first occurrence of each vertex's UV.
 */
function buildPerVertexUVs(mesh, uvCornerData) {
  if (!uvCornerData || uvCornerData.length === 0) return null;
  const uvArr = new Float32Array(mesh.vertexCount * 2);
  const assigned = new Uint8Array(mesh.vertexCount);

  for (let ci = 0; ci < mesh.cornerCount && ci < uvCornerData.length; ci++) {
    const vi = mesh.cornerVerts[ci];
    if (!assigned[vi]) {
      assigned[vi] = 1;
      const uv = uvCornerData[ci];
      uvArr[vi * 2] = uv.x;
      uvArr[vi * 2 + 1] = uv.y;
    }
  }

  return uvArr;
}

// ── Curve Conversion ─────────────────────────────────────────────────────────

function curveToThreeJS(curve) {
  if (curve.splineCount === 0) return null;

  const group = new THREE.Group();
  let totalVerts = 0;

  for (let si = 0; si < curve.splineCount; si++) {
    const spline = curve.splines[si];
    const resolution = spline.resolution || 12;

    // Evaluate spline into dense point array
    const numSamples = Math.max(spline.positions.length, resolution * (spline.positions.length - 1 + (spline.cyclic ? 1 : 0)));
    const sampleCount = Math.max(2, numSamples);

    const positions = new Float32Array(sampleCount * 3);
    for (let i = 0; i < sampleCount; i++) {
      const t = spline.cyclic ? i / sampleCount : i / (sampleCount - 1);
      const pt = curve.evaluateSpline(si, t);
      const conv = zUpToYUp(pt.x, pt.y, pt.z);
      positions[i * 3] = conv.x;
      positions[i * 3 + 1] = conv.y;
      positions[i * 3 + 2] = conv.z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({ color: 0xffd54f, linewidth: 2 });
    const line = spline.cyclic ? new THREE.LineLoop(geometry, mat) : new THREE.Line(geometry, mat);
    group.add(line);
    totalVerts += sampleCount;
  }

  return { object: group, verts: totalVerts };
}

// ── Instances Conversion ─────────────────────────────────────────────────────

/**
 * Convert Euler XYZ rotation from Blender's Z-up to Three.js Y-up coordinate system.
 *
 * We build the rotation matrix in Blender space, apply the Z-up→Y-up axis swap,
 * then extract Euler angles in Three.js convention. This is mathematically correct
 * unlike naive component swapping, because Euler rotations don't commute.
 */
function convertRotationZUpToYUp(rx, ry, rz) {
  // Build rotation matrix in Z-up (Blender) space: R = Rz * Ry * Rx
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Combined matrix columns (Blender Z-up space)
  // m[row][col] for row-major indexing
  const m00 = cy * cz;
  const m01 = sx * sy * cz - cx * sz;
  const m02 = cx * sy * cz + sx * sz;
  const m10 = cy * sz;
  const m11 = sx * sy * sz + cx * cz;
  const m12 = cx * sy * sz - sx * cz;
  const m20 = -sy;
  const m21 = sx * cy;
  const m22 = cx * cy;

  // Apply coordinate swap: Blender (x,y,z) → Three.js (x,z,-y)
  // The swap matrix S maps: x'=x, y'=z, z'=-y
  // New rotation = S * R * S^(-1)
  // S^(-1): x=x', y=-z', z=y'
  //
  // Result matrix R' = S * R * S^(-1):
  // Row 0 (x): R'[0][0]=m00, R'[0][1]=m02, R'[0][2]=-m01
  // Row 1 (y→z): R'[1][0]=m20, R'[1][1]=m22, R'[1][2]=-m21
  // Row 2 (z→-y): R'[2][0]=-m10, R'[2][1]=-m12, R'[2][2]=m11
  const r00 = m00,  r01 = m02,  r02 = -m01;
  const r10 = m20,  r11 = m22,  r12 = -m21;
  const r20 = -m10, r21 = -m12, r22 = m11;

  // Extract Euler XYZ from the converted matrix (Three.js convention)
  const outRy = Math.asin(-Math.max(-1, Math.min(1, r20)));
  let outRx, outRz;
  if (Math.abs(r20) < 0.9999) {
    outRx = Math.atan2(r21, r22);
    outRz = Math.atan2(r10, r00);
  } else {
    outRx = Math.atan2(-r12, r11);
    outRz = 0;
  }

  return { x: outRx, y: outRy, z: outRz };
}

function instancesToThreeJS(instances, wireframe) {
  if (instances.instanceCount === 0) return null;

  const results = { objects: [], verts: 0, faces: 0 };

  for (let i = 0; i < instances.instanceCount; i++) {
    const transform = instances.transforms[i];
    const ref = instances.references[i];
    if (!ref) continue;

    const converted = geometrySetToThreeJS(ref, wireframe);
    for (const obj of converted.objects) {
      // Position: Z-up to Y-up conversion
      const pos = zUpToYUp(transform.position.x, transform.position.y, transform.position.z);
      obj.position.set(pos.x, pos.y, pos.z);
      // Rotation: proper matrix-based coordinate conversion
      const rot = convertRotationZUpToYUp(
        transform.rotation.x, transform.rotation.y, transform.rotation.z
      );
      obj.rotation.set(rot.x, rot.y, rot.z);
      // Scale: swap Y↔Z axes (safe for diagonal scale)
      obj.scale.set(transform.scale.x, transform.scale.z, transform.scale.y);
      results.objects.push(obj);
    }
    results.verts += converted.verts;
    results.faces += converted.faces;
  }

  return results;
}

// ── Batch conversion for multiple GeometrySets ───────────────────────────────

/**
 * Convert an array of GeometrySets to Three.js objects.
 * Used by the viewport to render evaluation results.
 */
export function convertAllGeometry(geoSets, wireframe = false) {
  const allObjects = [];
  let totalVerts = 0, totalFaces = 0;

  for (const gs of geoSets) {
    if (!gs) continue;
    const result = geometrySetToThreeJS(gs, wireframe);
    allObjects.push(...result.objects);
    totalVerts += result.verts;
    totalFaces += result.faces;
  }

  return { objects: allObjects, verts: totalVerts, faces: totalFaces };
}
