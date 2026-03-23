/**
 * geo/nodes_v2_sampling.js - Geometry sampling nodes.
 *
 * Nodes: geometry_proximity, sample_index, sample_nearest
 *
 * Verified against Blender source:
 *   source/blender/nodes/geometry/nodes/node_geo_proximity.cc
 *   source/blender/nodes/geometry/nodes/node_geo_sample_index.cc
 *   source/blender/nodes/geometry/nodes/node_geo_sample_nearest.cc
 */

import { SocketType } from '../core/registry.js';
import {
  GeometrySet,
  DOMAIN,
} from '../core/geometry.js';
import { Field, isField, resolveField, resolveScalar } from '../core/field.js';

export function registerSamplingNodes(registry) {
  // ── Category ────────────────────────────────────────────────────────────
  registry.addCategory('geo', 'SAMPLE', { name: 'Sample', color: '#42A5F5', icon: '⊙' });

  // ── 1. Geometry Proximity ───────────────────────────────────────────────
  // Blender: node_geo_proximity.cc
  // "Compute the closest location on the target geometry"
  //
  // Inputs: Target (geometry, mesh/pointcloud), Source Position (vector field)
  // Outputs: Position (vector field), Distance (float field)
  // Property: Target Element (Points, Edges, Faces - default Faces)

  registry.addNode('geo', 'geometry_proximity', {
    label: 'Geometry Proximity',
    category: 'SAMPLE',
    inputs: [
      { name: 'Target', type: SocketType.GEOMETRY },
      { name: 'Source Position', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Position', type: SocketType.VECTOR },
      { name: 'Distance', type: SocketType.FLOAT },
    ],
    defaults: { target_element: 'FACES' },
    props: [
      {
        key: 'target_element', label: 'Target Element', type: 'select',
        options: [
          { value: 'POINTS', label: 'Points' },
          { value: 'EDGES', label: 'Edges' },
          { value: 'FACES', label: 'Faces' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const targetGeo = inputs['Target'];
      const sourcePosInput = inputs['Source Position'];
      const targetElement = values.target_element || 'FACES';

      if (!targetGeo || !targetGeo.mesh || targetGeo.mesh.vertexCount === 0) {
        return { outputs: [
          new Field('vector', () => ({ x: 0, y: 0, z: 0 })),
          new Field('float', () => 0),
        ]};
      }

      const mesh = targetGeo.mesh;

      // Build target element data based on mode
      let targetPoints;
      if (targetElement === 'POINTS') {
        targetPoints = mesh.positions.map(p => ({ x: p.x, y: p.y, z: p.z }));
      } else if (targetElement === 'EDGES') {
        // For edges, we'll find the closest point on each edge segment
        targetPoints = null; // handled differently
      } else {
        // FACES - use face centers as approximation, then project to face
        targetPoints = null; // handled differently
      }

      function findClosestPoint(queryPos) {
        let closestPos = { x: 0, y: 0, z: 0 };
        let closestDist = Infinity;

        if (targetElement === 'POINTS') {
          for (const p of mesh.positions) {
            const dx = queryPos.x - p.x;
            const dy = queryPos.y - p.y;
            const dz = queryPos.z - p.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < closestDist) {
              closestDist = dist;
              closestPos = { x: p.x, y: p.y, z: p.z };
            }
          }
        } else if (targetElement === 'EDGES') {
          for (const [a, b] of mesh.edges) {
            const pa = mesh.positions[a];
            const pb = mesh.positions[b];
            const closest = closestPointOnSegment(queryPos, pa, pb);
            const dx = queryPos.x - closest.x;
            const dy = queryPos.y - closest.y;
            const dz = queryPos.z - closest.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < closestDist) {
              closestDist = dist;
              closestPos = closest;
            }
          }
        } else {
          // FACES - find closest point on each triangle
          for (let fi = 0; fi < mesh.faceCount; fi++) {
            const verts = mesh.getFaceVertices(fi);
            // Triangulate face and test each triangle
            for (let ti = 1; ti < verts.length - 1; ti++) {
              const p0 = mesh.positions[verts[0]];
              const p1 = mesh.positions[verts[ti]];
              const p2 = mesh.positions[verts[ti + 1]];
              const closest = closestPointOnTriangle(queryPos, p0, p1, p2);
              const dx = queryPos.x - closest.x;
              const dy = queryPos.y - closest.y;
              const dz = queryPos.z - closest.z;
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dist < closestDist) {
                closestDist = dist;
                closestPos = closest;
              }
            }
          }
        }

        return { position: closestPos, distance: closestDist };
      }

      // Return field outputs
      const posField = new Field('vector', (el) => {
        const sourcePos = isField(sourcePosInput) ? sourcePosInput.evaluateAt(el) : (sourcePosInput || el.position);
        return findClosestPoint(sourcePos).position;
      });

      const distField = new Field('float', (el) => {
        const sourcePos = isField(sourcePosInput) ? sourcePosInput.evaluateAt(el) : (sourcePosInput || el.position);
        return findClosestPoint(sourcePos).distance;
      });

      return { outputs: [posField, distField] };
    },
  });

  // ── 2. Sample Index ─────────────────────────────────────────────────────
  // Blender: node_geo_sample_index.cc
  // "Retrieve values from specific geometry elements"
  //
  // Inputs: Geometry, Value (dynamic field), Index (int field)
  // Output: Value (dynamic field)
  // Properties: data_type (Float/Int/Vector/Bool/Color), domain, clamp

  registry.addNode('geo', 'sample_index', {
    label: 'Sample Index',
    category: 'SAMPLE',
    defaults: { data_type: 'FLOAT', domain: 'POINT', clamp: false },
    getInputs(values) {
      const socketType = dataTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Geometry', type: SocketType.GEOMETRY },
        { name: 'Value', type: socketType },
        { name: 'Index', type: SocketType.INT },
      ];
    },
    getOutputs(values) {
      const socketType = dataTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Value', type: socketType },
      ];
    },
    getProps() {
      return [
        {
          key: 'data_type', label: 'Data Type', type: 'select',
          options: [
            { value: 'FLOAT', label: 'Float' },
            { value: 'INT', label: 'Integer' },
            { value: 'FLOAT_VECTOR', label: 'Vector' },
            { value: 'BOOLEAN', label: 'Boolean' },
            { value: 'FLOAT_COLOR', label: 'Color' },
          ],
        },
        {
          key: 'domain', label: 'Domain', type: 'select',
          options: [
            { value: 'POINT', label: 'Point' },
            { value: 'EDGE', label: 'Edge' },
            { value: 'FACE', label: 'Face' },
            { value: 'CORNER', label: 'Face Corner' },
          ],
        },
        { key: 'clamp', label: 'Clamp', type: 'bool' },
      ];
    },
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      const valueInput = inputs['Value'];
      const indexInput = inputs['Index'];

      if (!geo) {
        return { outputs: [getDefaultForDataType(values.data_type)] };
      }

      const domainEnum = getDomainEnum(values.domain || 'POINT');
      const elements = geo.buildElements(domainEnum);
      const domainSize = elements.length;

      if (domainSize === 0) {
        return { outputs: [getDefaultForDataType(values.data_type)] };
      }

      // Evaluate the value field on the source geometry to get per-element values
      const resolvedValues = isField(valueInput)
        ? valueInput.evaluateAll(elements)
        : new Array(domainSize).fill(valueInput);

      // Return a field that samples at the given index
      const clamp = values.clamp;
      const resultField = new Field(
        dataTypeToFieldType(values.data_type || 'FLOAT'),
        (el) => {
          let idx = isField(indexInput) ? indexInput.evaluateAt(el) : (indexInput ?? 0);
          idx = Math.round(idx);

          if (clamp) {
            idx = Math.max(0, Math.min(domainSize - 1, idx));
          } else if (idx < 0 || idx >= domainSize) {
            return getDefaultForDataType(values.data_type);
          }

          return resolvedValues[idx];
        }
      );

      return { outputs: [resultField] };
    },
  });

  // ── 3. Sample Nearest ──────────────────────────────────────────────────
  // Blender: node_geo_sample_nearest.cc
  // "Find the element of a geometry closest to a position"
  //
  // Inputs: Geometry (mesh/pointcloud), Sample Position (vector field)
  // Output: Index (int field)
  // Property: Domain (Point, Edge, Face, Corner)

  registry.addNode('geo', 'sample_nearest', {
    label: 'Sample Nearest',
    category: 'SAMPLE',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Sample Position', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Index', type: SocketType.INT },
    ],
    defaults: { domain: 'POINT' },
    props: [
      {
        key: 'domain', label: 'Domain', type: 'select',
        options: [
          { value: 'POINT', label: 'Point' },
          { value: 'EDGE', label: 'Edge' },
          { value: 'FACE', label: 'Face' },
          { value: 'CORNER', label: 'Face Corner' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      const samplePosInput = inputs['Sample Position'];
      const domain = values.domain || 'POINT';

      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [new Field('int', () => 0)] };
      }

      const mesh = geo.mesh;

      const resultField = new Field('int', (el) => {
        const queryPos = isField(samplePosInput)
          ? samplePosInput.evaluateAt(el)
          : (samplePosInput || el.position);

        if (domain === 'POINT') {
          return findNearestVertex(mesh, queryPos);
        } else if (domain === 'EDGE') {
          return findNearestEdge(mesh, queryPos);
        } else if (domain === 'FACE') {
          return findNearestFace(mesh, queryPos);
        } else if (domain === 'CORNER') {
          // Find nearest face, then nearest corner within that face
          const faceIdx = findNearestFace(mesh, queryPos);
          const verts = mesh.getFaceVertices(faceIdx);
          const cornerStart = mesh.getFaceCornerStart(faceIdx);
          let closestCorner = cornerStart;
          let closestDist = Infinity;
          for (let ci = 0; ci < verts.length; ci++) {
            const p = mesh.positions[verts[ci]];
            const dx = queryPos.x - p.x;
            const dy = queryPos.y - p.y;
            const dz = queryPos.z - p.z;
            const dist = dx * dx + dy * dy + dz * dz;
            if (dist < closestDist) {
              closestDist = dist;
              closestCorner = cornerStart + ci;
            }
          }
          return closestCorner;
        }
        return 0;
      });

      return { outputs: [resultField] };
    },
  });
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

function closestPointOnSegment(point, segA, segB) {
  const abx = segB.x - segA.x;
  const aby = segB.y - segA.y;
  const abz = segB.z - segA.z;
  const apx = point.x - segA.x;
  const apy = point.y - segA.y;
  const apz = point.z - segA.z;

  const abLenSq = abx * abx + aby * aby + abz * abz;
  if (abLenSq < 1e-12) return { x: segA.x, y: segA.y, z: segA.z };

  let t = (apx * abx + apy * aby + apz * abz) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  return {
    x: segA.x + t * abx,
    y: segA.y + t * aby,
    z: segA.z + t * abz,
  };
}

function closestPointOnTriangle(point, v0, v1, v2) {
  // Compute vectors
  const e0x = v1.x - v0.x, e0y = v1.y - v0.y, e0z = v1.z - v0.z;
  const e1x = v2.x - v0.x, e1y = v2.y - v0.y, e1z = v2.z - v0.z;
  const vpx = point.x - v0.x, vpy = point.y - v0.y, vpz = point.z - v0.z;

  const d00 = e0x * e0x + e0y * e0y + e0z * e0z;
  const d01 = e0x * e1x + e0y * e1y + e0z * e1z;
  const d11 = e1x * e1x + e1y * e1y + e1z * e1z;
  const d20 = vpx * e0x + vpy * e0y + vpz * e0z;
  const d21 = vpx * e1x + vpy * e1y + vpz * e1z;

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) {
    return { x: v0.x, y: v0.y, z: v0.z };
  }

  let s = (d11 * d20 - d01 * d21) / denom;
  let t = (d00 * d21 - d01 * d20) / denom;

  // Clamp to triangle
  if (s < 0) s = 0;
  if (t < 0) t = 0;
  if (s + t > 1) {
    const total = s + t;
    s /= total;
    t /= total;
  }

  return {
    x: v0.x + s * e0x + t * e1x,
    y: v0.y + s * e0y + t * e1y,
    z: v0.z + s * e0z + t * e1z,
  };
}

function findNearestVertex(mesh, queryPos) {
  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < mesh.positions.length; i++) {
    const p = mesh.positions[i];
    const dx = queryPos.x - p.x;
    const dy = queryPos.y - p.y;
    const dz = queryPos.z - p.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  }
  return closestIdx;
}

function findNearestEdge(mesh, queryPos) {
  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < mesh.edges.length; i++) {
    const [a, b] = mesh.edges[i];
    const closest = closestPointOnSegment(queryPos, mesh.positions[a], mesh.positions[b]);
    const dx = queryPos.x - closest.x;
    const dy = queryPos.y - closest.y;
    const dz = queryPos.z - closest.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  }
  return closestIdx;
}

function findNearestFace(mesh, queryPos) {
  let closestIdx = 0;
  let closestDist = Infinity;
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    const center = mesh.getFaceCenter(fi);
    const dx = queryPos.x - center.x;
    const dy = queryPos.y - center.y;
    const dz = queryPos.z - center.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = fi;
    }
  }
  return closestIdx;
}

// ── Type helpers ─────────────────────────────────────────────────────────────

function dataTypeToSocket(dataType) {
  switch (dataType) {
    case 'FLOAT': return SocketType.FLOAT;
    case 'INT': return SocketType.INT;
    case 'FLOAT_VECTOR': return SocketType.VECTOR;
    case 'BOOLEAN': return SocketType.BOOL;
    case 'FLOAT_COLOR': return SocketType.COLOR;
    default: return SocketType.FLOAT;
  }
}

function dataTypeToFieldType(dataType) {
  switch (dataType) {
    case 'FLOAT': return 'float';
    case 'INT': return 'int';
    case 'FLOAT_VECTOR': return 'vector';
    case 'BOOLEAN': return 'bool';
    case 'FLOAT_COLOR': return 'color';
    default: return 'float';
  }
}

function getDefaultForDataType(dataType) {
  switch (dataType) {
    case 'FLOAT': return 0;
    case 'INT': return 0;
    case 'FLOAT_VECTOR': return { x: 0, y: 0, z: 0 };
    case 'BOOLEAN': return false;
    case 'FLOAT_COLOR': return { r: 0, g: 0, b: 0, a: 1 };
    default: return 0;
  }
}

function getDomainEnum(domain) {
  switch (domain) {
    case 'POINT': return DOMAIN.POINT;
    case 'EDGE': return DOMAIN.EDGE;
    case 'FACE': return DOMAIN.FACE;
    case 'CORNER': return DOMAIN.CORNER;
    default: return DOMAIN.POINT;
  }
}
