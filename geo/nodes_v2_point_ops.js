/**
 * geo/nodes_v2_point_ops.js - Point cloud operation nodes.
 *
 * Nodes: mesh_to_points, curve_to_points, distribute_points_on_faces
 *
 * These nodes convert geometry into point clouds (represented as mesh components
 * with positions only, no edges/faces). This matches Blender's behavior where
 * point clouds are a geometry type with per-point attributes.
 *
 * Reference: Blender source
 *   - source/blender/nodes/geometry/nodes/node_geo_mesh_to_points.cc
 *   - source/blender/nodes/geometry/nodes/node_geo_curve_to_points.cc
 *   - source/blender/nodes/geometry/nodes/node_geo_distribute_points_on_faces.cc
 */

import { SocketType } from '../core/registry.js';
import {
  GeometrySet,
  MeshComponent,
  DOMAIN,
  ATTR_TYPE,
} from '../core/geometry.js';
import { Field, isField, resolveField, resolveScalar } from '../core/field.js';
import {
  seededRandom,
  vecSub,
  vecAdd,
  vecScale,
  vecCross,
  vecLength,
  vecNormalize,
  vecDot,
} from '../core/utils.js';

// ── Triangle Helpers ────────────────────────────────────────────────────────

/**
 * Compute the area of a triangle defined by three vertices.
 * Uses the cross-product magnitude formula: area = |AB x AC| / 2
 */
function triangleArea(a, b, c) {
  const ab = vecSub(b, a);
  const ac = vecSub(c, a);
  const cross = vecCross(ab, ac);
  return vecLength(cross) * 0.5;
}

/**
 * Compute the normal of a triangle.
 */
function triangleNormal(a, b, c) {
  const ab = vecSub(b, a);
  const ac = vecSub(c, a);
  return vecNormalize(vecCross(ab, ac));
}

/**
 * Generate a uniformly random point on a triangle using barycentric coords.
 * Blender reference: BLI_math_geom, sample_triangle_surface
 *
 * @param {Object} a - First vertex {x, y, z}
 * @param {Object} b - Second vertex {x, y, z}
 * @param {Object} c - Third vertex {x, y, z}
 * @param {number} r1 - Random value [0, 1)
 * @param {number} r2 - Random value [0, 1)
 * @returns {Object} Point on triangle surface {x, y, z}
 */
function sampleTriangle(a, b, c, r1, r2) {
  // Standard uniform triangle sampling:
  // if r1 + r2 > 1, reflect to keep inside triangle
  let u = r1;
  let v = r2;
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }
  const w = 1 - u - v;
  return {
    x: w * a.x + u * b.x + v * c.x,
    y: w * a.y + u * b.y + v * c.y,
    z: w * a.z + u * b.z + v * c.z,
  };
}

/**
 * Triangulate a polygon (fan triangulation from first vertex).
 * Returns array of [a, b, c] vertex position triples.
 */
function triangulateFace(positions, vertexIndices) {
  const tris = [];
  const a = positions[vertexIndices[0]];
  for (let i = 1; i < vertexIndices.length - 1; i++) {
    const b = positions[vertexIndices[i]];
    const c = positions[vertexIndices[i + 1]];
    tris.push([a, b, c]);
  }
  return tris;
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerPointOpNodes(registry) {
  registry.addCategory('geo', 'POINT', { name: 'Point', color: '#26C6DA', icon: '.' });

  // ═══════════════════════════════════════════════════════════════════════════
  // MESH TO POINTS
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Blender reference: node_geo_mesh_to_points.cc
  //
  // Converts mesh elements to a point cloud. The Mode determines which
  // domain's elements become points:
  //   VERTICES - one point per vertex at vertex position
  //   EDGES    - one point per edge at edge midpoint
  //   FACES    - one point per face at face center
  //   CORNERS  - one point per face corner at corner vertex position
  //
  // Inputs:
  //   Mesh      - source geometry
  //   Selection - bool field, which elements to convert (default: all)
  //   Position  - vector field, override point positions (default: element position)
  //   Radius    - float field, per-point radius attribute (default: 0.05)
  //
  // Output:
  //   Points - GeometrySet with mesh component (positions only, no topology)

  registry.addNode('geo', 'mesh_to_points', {
    label: 'Mesh to Points',
    category: 'POINT',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Position', type: SocketType.VECTOR },
      { name: 'Radius', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Points', type: SocketType.GEOMETRY },
    ],
    defaults: { mode: 'VERTICES', radius: 0.05 },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'VERTICES', label: 'Vertices' },
          { value: 'EDGES', label: 'Edges' },
          { value: 'FACES', label: 'Faces' },
          { value: 'CORNERS', label: 'Corners' },
        ],
      },
      { key: 'radius', label: 'Radius', type: 'float', min: 0, max: 100, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [new GeometrySet()] };
      }

      const mesh = geo.mesh;
      const mode = values.mode || 'VERTICES';

      // Map mode to domain
      const domainMap = {
        'VERTICES': DOMAIN.POINT,
        'EDGES': DOMAIN.EDGE,
        'FACES': DOMAIN.FACE,
        'CORNERS': DOMAIN.CORNER,
      };
      const domain = domainMap[mode] || DOMAIN.POINT;

      // Build element contexts for the chosen domain
      const elements = mesh.buildElements(domain);
      if (elements.length === 0) {
        return { outputs: [new GeometrySet()] };
      }

      // Evaluate selection field
      const selectionInput = inputs['Selection'];
      let selection = null;
      if (selectionInput != null) {
        selection = isField(selectionInput)
          ? selectionInput.evaluateAll(elements)
          : new Array(elements.length).fill(!!selectionInput);
      }

      // Evaluate position field (default: element's own position)
      const positionInput = inputs['Position'];
      let positions;
      if (positionInput != null) {
        positions = isField(positionInput)
          ? positionInput.evaluateAll(elements)
          : new Array(elements.length).fill(positionInput);
      } else {
        positions = elements.map(el => ({ x: el.position.x, y: el.position.y, z: el.position.z }));
      }

      // Evaluate radius field
      const radiusInput = inputs['Radius'] ?? values.radius;
      let radii;
      if (isField(radiusInput)) {
        radii = radiusInput.evaluateAll(elements);
      } else {
        radii = new Array(elements.length).fill(radiusInput);
      }

      // Build output point cloud
      const result = new GeometrySet();
      const outMesh = new MeshComponent();
      const outRadii = [];

      for (let i = 0; i < elements.length; i++) {
        if (selection && !selection[i]) continue;
        outMesh.positions.push({
          x: positions[i].x ?? 0,
          y: positions[i].y ?? 0,
          z: positions[i].z ?? 0,
        });
        outRadii.push(radii[i] ?? 0.05);
      }

      // Store radius as a point attribute (matches Blender's point cloud radius)
      outMesh.pointAttrs.set('radius', ATTR_TYPE.FLOAT, outRadii);

      result.mesh = outMesh;
      return { outputs: [result] };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CURVE TO POINTS
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Blender reference: node_geo_curve_to_points.cc
  //
  // Evaluates each spline and creates points along the curve.
  // Three modes:
  //   COUNT     - fixed number of evenly-spaced points per spline
  //   LENGTH    - points spaced by arc length
  //   EVALUATED - uses the spline's natural evaluation resolution
  //
  // Outputs position, tangent, normal, and rotation at each point.
  // Rotation is computed from tangent/normal using the Frenet frame,
  // stored as Euler XYZ matching Blender's convention.
  //
  // Inputs:
  //   Curve  - source geometry with curve component
  //   Count  - number of points per spline (COUNT mode)
  //   Length - arc-length spacing between points (LENGTH mode)
  //
  // Outputs:
  //   Points   - GeometrySet with point cloud
  //   Tangent  - vector field (per-point tangent direction)
  //   Normal   - vector field (per-point normal direction)
  //   Rotation - vector field (Euler XYZ rotation from Frenet frame)

  registry.addNode('geo', 'curve_to_points', {
    label: 'Curve to Points',
    category: 'POINT',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Count', type: SocketType.INT },
      { name: 'Length', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Points', type: SocketType.GEOMETRY },
      { name: 'Tangent', type: SocketType.VECTOR },
      { name: 'Normal', type: SocketType.VECTOR },
      { name: 'Rotation', type: SocketType.VECTOR },
    ],
    defaults: { mode: 'COUNT', count: 10, length: 0.1 },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'COUNT', label: 'Count' },
          { value: 'LENGTH', label: 'Length' },
          { value: 'EVALUATED', label: 'Evaluated' },
        ],
      },
      { key: 'count', label: 'Count', type: 'int', min: 2, max: 10000, step: 1 },
      { key: 'length', label: 'Length', type: 'float', min: 0.001, max: 1000, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [new GeometrySet(), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] };
      }

      const curve = geo.curve;
      const mode = values.mode || 'COUNT';
      const countParam = resolveScalar(inputs['Count'] ?? values.count, values.count);
      const lengthParam = resolveScalar(inputs['Length'] ?? values.length, values.length);

      const outMesh = new MeshComponent();
      const tangents = [];
      const normals = [];
      const rotations = [];
      const outRadii = [];

      for (let si = 0; si < curve.splines.length; si++) {
        const spline = curve.splines[si];

        // Determine sample count based on mode
        let sampleCount;
        if (mode === 'COUNT') {
          sampleCount = Math.max(2, Math.round(countParam));
        } else if (mode === 'LENGTH') {
          const splineLen = curve.splineLength(si, 64);
          sampleCount = Math.max(2, Math.round(splineLen / Math.max(0.001, lengthParam)) + 1);
        } else {
          // EVALUATED: use spline's resolution * number of segments
          const n = spline.positions.length;
          const segCount = spline.cyclic ? n : Math.max(1, n - 1);
          sampleCount = Math.max(2, segCount * (spline.resolution || 12));
        }

        // Compute Frenet frame with parallel transport
        let prevNormal = null;
        for (let i = 0; i < sampleCount; i++) {
          const t = sampleCount > 1 ? i / (sampleCount - 1) : 0;
          const pos = curve.evaluateSpline(si, t);
          const tangent = curve.evaluateSplineTangent(si, t);
          const radius = curve.evaluateSplineRadius(si, t);

          // Compute normal via parallel transport
          let normal;
          if (prevNormal) {
            const dot = vecDot(prevNormal, tangent);
            normal = {
              x: prevNormal.x - dot * tangent.x,
              y: prevNormal.y - dot * tangent.y,
              z: prevNormal.z - dot * tangent.z,
            };
          } else {
            const up = Math.abs(tangent.y) < 0.99
              ? { x: 0, y: 1, z: 0 }
              : { x: 1, y: 0, z: 0 };
            normal = vecCross(tangent, up);
          }
          normal = vecNormalize(normal);
          prevNormal = normal;

          // Compute rotation as Euler XYZ from tangent + normal
          // Blender convention: tangent along +Z for curves, normal along +X
          // Rotation matrix columns: normal, binormal, tangent
          const binormal = vecNormalize(vecCross(tangent, normal));
          const rotation = matrixToEulerXYZ(normal, binormal, tangent);

          outMesh.positions.push(pos);
          tangents.push({ x: tangent.x, y: tangent.y, z: tangent.z });
          normals.push({ x: normal.x, y: normal.y, z: normal.z });
          rotations.push(rotation);
          outRadii.push(radius);
        }
      }

      // Store per-point attributes
      outMesh.pointAttrs.set('radius', ATTR_TYPE.FLOAT, outRadii);

      const result = new GeometrySet();
      result.mesh = outMesh;

      // Create attribute fields that read from stored arrays
      const tangentField = new Field('vector', (el) => {
        const idx = el.index ?? 0;
        return tangents[idx] || { x: 0, y: 0, z: 1 };
      });
      const normalField = new Field('vector', (el) => {
        const idx = el.index ?? 0;
        return normals[idx] || { x: 1, y: 0, z: 0 };
      });
      const rotationField = new Field('vector', (el) => {
        const idx = el.index ?? 0;
        return rotations[idx] || { x: 0, y: 0, z: 0 };
      });

      return { outputs: [result, tangentField, normalField, rotationField] };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DISTRIBUTE POINTS ON FACES
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Blender reference: node_geo_distribute_points_on_faces.cc
  //
  // Distributes points on the surface of mesh faces.
  //
  // RANDOM mode:
  //   - For each face, compute area
  //   - Total points = sum(face_area * density)
  //   - Points are uniformly sampled on triangle surfaces
  //   - Uses barycentric coordinate sampling after fan-triangulating polygons
  //
  // POISSON mode:
  //   - Uses Poisson disk sampling with minimum distance constraint
  //   - Starts with random candidates, rejects points too close to existing ones
  //   - Distance Min controls spacing, Density Factor modulates local density
  //
  // Inputs:
  //   Mesh           - source geometry
  //   Selection      - bool field on FACE domain (which faces to use)
  //   Distance Min   - minimum spacing between points (POISSON only)
  //   Density Max    - maximum density (points per unit area, POISSON)
  //   Density        - density value (points per unit area, RANDOM)
  //   Density Factor - per-face density multiplier field (POISSON)
  //   Seed           - random seed
  //
  // Outputs:
  //   Points   - GeometrySet with point cloud
  //   Normal   - vector field (face normal at each point)
  //   Rotation - vector field (rotation aligning Z to face normal)

  registry.addNode('geo', 'distribute_points_on_faces', {
    label: 'Distribute Points on Faces',
    category: 'POINT',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Distance Min', type: SocketType.FLOAT },
      { name: 'Density Max', type: SocketType.FLOAT },
      { name: 'Density', type: SocketType.FLOAT },
      { name: 'Density Factor', type: SocketType.FLOAT },
      { name: 'Seed', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Points', type: SocketType.GEOMETRY },
      { name: 'Normal', type: SocketType.VECTOR },
      { name: 'Rotation', type: SocketType.VECTOR },
    ],
    defaults: { mode: 'RANDOM', density: 10, distanceMin: 0.1, densityMax: 10, seed: 0 },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'RANDOM', label: 'Random' },
          { value: 'POISSON', label: 'Poisson Disk' },
        ],
      },
      { key: 'density', label: 'Density', type: 'float', min: 0, max: 10000, step: 1 },
      { key: 'distanceMin', label: 'Distance Min', type: 'float', min: 0.001, max: 100, step: 0.01 },
      { key: 'densityMax', label: 'Density Max', type: 'float', min: 0, max: 10000, step: 1 },
      { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 100000, step: 1 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.faceCount === 0) {
        return { outputs: [new GeometrySet(), { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }] };
      }

      const mesh = geo.mesh;
      const mode = values.mode || 'RANDOM';
      const seed = resolveScalar(inputs['Seed'] ?? values.seed, values.seed);

      // Evaluate face-domain selection
      const faceElements = mesh.buildElements(DOMAIN.FACE);
      const selectionInput = inputs['Selection'];
      let faceSelection = null;
      if (selectionInput != null) {
        faceSelection = isField(selectionInput)
          ? selectionInput.evaluateAll(faceElements)
          : new Array(faceElements.length).fill(!!selectionInput);
      }

      const outPositions = [];
      const outNormals = [];
      const outRotations = [];

      if (mode === 'RANDOM') {
        const density = resolveScalar(inputs['Density'] ?? values.density, values.density);
        _distributeRandom(mesh, faceSelection, density, seed, outPositions, outNormals, outRotations);
      } else {
        const distanceMin = resolveScalar(inputs['Distance Min'] ?? values.distanceMin, values.distanceMin);
        const densityMax = resolveScalar(inputs['Density Max'] ?? values.densityMax, values.densityMax);
        const densityFactorInput = inputs['Density Factor'];
        _distributePoisson(mesh, faceSelection, distanceMin, densityMax, densityFactorInput, seed, faceElements, outPositions, outNormals, outRotations);
      }

      // Build output geometry
      const outMesh = new MeshComponent();
      outMesh.positions = outPositions;

      const result = new GeometrySet();
      result.mesh = outMesh;

      // Create per-point attribute fields from stored arrays
      const normalField = new Field('vector', (el) => {
        const idx = el.index ?? 0;
        return outNormals[idx] || { x: 0, y: 1, z: 0 };
      });
      const rotationField = new Field('vector', (el) => {
        const idx = el.index ?? 0;
        return outRotations[idx] || { x: 0, y: 0, z: 0 };
      });

      return { outputs: [result, normalField, rotationField] };
    },
  });

  // ── Points ──────────────────────────────────────────────────────────────
  // Blender: node_geo_points.cc
  // "Generate a point cloud with positions and radii"
  //
  // Inputs: Count (int, default 1, min 0), Position (vector field),
  //         Radius (float field, default 0.1)
  // Output: Points (geometry)

  registry.addNode('geo', 'points', {
    label: 'Points',
    category: 'POINT',
    inputs: [
      { name: 'Count', type: SocketType.INT },
      { name: 'Position', type: SocketType.VECTOR },
      { name: 'Radius', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Points', type: SocketType.GEOMETRY },
    ],
    defaults: { count: 1, radius: 0.1 },
    props: [
      { key: 'count', label: 'Count', type: 'int', min: 0, max: 10000, step: 1 },
      { key: 'radius', label: 'Radius', type: 'float', min: 0, max: 1000, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const count = inputs['Count'] != null ? Math.max(0, Math.round(inputs['Count'])) : values.count;
      const posInput = inputs['Position'];
      const radiusInput = inputs['Radius'];

      if (count === 0) return { outputs: [new GeometrySet()] };

      const mesh = new MeshComponent();

      // Build elements for field evaluation
      const elements = [];
      for (let i = 0; i < count; i++) {
        elements.push({
          index: i,
          count,
          position: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
        });
      }

      // Evaluate position field
      if (posInput != null && isField(posInput)) {
        const positions = posInput.evaluateAll(elements);
        for (let i = 0; i < count; i++) {
          mesh.positions.push(positions[i] || { x: 0, y: 0, z: 0 });
        }
      } else {
        const pos = posInput || { x: 0, y: 0, z: 0 };
        for (let i = 0; i < count; i++) {
          mesh.positions.push({ x: pos.x, y: pos.y, z: pos.z });
        }
      }

      const result = new GeometrySet();
      result.mesh = mesh;
      return { outputs: [result] };
    },
  });
}

// ── RANDOM Distribution ─────────────────────────────────────────────────────
//
// Blender's algorithm:
// 1. For each selected face, triangulate into triangles
// 2. Compute area of each triangle
// 3. Number of points per triangle = area * density
// 4. Sample points uniformly on each triangle using barycentric coords

function _distributeRandom(mesh, faceSelection, density, seed, outPositions, outNormals, outRotations) {
  let globalSeedOffset = 0;

  for (let fi = 0; fi < mesh.faceCount; fi++) {
    if (faceSelection && !faceSelection[fi]) continue;

    const vertIndices = mesh.getFaceVertices(fi);
    const faceNormal = mesh.getFaceNormal(fi);
    const faceRotation = normalToEulerZ(faceNormal);

    // Triangulate the face (fan from first vertex)
    const tris = triangulateFace(mesh.positions, vertIndices);

    for (const [a, b, c] of tris) {
      const area = triangleArea(a, b, c);
      // Number of points for this triangle: use fractional part probabilistically
      const exactCount = area * density;
      const baseCount = Math.floor(exactCount);
      const fractional = exactCount - baseCount;

      // Use a deterministic random to decide if we get +1 point
      const extraRand = seededRandom((fi * 73856093 + globalSeedOffset * 19349663) ^ seed);
      const pointCount = baseCount + (extraRand < fractional ? 1 : 0);

      for (let pi = 0; pi < pointCount; pi++) {
        const r1 = seededRandom((globalSeedOffset * 73856093 + pi * 19349663) ^ seed);
        const r2 = seededRandom((globalSeedOffset * 19349663 + pi * 83492791) ^ seed);
        const point = sampleTriangle(a, b, c, r1, r2);

        outPositions.push(point);
        outNormals.push({ x: faceNormal.x, y: faceNormal.y, z: faceNormal.z });
        outRotations.push({ x: faceRotation.x, y: faceRotation.y, z: faceRotation.z });
        globalSeedOffset++;
      }
    }
  }
}

// ── POISSON Disk Distribution ───────────────────────────────────────────────
//
// Blender's algorithm uses weighted Poisson disk sampling:
// 1. Generate candidate points on each face
// 2. Accept candidates only if they are at least distanceMin away from all
//    previously accepted points
// 3. Density factor modulates per-face acceptance probability
//
// We implement a simplified but faithful version using spatial hashing for
// efficient distance checks.

function _distributePoisson(mesh, faceSelection, distanceMin, densityMax, densityFactorInput, seed, faceElements, outPositions, outNormals, outRotations) {
  // Spatial hash for fast neighbor lookups
  const cellSize = Math.max(distanceMin, 0.001);
  const grid = new Map();

  function hashKey(x, y, z) {
    const ix = Math.floor(x / cellSize);
    const iy = Math.floor(y / cellSize);
    const iz = Math.floor(z / cellSize);
    return `${ix},${iy},${iz}`;
  }

  function isTooClose(point) {
    const ix = Math.floor(point.x / cellSize);
    const iy = Math.floor(point.y / cellSize);
    const iz = Math.floor(point.z / cellSize);

    // Check 3x3x3 neighborhood
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${ix + dx},${iy + dy},${iz + dz}`;
          const bucket = grid.get(key);
          if (!bucket) continue;
          for (const other of bucket) {
            const ddx = point.x - other.x;
            const ddy = point.y - other.y;
            const ddz = point.z - other.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz < distanceMin * distanceMin) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  function addToGrid(point) {
    const key = hashKey(point.x, point.y, point.z);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(point);
  }

  // Evaluate density factor per face
  let densityFactors = null;
  if (densityFactorInput != null) {
    densityFactors = isField(densityFactorInput)
      ? densityFactorInput.evaluateAll(faceElements)
      : new Array(faceElements.length).fill(
          typeof densityFactorInput === 'number' ? densityFactorInput : 1
        );
  }

  let globalSeedOffset = 0;

  for (let fi = 0; fi < mesh.faceCount; fi++) {
    if (faceSelection && !faceSelection[fi]) continue;

    const vertIndices = mesh.getFaceVertices(fi);
    const faceNormal = mesh.getFaceNormal(fi);
    const faceRotation = normalToEulerZ(faceNormal);
    const faceDensityFactor = densityFactors ? (densityFactors[fi] ?? 1) : 1;

    const tris = triangulateFace(mesh.positions, vertIndices);

    for (const [a, b, c] of tris) {
      const area = triangleArea(a, b, c);
      // Generate candidates: use densityMax * area as max candidate count
      const candidateCount = Math.ceil(area * densityMax * faceDensityFactor);

      for (let pi = 0; pi < candidateCount; pi++) {
        const r1 = seededRandom((globalSeedOffset * 73856093 + pi * 19349663) ^ seed);
        const r2 = seededRandom((globalSeedOffset * 19349663 + pi * 83492791) ^ seed);
        const point = sampleTriangle(a, b, c, r1, r2);

        if (!isTooClose(point)) {
          addToGrid(point);
          outPositions.push(point);
          outNormals.push({ x: faceNormal.x, y: faceNormal.y, z: faceNormal.z });
          outRotations.push({ x: faceRotation.x, y: faceRotation.y, z: faceRotation.z });
        }
        globalSeedOffset++;
      }
    }
  }
}

// ── Rotation Helpers ────────────────────────────────────────────────────────

/**
 * Compute Euler XYZ rotation from a rotation matrix given as column vectors.
 * Columns: X-axis (right), Y-axis (up), Z-axis (forward)
 *
 * Blender uses XYZ Euler convention:
 *   ry = asin(-m[2][0])
 *   rx = atan2(m[2][1], m[2][2])
 *   rz = atan2(m[1][0], m[0][0])
 */
function matrixToEulerXYZ(xAxis, yAxis, zAxis) {
  // m[row][col] where columns are xAxis, yAxis, zAxis
  // m00=xAxis.x, m01=yAxis.x, m02=zAxis.x
  // m10=xAxis.y, m11=yAxis.y, m12=zAxis.y
  // m20=xAxis.z, m21=yAxis.z, m22=zAxis.z
  const m20 = xAxis.z;
  const m21 = yAxis.z;
  const m22 = zAxis.z;
  const m10 = xAxis.y;
  const m00 = xAxis.x;

  const ry = Math.asin(-Math.max(-1, Math.min(1, m20)));

  let rx, rz;
  if (Math.abs(m20) < 0.9999) {
    rx = Math.atan2(m21, m22);
    rz = Math.atan2(m10, m00);
  } else {
    // Gimbal lock
    rx = Math.atan2(-yAxis.x, yAxis.y);
    rz = 0;
  }

  return { x: rx, y: ry, z: rz };
}

/**
 * Compute Euler rotation that aligns the +Z axis to the given normal.
 * Used for distributing instances oriented to face normals.
 *
 * Blender reference: BLI_math_rotation, rotation_between_vecs_to_euler
 */
function normalToEulerZ(normal) {
  // Build a rotation matrix where Z column = normal
  const n = vecNormalize(normal);

  // Choose a stable "up" reference that isn't parallel to normal
  const up = Math.abs(n.z) < 0.99
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };

  // Right vector (X axis)
  const right = vecNormalize(vecCross(up, n));
  // Recompute up (Y axis) to ensure orthogonality
  const realUp = vecCross(n, right);

  return matrixToEulerXYZ(right, realUp, n);
}
