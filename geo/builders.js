/**
 * geo/builders.js - Build Three.js geometries from geometry data descriptors.
 *
 * THREE is available as a global (loaded via CDN script tag before modules).
 */

import { seededRandom } from '../core/utils.js';
import { isField, resolveField } from '../core/field.js';

/**
 * Build a Three.js BufferGeometry from a geometry data descriptor.
 * Handles all primitive types, curves, booleans, and instancing,
 * plus post-processing (extrude, scaleElements).
 *
 * @param {object} geoData - Geometry descriptor produced by the node evaluator.
 * @returns {THREE.BufferGeometry|null}
 */
export function buildGeometry(geoData) {
  let geometry;

  switch (geoData.type) {
    case 'cube': {
      // verticesX/Y/Z are vertex counts; Three.js wants segment counts (vertices - 1)
      const segX = Math.max(1, (geoData.verticesX || 2) - 1);
      const segY = Math.max(1, (geoData.verticesY || 2) - 1);
      const segZ = Math.max(1, (geoData.verticesZ || 2) - 1);
      geometry = new THREE.BoxGeometry(
        geoData.sizeX || 1, geoData.sizeY || 1, geoData.sizeZ || 1,
        segX, segY, segZ
      );
      break;
    }

    case 'sphere':
      geometry = new THREE.SphereGeometry(
        geoData.radius || 1,
        geoData.segments || 16,
        geoData.rings || 8
      );
      break;

    case 'cylinder':
      geometry = new THREE.CylinderGeometry(
        geoData.radius || 1,
        geoData.radius || 1,
        geoData.depth || 2,
        geoData.vertices || 16,
        geoData.sideSegments || 1,
        geoData.fillType === 'none' // openEnded
      );
      break;

    case 'cone':
      geometry = new THREE.CylinderGeometry(
        geoData.radius2 ?? 0,
        geoData.radius1 || 1,
        geoData.depth || 2,
        geoData.vertices || 16,
        geoData.sideSegments || 1,
        geoData.fillType === 'none' // openEnded
      );
      break;

    case 'torus':
      geometry = new THREE.TorusGeometry(
        geoData.majorRadius || 1,
        geoData.minorRadius || 0.3,
        geoData.minorSegments || 12,
        geoData.majorSegments || 24
      );
      break;

    case 'plane':
      geometry = new THREE.PlaneGeometry(
        geoData.sizeX || 2,
        geoData.sizeY || 2,
        geoData.subdX || 1,
        geoData.subdY || 1
      );
      break;

    case 'icosphere':
      geometry = new THREE.IcosahedronGeometry(
        geoData.radius || 1,
        geoData.detail || 1
      );
      break;

    case 'line': {
      const pts = [];
      const count = Math.max(2, geoData.count || 10);
      const s = geoData.start || { x: 0, y: 0, z: 0 };
      const e = geoData.end || { x: 0, y: 0, z: 1 };
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0;
        pts.push(s.x + (e.x - s.x) * t, s.y + (e.y - s.y) * t, s.z + (e.z - s.z) * t);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      break;
    }

    case 'points': {
      const pts = [];

      if (geoData.source) {
        const sourceGeo = buildGeometry(geoData.source);
        if (sourceGeo) {
          const posAttr = sourceGeo.getAttribute('position');
          const mode = geoData.mode || 'vertices';
          const getIdx = sourceGeo.index
            ? (i) => sourceGeo.index.getX(i)
            : (i) => i;
          const triCount = sourceGeo.index
            ? Math.floor(sourceGeo.index.count / 3)
            : Math.floor(posAttr.count / 3);

          if (mode === 'vertices') {
            // Deduplicate vertex positions
            const seen = new Set();
            for (let i = 0; i < posAttr.count; i++) {
              const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
              const key = x.toFixed(5) + ',' + y.toFixed(5) + ',' + z.toFixed(5);
              if (!seen.has(key)) {
                seen.add(key);
                pts.push(x, y, z);
              }
            }
          } else if (mode === 'faces') {
            // Face center positions
            for (let f = 0; f < triCount; f++) {
              const a = getIdx(f * 3), b = getIdx(f * 3 + 1), c = getIdx(f * 3 + 2);
              pts.push(
                (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3,
                (posAttr.getY(a) + posAttr.getY(b) + posAttr.getY(c)) / 3,
                (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3,
              );
            }
          } else if (mode === 'edges') {
            // Edge midpoints (deduplicated)
            const seen = new Set();
            const addEdge = (ai, bi) => {
              const mx = ((posAttr.getX(ai) + posAttr.getX(bi)) / 2).toFixed(5);
              const my = ((posAttr.getY(ai) + posAttr.getY(bi)) / 2).toFixed(5);
              const mz = ((posAttr.getZ(ai) + posAttr.getZ(bi)) / 2).toFixed(5);
              const key = mx + ',' + my + ',' + mz;
              if (!seen.has(key)) {
                seen.add(key);
                pts.push(+mx, +my, +mz);
              }
            };
            for (let f = 0; f < triCount; f++) {
              const a = getIdx(f * 3), b = getIdx(f * 3 + 1), c = getIdx(f * 3 + 2);
              addEdge(a, b);
              addEdge(b, c);
              addEdge(c, a);
            }
          } else if (mode === 'corners') {
            // All face corner positions (includes duplicates at shared vertices)
            const count = sourceGeo.index ? sourceGeo.index.count : posAttr.count;
            for (let i = 0; i < count; i++) {
              const vi = getIdx(i);
              pts.push(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
            }
          } else if (mode === 'random' || mode === 'poisson') {
            // Scatter random points on mesh faces weighted by triangle area
            const areas = [];
            let totalArea = 0;
            for (let f = 0; f < triCount; f++) {
              const a = getIdx(f * 3), b = getIdx(f * 3 + 1), c = getIdx(f * 3 + 2);
              const abx = posAttr.getX(b) - posAttr.getX(a);
              const aby = posAttr.getY(b) - posAttr.getY(a);
              const abz = posAttr.getZ(b) - posAttr.getZ(a);
              const acx = posAttr.getX(c) - posAttr.getX(a);
              const acy = posAttr.getY(c) - posAttr.getY(a);
              const acz = posAttr.getZ(c) - posAttr.getZ(a);
              const nx = aby * acz - abz * acy;
              const ny = abz * acx - abx * acz;
              const nz = abx * acy - aby * acx;
              totalArea += Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
              areas.push(totalArea);
            }

            const density = geoData.density || 1;
            const densityFactor = geoData.densityFactor ?? 1;
            const effectiveDensity = density * densityFactor;
            const numPoints = Math.min(2000, Math.max(1, Math.round(effectiveDensity * totalArea * 10)));
            const seed = geoData.seed || 0;
            const distanceMin = geoData.distanceMin || 0;
            const distMin2 = distanceMin * distanceMin;

            // Generate candidate points using area-weighted triangle sampling with barycentric coords
            const candidates = [];
            // Over-generate if we need to apply minimum distance filtering
            const genCount = distanceMin > 0 ? Math.min(4000, numPoints * 3) : numPoints;

            for (let i = 0; i < genCount; i++) {
              const s = seed * 1000 + i;
              // Binary search for triangle selection (weighted by area)
              const r = seededRandom(s) * totalArea;
              let lo = 0, hi = triCount - 1;
              while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (areas[mid] < r) lo = mid + 1; else hi = mid;
              }
              const triIdx = lo;
              // Random barycentric coordinates
              let u = seededRandom(s + 7777);
              let v = seededRandom(s + 13333);
              if (u + v > 1) { u = 1 - u; v = 1 - v; }
              const w = 1 - u - v;
              const a = getIdx(triIdx * 3), b = getIdx(triIdx * 3 + 1), c = getIdx(triIdx * 3 + 2);
              candidates.push(
                posAttr.getX(a) * w + posAttr.getX(b) * u + posAttr.getX(c) * v,
                posAttr.getY(a) * w + posAttr.getY(b) * u + posAttr.getY(c) * v,
                posAttr.getZ(a) * w + posAttr.getZ(b) * u + posAttr.getZ(c) * v,
              );
            }

            // Apply minimum distance filtering if needed
            if (distanceMin > 0) {
              const accepted = [];
              for (let i = 0; i < candidates.length && accepted.length < numPoints * 3; i += 3) {
                const cx = candidates[i], cy = candidates[i + 1], cz = candidates[i + 2];
                let tooClose = false;
                for (let j = 0; j < accepted.length; j += 3) {
                  const dx = cx - accepted[j], dy = cy - accepted[j + 1], dz = cz - accepted[j + 2];
                  if (dx * dx + dy * dy + dz * dz < distMin2) { tooClose = true; break; }
                }
                if (!tooClose) accepted.push(cx, cy, cz);
              }
              pts.push(...accepted);
            } else {
              pts.push(...candidates);
            }
          }

          sourceGeo.dispose();
        }
      }

      // Fallback: random scattered points when no source mesh is available
      if (pts.length === 0) {
        const numPoints = Math.min(200, Math.round((geoData.density || 1) * 10));
        const seed = geoData.seed || 0;
        for (let i = 0; i < numPoints; i++) {
          const s = seed * 1000 + i;
          const theta = seededRandom(s) * Math.PI * 2;
          const phi = Math.acos(2 * seededRandom(s + 7777) - 1);
          const r = Math.cbrt(seededRandom(s + 13333));
          pts.push(
            Math.sin(phi) * Math.cos(theta) * r,
            Math.sin(phi) * Math.sin(theta) * r,
            Math.cos(phi) * r
          );
        }
      }

      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      break;
    }

    case 'curve_circle': {
      const res = geoData.resolution || 16;
      const r = geoData.radius || 1;
      const pts = [];
      for (let i = 0; i <= res; i++) {
        const angle = (i / res) * Math.PI * 2;
        pts.push(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      break;
    }

    case 'curve_line': {
      const s = geoData.start || { x: 0, y: 0, z: 0 };
      const e = geoData.end || { x: 0, y: 0, z: 1 };
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([s.x, s.y, s.z, e.x, e.y, e.z], 3));
      break;
    }

    case 'curve_to_mesh': {
      // Build a mesh by sweeping a profile curve along a path curve
      const curveData = geoData.curve;
      if (!curveData) return null;

      // Helper: extract path points from any curve type
      const extractPathPoints = (cData) => {
        const pts = [];
        if (cData.type === 'curve_circle') {
          const r = cData.radius || 1;
          const res = cData.resolution || 16;
          for (let i = 0; i <= res; i++) {
            const angle = (i / res) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
          }
        } else if (cData.type === 'spiral') {
          const res = cData.resolution || 64;
          for (let i = 0; i <= res; i++) {
            const t = i / res;
            const angle = t * cData.turns * Math.PI * 2;
            const r = cData.startRadius + (cData.endRadius - cData.startRadius) * t;
            const y = t * cData.height;
            pts.push(new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
          }
        } else if (cData.type === 'curve_line') {
          const s = cData.start || { x: 0, y: 0, z: 0 };
          const e = cData.end || { x: 0, y: 0, z: 1 };
          pts.push(new THREE.Vector3(s.x, s.y, s.z));
          pts.push(new THREE.Vector3(e.x, e.y, e.z));
        } else {
          // Generic: build geometry and extract vertices
          const builtGeo = buildGeometry(cData);
          if (builtGeo) {
            const posAttr = builtGeo.getAttribute('position');
            for (let i = 0; i < posAttr.count; i++) {
              pts.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
            }
            builtGeo.dispose();
          }
        }
        return pts;
      };

      // Extract profile points (2D cross-section)
      const extractProfilePoints = (pData) => {
        if (!pData) return null;
        if (pData.type === 'curve_circle') {
          // Return circle profile as array of 2D offsets
          const r = pData.radius || 0.1;
          const res = pData.resolution || 8;
          const pts = [];
          for (let i = 0; i <= res; i++) {
            const angle = (i / res) * Math.PI * 2;
            pts.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
          }
          return pts;
        }
        // Generic profile: build geometry and extract XZ as 2D points
        const builtGeo = buildGeometry(pData);
        if (builtGeo) {
          const posAttr = builtGeo.getAttribute('position');
          const pts = [];
          for (let i = 0; i < posAttr.count; i++) {
            pts.push(new THREE.Vector2(posAttr.getX(i), posAttr.getZ(i)));
          }
          builtGeo.dispose();
          return pts;
        }
        return null;
      };

      const pathPts = extractPathPoints(curveData);
      const profile = geoData.profile;
      const profilePts = extractProfilePoints(profile);
      const isClosed = curveData.type === 'curve_circle';

      if (pathPts.length >= 2 && profilePts && profilePts.length >= 2) {
        // Sweep profile along path using Frenet frames
        const verts = [];
        const indices = [];
        const profLen = profilePts.length;
        const pathLen = pathPts.length;

        for (let pi = 0; pi < pathLen; pi++) {
          // Compute tangent
          const prev = pathPts[Math.max(0, pi - 1)];
          const next = pathPts[Math.min(pathLen - 1, pi + 1)];
          const tangent = new THREE.Vector3().subVectors(next, prev).normalize();

          // Compute normal and binormal using up vector
          const up = new THREE.Vector3(0, 1, 0);
          if (Math.abs(tangent.dot(up)) > 0.99) up.set(1, 0, 0);
          const normal = new THREE.Vector3().crossVectors(up, tangent).normalize();
          const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

          // Place profile points in the frame
          for (let fi = 0; fi < profLen; fi++) {
            const px = profilePts[fi].x;
            const py = profilePts[fi].y;
            verts.push(
              pathPts[pi].x + normal.x * px + binormal.x * py,
              pathPts[pi].y + normal.y * px + binormal.y * py,
              pathPts[pi].z + normal.z * px + binormal.z * py
            );
          }
        }

        // Build faces
        for (let pi = 0; pi < pathLen - 1; pi++) {
          for (let fi = 0; fi < profLen - 1; fi++) {
            const a = pi * profLen + fi;
            const b = pi * profLen + fi + 1;
            const c = (pi + 1) * profLen + fi;
            const d = (pi + 1) * profLen + fi + 1;
            indices.push(a, b, d);
            indices.push(a, d, c);
          }
        }

        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
      } else if (pathPts.length >= 2) {
        // Fallback: use TubeGeometry with a radius from profile
        const profileRadius = profile?.radius || 0.05;
        const path = new THREE.CatmullRomCurve3(pathPts, isClosed);
        geometry = new THREE.TubeGeometry(path, pathPts.length - 1, profileRadius, 8, isClosed);
      } else {
        return null;
      }
      break;
    }

    case 'fill_curve': {
      // Create a flat mesh from curve using fan triangulation
      const curveData = geoData.curve;
      if (curveData && curveData.type === 'curve_circle') {
        geometry = new THREE.CircleGeometry(curveData.radius || 1, curveData.resolution || 16);
      } else if (curveData) {
        // Build the source curve geometry to get its vertices
        const curveGeo = buildGeometry(curveData);
        if (curveGeo) {
          const posAttr = curveGeo.getAttribute('position');
          const vertCount = posAttr.count;
          if (vertCount >= 3) {
            // Compute centroid
            let cx = 0, cy = 0, cz = 0;
            for (let i = 0; i < vertCount; i++) {
              cx += posAttr.getX(i);
              cy += posAttr.getY(i);
              cz += posAttr.getZ(i);
            }
            cx /= vertCount; cy /= vertCount; cz /= vertCount;

            // Fan triangulation from centroid to each consecutive pair
            const verts = [];
            const indices = [];
            // First vertex is centroid
            verts.push(cx, cy, cz);
            for (let i = 0; i < vertCount; i++) {
              verts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
            }
            // Create triangles: centroid(0) -> i+1 -> i+2
            for (let i = 0; i < vertCount - 1; i++) {
              indices.push(0, i + 1, i + 2);
            }
            geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();
          } else {
            geometry = new THREE.BufferGeometry();
          }
          curveGeo.dispose();
        } else {
          geometry = new THREE.CircleGeometry(1, 16);
        }
      } else {
        geometry = new THREE.CircleGeometry(1, 16);
      }
      break;
    }

    case 'spiral': {
      const res = geoData.resolution || 64;
      const pts = [];
      for (let i = 0; i <= res; i++) {
        const t = i / res;
        const angle = t * geoData.turns * Math.PI * 2;
        const r = geoData.startRadius + (geoData.endRadius - geoData.startRadius) * t;
        const y = t * geoData.height;
        pts.push(Math.cos(angle) * r, y, Math.sin(angle) * r);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      break;
    }

    case 'mesh_circle': {
      const verts = geoData.vertices || 32;
      const r = geoData.radius || 1;
      const fill = geoData.fillType || 'ngon';
      if (fill === 'none') {
        // Just the edge ring
        const pts = [];
        for (let i = 0; i < verts; i++) {
          const angle = (i / verts) * Math.PI * 2;
          pts.push(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        }
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      } else {
        geometry = new THREE.CircleGeometry(r, verts);
        // CircleGeometry is XY, rotate to XZ
        geometry.rotateX(-Math.PI / 2);
      }
      break;
    }

    case 'curve_arc': {
      const res = geoData.resolution || 16;
      const r = geoData.radius || 1;
      const startA = geoData.startAngle || 0;
      const sweepA = geoData.sweepAngle || (315 * Math.PI / 180);
      const pts = [];
      for (let i = 0; i <= res; i++) {
        const t = i / res;
        const angle = startA + t * sweepA;
        pts.push(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      break;
    }

    case 'curve_star': {
      const numPts = geoData.points || 5;
      const innerR = geoData.innerRadius || 0.5;
      const outerR = geoData.outerRadius || 1;
      const twist = geoData.twist || 0;
      const isCyclic = geoData.cyclic !== false;
      const pts = [];
      const totalVerts = numPts * 2;
      for (let i = 0; i < totalVerts; i++) {
        const angle = (i / totalVerts) * Math.PI * 2;
        const isOuter = i % 2 === 0;
        const r = isOuter ? outerR : innerR;
        const a = isOuter ? angle : angle + twist;
        pts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      if (isCyclic) {
        // Close the loop by repeating the first point
        pts.push(pts[0], pts[1], pts[2]);
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      break;
    }

    case 'boolean': {
      const a = geoData.meshA;
      if (!a) return null;
      const geoA = buildGeometry(a);
      if (!geoA) return null;
      const geoB = geoData.meshB ? buildGeometry(geoData.meshB) : null;
      const operation = geoData.operation || 'union';

      if (!geoB) {
        geometry = geoA;
        break;
      }

      switch (operation) {
        case 'union': {
          // Merge both geometries into one
          const posA = geoA.getAttribute('position');
          const posB = geoB.getAttribute('position');
          const newPositions = [];
          const newIndices = [];

          // Copy positions from A
          for (let i = 0; i < posA.count; i++) {
            newPositions.push(posA.getX(i), posA.getY(i), posA.getZ(i));
          }
          const offsetB = posA.count;
          // Copy positions from B
          for (let i = 0; i < posB.count; i++) {
            newPositions.push(posB.getX(i), posB.getY(i), posB.getZ(i));
          }

          // Copy indices from A
          if (geoA.index) {
            const idxA = geoA.index.array;
            for (let i = 0; i < idxA.length; i++) newIndices.push(idxA[i]);
          } else {
            for (let i = 0; i < posA.count; i++) newIndices.push(i);
          }
          // Copy indices from B with offset
          if (geoB.index) {
            const idxB = geoB.index.array;
            for (let i = 0; i < idxB.length; i++) newIndices.push(idxB[i] + offsetB);
          } else {
            for (let i = 0; i < posB.count; i++) newIndices.push(i + offsetB);
          }

          geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
          geometry.setIndex(newIndices);
          geometry.computeVertexNormals();
          geoA.dispose();
          geoB.dispose();
          break;
        }
        case 'intersect': {
          // Bounding box approximation: keep only A's triangles whose centroids are inside B's bbox
          geoB.computeBoundingBox();
          const bbox = geoB.boundingBox;
          const nonIdxA = geoA.index ? geoA.toNonIndexed() : geoA;
          const posA2 = nonIdxA.getAttribute('position');
          const triCount = Math.floor(posA2.count / 3);
          const keptPositions = [];

          for (let f = 0; f < triCount; f++) {
            const i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
            const cx = (posA2.getX(i0) + posA2.getX(i1) + posA2.getX(i2)) / 3;
            const cy = (posA2.getY(i0) + posA2.getY(i1) + posA2.getY(i2)) / 3;
            const cz = (posA2.getZ(i0) + posA2.getZ(i1) + posA2.getZ(i2)) / 3;
            if (cx >= bbox.min.x && cx <= bbox.max.x &&
                cy >= bbox.min.y && cy <= bbox.max.y &&
                cz >= bbox.min.z && cz <= bbox.max.z) {
              keptPositions.push(
                posA2.getX(i0), posA2.getY(i0), posA2.getZ(i0),
                posA2.getX(i1), posA2.getY(i1), posA2.getZ(i1),
                posA2.getX(i2), posA2.getY(i2), posA2.getZ(i2)
              );
            }
          }

          if (keptPositions.length > 0) {
            geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(keptPositions, 3));
            geometry.computeVertexNormals();
          } else {
            geometry = new THREE.BufferGeometry();
          }
          if (nonIdxA !== geoA) nonIdxA.dispose();
          geoA.dispose();
          geoB.dispose();
          break;
        }
        case 'difference': {
          // Bounding box approximation: keep only A's triangles whose centroids are outside B's bbox
          geoB.computeBoundingBox();
          const bbox = geoB.boundingBox;
          const nonIdxA = geoA.index ? geoA.toNonIndexed() : geoA;
          const posA2 = nonIdxA.getAttribute('position');
          const triCount = Math.floor(posA2.count / 3);
          const keptPositions = [];

          for (let f = 0; f < triCount; f++) {
            const i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
            const cx = (posA2.getX(i0) + posA2.getX(i1) + posA2.getX(i2)) / 3;
            const cy = (posA2.getY(i0) + posA2.getY(i1) + posA2.getY(i2)) / 3;
            const cz = (posA2.getZ(i0) + posA2.getZ(i1) + posA2.getZ(i2)) / 3;
            if (cx < bbox.min.x || cx > bbox.max.x ||
                cy < bbox.min.y || cy > bbox.max.y ||
                cz < bbox.min.z || cz > bbox.max.z) {
              keptPositions.push(
                posA2.getX(i0), posA2.getY(i0), posA2.getZ(i0),
                posA2.getX(i1), posA2.getY(i1), posA2.getZ(i1),
                posA2.getX(i2), posA2.getY(i2), posA2.getZ(i2)
              );
            }
          }

          if (keptPositions.length > 0) {
            geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(keptPositions, 3));
            geometry.computeVertexNormals();
          } else {
            geometry = new THREE.BufferGeometry();
          }
          if (nonIdxA !== geoA) nonIdxA.dispose();
          geoA.dispose();
          geoB.dispose();
          break;
        }
        default:
          geometry = geoA;
          geoB.dispose();
      }
      break;
    }

    case 'instance_on_points': {
      // Build the source instance geometry and clone it at actual point locations
      const pts = geoData.points;
      const inst = geoData.instance;
      if (!pts || !inst) return null;

      const instanceGeo = buildGeometry(inst);
      if (!instanceGeo) return null;

      // Build the points geometry to get actual positions
      const pointsGeo = buildGeometry(pts);
      if (!pointsGeo) { instanceGeo.dispose(); return null; }

      const posAttr = pointsGeo.getAttribute('position');
      if (!posAttr || posAttr.count === 0) { pointsGeo.dispose(); instanceGeo.dispose(); return null; }

      const merged = [];
      const sc = geoData.scale || { x: 1, y: 1, z: 1 };
      const rot = geoData.rotation || { x: 0, y: 0, z: 0 };
      const rotIsField = rot && rot.isField;
      const pickInstance = geoData.pickInstance || false;
      const instanceIndex = geoData.instanceIndex ?? 0;

      // Build array of instance geometries for pick-instance support
      const instanceGeos = [instanceGeo];
      if (pickInstance && Array.isArray(geoData.instance)) {
        // If instance input is an array (collection), build each one
        instanceGeos.length = 0;
        const instArr = Array.isArray(geoData.instance) ? geoData.instance : [geoData.instance];
        for (const instItem of instArr) {
          const g = buildGeometry(instItem);
          if (g) instanceGeos.push(g);
        }
        if (instanceGeos.length === 0) instanceGeos.push(instanceGeo);
      }

      // Pre-compute rotation matrix for uniform rotation
      let rotMatrix = null;
      if (!rotIsField) {
        const hasRotation = (rot.x || 0) !== 0 || (rot.y || 0) !== 0 || (rot.z || 0) !== 0;
        if (hasRotation) {
          rotMatrix = new THREE.Matrix4().makeRotationFromEuler(
            new THREE.Euler(
              (rot.x || 0) * Math.PI / 180,
              (rot.y || 0) * Math.PI / 180,
              (rot.z || 0) * Math.PI / 180
            )
          );
        }
      }

      for (let i = 0; i < posAttr.count; i++) {
        const px = posAttr.getX(i);
        const py = posAttr.getY(i);
        const pz = posAttr.getZ(i);

        // Pick which instance geometry to use
        let srcGeo = instanceGeos[0];
        if (pickInstance && instanceGeos.length > 1) {
          const idx = (typeof instanceIndex === 'number')
            ? instanceIndex
            : (Array.isArray(instanceIndex) ? (instanceIndex[i] ?? 0) : 0);
          srcGeo = instanceGeos[Math.abs(idx) % instanceGeos.length];
        }

        const clone = srcGeo.clone();
        clone.scale(sc.x, sc.y, sc.z);

        // Per-point rotation support
        if (rotIsField && rot.evaluateAt) {
          const pr = rot.evaluateAt(i);
          const perPointMatrix = new THREE.Matrix4().makeRotationFromEuler(
            new THREE.Euler(
              (pr.x || 0) * Math.PI / 180,
              (pr.y || 0) * Math.PI / 180,
              (pr.z || 0) * Math.PI / 180
            )
          );
          clone.applyMatrix4(perPointMatrix);
        } else if (rotMatrix) {
          clone.applyMatrix4(rotMatrix);
        }

        clone.translate(px, py, pz);
        merged.push(clone);
      }

      pointsGeo.dispose();

      if (merged.length === 0) return instanceGeo;

      // Merge all geometries
      const positions = [];
      const normals = [];
      const indices = [];
      let vertOffset = 0;

      for (const g of merged) {
        const pos = g.getAttribute('position');
        const norm = g.getAttribute('normal');
        const idx = g.index;

        for (let j = 0; j < pos.count; j++) {
          positions.push(pos.getX(j), pos.getY(j), pos.getZ(j));
          if (norm) normals.push(norm.getX(j), norm.getY(j), norm.getZ(j));
        }

        if (idx) {
          for (let j = 0; j < idx.count; j++) {
            indices.push(idx.getX(j) + vertOffset);
          }
        }

        vertOffset += pos.count;
        g.dispose();
      }

      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (normals.length > 0) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      if (indices.length > 0) geometry.setIndex(indices);
      if (normals.length === 0) geometry.computeVertexNormals();

      instanceGeo.dispose();
      break;
    }

    case 'curve_quadrilateral': {
      const mode = geoData.mode || 'rectangle';
      const w = geoData.width || 2;
      const h = geoData.height || 2;
      const pts = [];
      switch (mode) {
        case 'rectangle':
          pts.push(-w/2, 0, -h/2, w/2, 0, -h/2, w/2, 0, h/2, -w/2, 0, h/2, -w/2, 0, -h/2);
          break;
        case 'diamond':
          pts.push(0, 0, -h/2, w/2, 0, 0, 0, 0, h/2, -w/2, 0, 0, 0, 0, -h/2);
          break;
        case 'kite': {
          const topW = geoData.topWidth || w * 0.5;
          pts.push(0, 0, -h/2, topW/2, 0, 0, 0, 0, h/2, -topW/2, 0, 0, 0, 0, -h/2);
          break;
        }
        case 'parallelogram': {
          const offset = geoData.offset || w * 0.25;
          pts.push(-w/2+offset, 0, -h/2, w/2+offset, 0, -h/2, w/2-offset, 0, h/2, -w/2-offset, 0, h/2, -w/2+offset, 0, -h/2);
          break;
        }
        case 'trapezoid': {
          const topScale = geoData.topWidth || w * 0.5;
          pts.push(-w/2, 0, -h/2, w/2, 0, -h/2, topScale/2, 0, h/2, -topScale/2, 0, h/2, -w/2, 0, -h/2);
          break;
        }
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      break;
    }

    default:
      return null;
  }

  // ── Curve post-processing ────────────────────────────────────────────────

  // Reverse curve direction
  if (geoData.reverseCurve) {
    const posAttr = geometry.getAttribute('position');
    if (posAttr) {
      const count = posAttr.count;
      for (let i = 0; i < Math.floor(count / 2); i++) {
        const j = count - 1 - i;
        const tx = posAttr.getX(i), ty = posAttr.getY(i), tz = posAttr.getZ(i);
        posAttr.setXYZ(i, posAttr.getX(j), posAttr.getY(j), posAttr.getZ(j));
        posAttr.setXYZ(j, tx, ty, tz);
      }
      posAttr.needsUpdate = true;
    }
  }

  // Set spline cyclic (close the curve)
  if (geoData.cyclic) {
    const posAttr = geometry.getAttribute('position');
    if (posAttr && posAttr.count >= 2) {
      const fx = posAttr.getX(0), fy = posAttr.getY(0), fz = posAttr.getZ(0);
      const lx = posAttr.getX(posAttr.count - 1), ly = posAttr.getY(posAttr.count - 1), lz = posAttr.getZ(posAttr.count - 1);
      const dx = fx - lx, dy = fy - ly, dz = fz - lz;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.0001) {
        // Add closing point
        const pts = [];
        for (let i = 0; i < posAttr.count; i++) {
          pts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        }
        pts.push(fx, fy, fz);
        geometry.dispose();
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      }
    }
  }

  // Trim curve to start/end fraction
  if (geoData.trim) {
    const posAttr = geometry.getAttribute('position');
    if (posAttr && posAttr.count >= 2) {
      let { start, end, mode } = geoData.trim;
      start = start || 0;
      end = end ?? 1;
      // Convert length mode to factor
      if (mode === 'length') {
        const pos = geometry.getAttribute('position');
        if (pos && pos.count > 1) {
          let totalLen = 0;
          for (let i = 1; i < pos.count; i++) {
            const dx = pos.getX(i) - pos.getX(i-1);
            const dy = pos.getY(i) - pos.getY(i-1);
            const dz = pos.getZ(i) - pos.getZ(i-1);
            totalLen += Math.sqrt(dx*dx + dy*dy + dz*dz);
          }
          if (totalLen > 0) {
            start = start / totalLen;
            end = end / totalLen;
          }
        }
      }
      start = Math.max(0, Math.min(1, start));
      end = Math.max(0, Math.min(1, end));
      if (start > 0 || end < 1) {
        const count = posAttr.count;
        const startIdx = Math.floor(start * (count - 1));
        const endIdx = Math.ceil(end * (count - 1));
        const pts = [];
        for (let i = startIdx; i <= endIdx && i < count; i++) {
          pts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        }
        if (pts.length >= 6) {
          geometry.dispose();
          geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        }
      }
    }
  }

  // Resample curve at new point count or segment length
  if (geoData.resample) {
    const posAttr = geometry.getAttribute('position');
    if (posAttr && posAttr.count >= 2) {
      geometry = resampleCurveGeometry(geometry, geoData.resample);
    }
  }

  // Set spline resolution (resample to resolution)
  if (geoData.splineResolution > 0) {
    const posAttr = geometry.getAttribute('position');
    if (posAttr && posAttr.count >= 2) {
      geometry = resampleCurveGeometry(geometry, { mode: 'count', count: geoData.splineResolution });
    }
  }

  // ── Mesh post-processing ───────────────────────────────────────────────

  // Apply subdivision (flat or smooth/Catmull-Clark approximation)
  if (geoData.subdivide > 0 || geoData.subdivisionSurface > 0) {
    const levels = geoData.subdivisionSurface || geoData.subdivide || 0;
    const smooth = !!geoData.subdivisionSurface;
    const edgeCrease = geoData.edgeCrease ?? 0;
    geometry = subdivideGeometry(geometry, Math.min(levels, 4), smooth, edgeCrease);
  }

  // Triangulate
  if (geoData.triangulate) {
    // Three.js already uses triangles internally, so indexed geometry
    // with 3-vertex faces is already triangulated.
    // For non-indexed geometry, create proper triangle index buffer.
    if (!geometry.index) {
      const count = geometry.getAttribute('position')?.count || 0;
      const triCount = Math.floor(count / 3);
      const idx = [];
      for (let i = 0; i < triCount * 3; i++) idx.push(i);
      if (idx.length > 0) geometry.setIndex(idx);
    }
    // Ensure we have proper vertex normals after triangulation
    geometry.computeVertexNormals();
  }

  // Split edges: convert to non-indexed so each face has its own vertices
  if (geoData.splitEdges && geometry.index) {
    if (geoData._splitEdgesSelection && isField(geoData._splitEdgesSelection)) {
      // Build elements, evaluate selection field, split only selected edges
      // For now, still split all (proper per-edge selection would need edge element context)
      geometry = geometry.toNonIndexed();
      geometry.computeVertexNormals();
    } else {
      geometry = geometry.toNonIndexed();
      geometry.computeVertexNormals();
    }
  }

  // Merge vertices by distance
  if (geoData.mergeByDistance > 0) {
    geometry = mergeByDistanceGeometry(geometry, geoData.mergeByDistance, geoData.mergeByDistanceMode || 'all');
  }

  // Convex hull
  if (geoData.convexHull) {
    geometry = computeConvexHull(geometry);
  }

  // Dual mesh
  if (geoData.dualMesh) {
    geometry = computeDualMesh(geometry, geoData.keepBoundaries);
  }

  // Points to vertices: convert point cloud to mesh vertices (no faces)
  if (geoData.pointsToVertices) {
    // Just ensure geometry has normals for rendering; no index/faces needed
    if (geometry.index) {
      // Remove any existing index to make it vertex-only
      geometry.setIndex(null);
    }
    if (!geometry.getAttribute('normal')) {
      // Set default up normals for point rendering
      const count = geometry.getAttribute('position')?.count || 0;
      const normals = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        normals[i * 3 + 1] = 1; // Y-up normal
      }
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    }
  }

  // Realize instances flag is consumed by the builder - instances are always
  // realized into concrete geometry during buildGeometry
  // (No additional action needed - just consume the flag so it doesn't warn)
  if (geoData.realized) {
    // Already realized during instance_on_points build above
  }

  // Mesh to curve: extract boundary/edge loop as line geometry
  if (geoData.meshToCurve) {
    geometry = meshToCurveGeometry(geometry);
  }

  // ── Field-based operations ──────────────────────────────────────────────

  // Field-based Set Position: evaluate position/offset fields per vertex
  if (geoData._fieldSetPosition) {
    const fp = geoData._fieldSetPosition;
    const posAttr = geometry.getAttribute('position');
    if (posAttr) {
      if (!geometry.getAttribute('normal')) {
        try { geometry.computeVertexNormals(); } catch (e) { /* ok */ }
      }
      const normAttr = geometry.getAttribute('normal');
      const count = posAttr.count;

      // Build element contexts
      const elements = [];
      for (let i = 0; i < count; i++) {
        elements.push({
          position: { x: posAttr.getX(i), y: posAttr.getY(i), z: posAttr.getZ(i) },
          normal: normAttr
            ? { x: normAttr.getX(i), y: normAttr.getY(i), z: normAttr.getZ(i) }
            : { x: 0, y: 1, z: 0 },
          index: i,
          count,
        });
      }

      // Resolve fields
      const selArr = resolveField(fp.selection ?? true, elements);
      const posArr = fp.position ? resolveField(fp.position, elements) : null;
      const offArr = resolveField(fp.offset || { x: 0, y: 0, z: 0 }, elements);

      for (let i = 0; i < count; i++) {
        if (!selArr[i]) continue; // selection is false → skip

        if (posArr) {
          // Absolute position set
          const p = posArr[i] || { x: 0, y: 0, z: 0 };
          posAttr.setXYZ(i, p.x || 0, p.y || 0, p.z || 0);
        } else {
          // Offset mode
          const off = offArr[i] || { x: 0, y: 0, z: 0 };
          posAttr.setXYZ(i,
            posAttr.getX(i) + (off.x || 0),
            posAttr.getY(i) + (off.y || 0),
            posAttr.getZ(i) + (off.z || 0),
          );
        }
      }
      posAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    }
  }

  // Field-based Delete Geometry: remove elements where selection field is true
  if (geoData._fieldDelete) {
    const fd = geoData._fieldDelete;
    const posAttr = geometry.getAttribute('position');
    if (posAttr) {
      if (!geometry.getAttribute('normal')) {
        try { geometry.computeVertexNormals(); } catch (e) { /* ok */ }
      }
      const normAttr = geometry.getAttribute('normal');
      const count = posAttr.count;

      const elements = [];
      for (let i = 0; i < count; i++) {
        elements.push({
          position: { x: posAttr.getX(i), y: posAttr.getY(i), z: posAttr.getZ(i) },
          normal: normAttr
            ? { x: normAttr.getX(i), y: normAttr.getY(i), z: normAttr.getZ(i) }
            : { x: 0, y: 1, z: 0 },
          index: i,
          count,
        });
      }

      const selArr = resolveField(fd.selection, elements);

      if (fd.domain === 'faces' && geometry.index) {
        // Face-domain deletion
        const idxArr = geometry.index.array;
        const newIdx = [];
        const triCount = Math.floor(idxArr.length / 3);
        for (let f = 0; f < triCount; f++) {
          const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
          // Delete if any vertex is selected (face domain approximation)
          const faceSelected = (selArr[a] || selArr[b] || selArr[c]);
          if (!faceSelected) {
            newIdx.push(a, b, c);
          }
        }
        if (newIdx.length > 0) {
          geometry.setIndex(newIdx);
        } else {
          // All faces deleted — return empty geometry
          geometry.dispose();
          geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
        }
      } else {
        // Point-domain deletion — rebuild geometry keeping unselected vertices
        const keptPositions = [];
        const keptNormals = [];
        const vertMap = new Int32Array(count).fill(-1);
        let newIdx = 0;

        for (let i = 0; i < count; i++) {
          if (!selArr[i]) {
            vertMap[i] = newIdx++;
            keptPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
            if (normAttr) keptNormals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
          }
        }

        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.Float32BufferAttribute(keptPositions, 3));
        if (keptNormals.length > 0) newGeo.setAttribute('normal', new THREE.Float32BufferAttribute(keptNormals, 3));

        if (geometry.index) {
          const oldIdx = geometry.index.array;
          const remappedIdx = [];
          for (let i = 0; i < oldIdx.length; i += 3) {
            const a = vertMap[oldIdx[i]], b = vertMap[oldIdx[i + 1]], c = vertMap[oldIdx[i + 2]];
            if (a >= 0 && b >= 0 && c >= 0) remappedIdx.push(a, b, c);
          }
          if (remappedIdx.length > 0) newGeo.setIndex(remappedIdx);
        }

        if (!newGeo.getAttribute('normal') && keptPositions.length > 0) {
          try { newGeo.computeVertexNormals(); } catch (e) { /* ok */ }
        }

        geometry.dispose();
        geometry = newGeo;
      }
    }
  }

  // Field-based Separate Geometry: keep only selected or inverted elements
  if (geoData._fieldSeparate) {
    const fs = geoData._fieldSeparate;
    const posAttr = geometry.getAttribute('position');
    if (posAttr) {
      if (!geometry.getAttribute('normal')) {
        try { geometry.computeVertexNormals(); } catch (e) { /* ok */ }
      }
      const normAttr = geometry.getAttribute('normal');
      const count = posAttr.count;

      const elements = [];
      for (let i = 0; i < count; i++) {
        elements.push({
          position: { x: posAttr.getX(i), y: posAttr.getY(i), z: posAttr.getZ(i) },
          normal: normAttr
            ? { x: normAttr.getX(i), y: normAttr.getY(i), z: normAttr.getZ(i) }
            : { x: 0, y: 1, z: 0 },
          index: i,
          count,
        });
      }

      const selArr = resolveField(fs.selection, elements);
      const keptPositions = [];
      const keptNormals = [];
      const vertMap = new Int32Array(count).fill(-1);
      let newIdx = 0;

      for (let i = 0; i < count; i++) {
        const keep = fs.invert ? !selArr[i] : !!selArr[i];
        if (keep) {
          vertMap[i] = newIdx++;
          keptPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          if (normAttr) keptNormals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
        }
      }

      const newGeo = new THREE.BufferGeometry();
      newGeo.setAttribute('position', new THREE.Float32BufferAttribute(keptPositions, 3));
      if (keptNormals.length > 0) newGeo.setAttribute('normal', new THREE.Float32BufferAttribute(keptNormals, 3));

      if (geometry.index) {
        const oldIdx = geometry.index.array;
        const remappedIdx = [];
        for (let i = 0; i < oldIdx.length; i += 3) {
          const a = vertMap[oldIdx[i]], b = vertMap[oldIdx[i + 1]], c = vertMap[oldIdx[i + 2]];
          if (a >= 0 && b >= 0 && c >= 0) remappedIdx.push(a, b, c);
        }
        if (remappedIdx.length > 0) newGeo.setIndex(remappedIdx);
      }

      if (!newGeo.getAttribute('normal') && keptPositions.length > 0) {
        try { newGeo.computeVertexNormals(); } catch (e) { /* ok */ }
      }

      geometry.dispose();
      geometry = newGeo;
    }
  }

  // Apply extrude mesh - actual face extrusion along normals
  if (geoData.extrudeMesh) {
    const { offset, domain } = geoData.extrudeMesh;
    const offsetVal = typeof offset === 'number' ? offset : 0.1;

    if (geometry.index && domain !== 'edges') {
      // Face extrusion
      const posAttr = geometry.getAttribute('position');
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const idxArr = geometry.index.array;
      const triCount = Math.floor(idxArr.length / 3);

      const newPositions = [];
      const newIndices = [];

      // Copy existing positions
      for (let i = 0; i < posAttr.count; i++) {
        newPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      }

      // For each face, create extruded copy
      for (let f = 0; f < triCount; f++) {
        const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];

        // Compute face normal via cross product
        const abx = posAttr.getX(b) - posAttr.getX(a), aby = posAttr.getY(b) - posAttr.getY(a), abz = posAttr.getZ(b) - posAttr.getZ(a);
        const acx = posAttr.getX(c) - posAttr.getX(a), acy = posAttr.getY(c) - posAttr.getY(a), acz = posAttr.getZ(c) - posAttr.getZ(a);
        const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const fnx = nx / len, fny = ny / len, fnz = nz / len;

        // Create 3 new vertices (extruded along face normal)
        const na = newPositions.length / 3;
        newPositions.push(
          posAttr.getX(a) + fnx * offsetVal, posAttr.getY(a) + fny * offsetVal, posAttr.getZ(a) + fnz * offsetVal,
          posAttr.getX(b) + fnx * offsetVal, posAttr.getY(b) + fny * offsetVal, posAttr.getZ(b) + fnz * offsetVal,
          posAttr.getX(c) + fnx * offsetVal, posAttr.getY(c) + fny * offsetVal, posAttr.getZ(c) + fnz * offsetVal
        );
        const nb = na + 1, nc = na + 2;

        // Top face (extruded)
        newIndices.push(na, nb, nc);

        // Side faces (connecting original to extruded)
        newIndices.push(a, b, nb, a, nb, na);    // side 1
        newIndices.push(b, c, nc, b, nc, nb);    // side 2
        newIndices.push(c, a, na, c, na, nc);    // side 3
      }

      // Keep original bottom faces (flipped for closed geometry)
      for (let f = 0; f < triCount; f++) {
        newIndices.push(idxArr[f * 3 + 2], idxArr[f * 3 + 1], idxArr[f * 3]); // flipped
      }

      geometry.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      geometry.setIndex(newIndices);
      geometry.computeVertexNormals();
    }
  }

  // Apply scale elements - per-element scaling around centroids
  if (geoData.scaleElements) {
    const s = geoData.scaleElements.scale;
    const domain = geoData.scaleElements.domain || 'faces';
    const posAttr = geometry.getAttribute('position');
    if (posAttr && domain === 'faces') {
      // For face domain: scale each face's vertices toward/away from the face centroid
      // First, ensure non-indexed so each face has its own vertices
      if (geometry.index) {
        geometry = geometry.toNonIndexed();
      }
      const pos = geometry.getAttribute('position');
      const count = pos.count;
      const triCount = Math.floor(count / 3);
      for (let f = 0; f < triCount; f++) {
        const i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
        // Compute face centroid
        const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
        const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
        const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
        // Scale each vertex toward/away from centroid
        for (const vi of [i0, i1, i2]) {
          pos.setXYZ(vi,
            cx + (pos.getX(vi) - cx) * s,
            cy + (pos.getY(vi) - cy) * s,
            cz + (pos.getZ(vi) - cz) * s
          );
        }
      }
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
    } else if (posAttr && domain === 'edges') {
      // For edge domain: scale each edge's vertices toward/away from edge midpoint
      if (geometry.index) {
        geometry = geometry.toNonIndexed();
      }
      const pos = geometry.getAttribute('position');
      const count = pos.count;
      const triCount = Math.floor(count / 3);
      // Process each edge of each triangle
      const processed = new Set();
      for (let f = 0; f < triCount; f++) {
        const indices = [f * 3, f * 3 + 1, f * 3 + 2];
        const edges = [[indices[0], indices[1]], [indices[1], indices[2]], [indices[2], indices[0]]];
        for (const [ei0, ei1] of edges) {
          const key = Math.min(ei0, ei1) + ',' + Math.max(ei0, ei1);
          if (processed.has(key)) continue;
          processed.add(key);
          const mx = (pos.getX(ei0) + pos.getX(ei1)) / 2;
          const my = (pos.getY(ei0) + pos.getY(ei1)) / 2;
          const mz = (pos.getZ(ei0) + pos.getZ(ei1)) / 2;
          for (const vi of [ei0, ei1]) {
            pos.setXYZ(vi,
              mx + (pos.getX(vi) - mx) * s,
              my + (pos.getY(vi) - my) * s,
              mz + (pos.getZ(vi) - mz) * s
            );
          }
        }
      }
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
    } else {
      // Fallback: global scale
      geometry.scale(s, s, s);
    }
  }

  // Apply duplicate elements - per-element duplication with normal offset
  if (geoData.duplicateElements) {
    const { amount, domain } = geoData.duplicateElements;
    if (amount > 0 && domain === 'faces' && geometry.index) {
      // Face domain: duplicate each triangle, offsetting copies along face normal
      const posAttr = geometry.getAttribute('position');
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const idxArr = geometry.index.array;
      const triCount = Math.floor(idxArr.length / 3);

      const newPositions = [];
      const newIndices = [];

      // Copy original positions
      for (let i = 0; i < posAttr.count; i++) {
        newPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      }
      // Copy original indices
      for (let i = 0; i < idxArr.length; i++) {
        newIndices.push(idxArr[i]);
      }

      // For each duplicate, offset each face along its normal
      for (let d = 1; d <= amount; d++) {
        const offsetDist = d * 0.01; // Small offset per duplicate to avoid z-fighting
        for (let f = 0; f < triCount; f++) {
          const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];

          // Compute face normal
          const abx = posAttr.getX(b) - posAttr.getX(a), aby = posAttr.getY(b) - posAttr.getY(a), abz = posAttr.getZ(b) - posAttr.getZ(a);
          const acx = posAttr.getX(c) - posAttr.getX(a), acy = posAttr.getY(c) - posAttr.getY(a), acz = posAttr.getZ(c) - posAttr.getZ(a);
          const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          const fnx = nx / len, fny = ny / len, fnz = nz / len;

          const baseIdx = newPositions.length / 3;
          newPositions.push(
            posAttr.getX(a) + fnx * offsetDist, posAttr.getY(a) + fny * offsetDist, posAttr.getZ(a) + fnz * offsetDist,
            posAttr.getX(b) + fnx * offsetDist, posAttr.getY(b) + fny * offsetDist, posAttr.getZ(b) + fnz * offsetDist,
            posAttr.getX(c) + fnx * offsetDist, posAttr.getY(c) + fny * offsetDist, posAttr.getZ(c) + fnz * offsetDist
          );
          newIndices.push(baseIdx, baseIdx + 1, baseIdx + 2);
        }
      }

      geometry.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      geometry.setIndex(newIndices);
      geometry.computeVertexNormals();
    } else if (amount > 0 && domain === 'points') {
      // Vertex domain: duplicate each vertex position with slight offsets
      const posAttr = geometry.getAttribute('position');
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const normAttr = geometry.getAttribute('normal');
      const newPositions = [];

      for (let i = 0; i < posAttr.count; i++) {
        newPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      }
      for (let d = 1; d <= amount; d++) {
        const offsetDist = d * 0.01;
        for (let i = 0; i < posAttr.count; i++) {
          const nx = normAttr ? normAttr.getX(i) : 0;
          const ny = normAttr ? normAttr.getY(i) : 1;
          const nz = normAttr ? normAttr.getZ(i) : 0;
          newPositions.push(
            posAttr.getX(i) + nx * offsetDist,
            posAttr.getY(i) + ny * offsetDist,
            posAttr.getZ(i) + nz * offsetDist
          );
        }
      }

      geometry.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    } else if (amount > 0) {
      // Fallback for edges/instances: duplicate the whole geometry with offsets
      const posAttr = geometry.getAttribute('position');
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const normAttr = geometry.getAttribute('normal');
      const origCount = posAttr.count;
      const newPositions = [];
      const newIndices = [];

      for (let i = 0; i < origCount; i++) {
        newPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      }
      if (geometry.index) {
        const idxArr = geometry.index.array;
        for (let i = 0; i < idxArr.length; i++) newIndices.push(idxArr[i]);

        for (let d = 1; d <= amount; d++) {
          const off = d * 0.01;
          const base = newPositions.length / 3;
          for (let i = 0; i < origCount; i++) {
            const nx = normAttr ? normAttr.getX(i) : 0;
            const ny = normAttr ? normAttr.getY(i) : 1;
            const nz = normAttr ? normAttr.getZ(i) : 0;
            newPositions.push(posAttr.getX(i) + nx * off, posAttr.getY(i) + ny * off, posAttr.getZ(i) + nz * off);
          }
          for (let i = 0; i < idxArr.length; i++) newIndices.push(idxArr[i] + base);
        }

        geometry.dispose();
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
        geometry.setIndex(newIndices);
        geometry.computeVertexNormals();
      }
    }
  }

  // Apply fillet curve - round corners by inserting arc segments
  if (geoData.filletRadius > 0) {
    const radius = geoData.filletRadius;
    const count = geoData.filletCount || 4;
    const posAttr = geometry.getAttribute('position');
    if (posAttr && posAttr.count > 2) {
      const pts = [];
      // First point
      pts.push(posAttr.getX(0), posAttr.getY(0), posAttr.getZ(0));

      for (let i = 1; i < posAttr.count - 1; i++) {
        // Get three consecutive points
        const prev = { x: posAttr.getX(i - 1), y: posAttr.getY(i - 1), z: posAttr.getZ(i - 1) };
        const curr = { x: posAttr.getX(i), y: posAttr.getY(i), z: posAttr.getZ(i) };
        const next = { x: posAttr.getX(i + 1), y: posAttr.getY(i + 1), z: posAttr.getZ(i + 1) };

        // Direction vectors
        const d1 = { x: curr.x - prev.x, y: curr.y - prev.y, z: curr.z - prev.z };
        const d2 = { x: next.x - curr.x, y: next.y - curr.y, z: next.z - curr.z };
        const l1 = Math.sqrt(d1.x * d1.x + d1.y * d1.y + d1.z * d1.z) || 1;
        const l2 = Math.sqrt(d2.x * d2.x + d2.y * d2.y + d2.z * d2.z) || 1;

        // Normalized directions
        const n1 = { x: d1.x / l1, y: d1.y / l1, z: d1.z / l1 };
        const n2 = { x: d2.x / l2, y: d2.y / l2, z: d2.z / l2 };

        // Offset distance (limited by edge lengths)
        const offset = Math.min(radius, l1 * 0.4, l2 * 0.4);

        // Start and end of fillet
        const fStart = { x: curr.x - n1.x * offset, y: curr.y - n1.y * offset, z: curr.z - n1.z * offset };
        const fEnd = { x: curr.x + n2.x * offset, y: curr.y + n2.y * offset, z: curr.z + n2.z * offset };

        // Interpolate arc segments
        for (let j = 0; j <= count; j++) {
          const t = j / count;
          pts.push(
            fStart.x + t * (fEnd.x - fStart.x) + (1 - Math.abs(2 * t - 1)) * (curr.x - (fStart.x + fEnd.x) / 2) * 0.5,
            fStart.y + t * (fEnd.y - fStart.y) + (1 - Math.abs(2 * t - 1)) * (curr.y - (fStart.y + fEnd.y) / 2) * 0.5,
            fStart.z + t * (fEnd.z - fStart.z) + (1 - Math.abs(2 * t - 1)) * (curr.z - (fStart.z + fEnd.z) / 2) * 0.5
          );
        }
      }

      // Last point
      const last = posAttr.count - 1;
      pts.push(posAttr.getX(last), posAttr.getY(last), posAttr.getZ(last));

      geometry.dispose();
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    }
  }

  return geometry;
}

/**
 * Subdivide a BufferGeometry. When smooth is true, uses Catmull-Clark-like
 * averaging (face points + edge points) for better Blender compatibility.
 * When smooth is false, performs flat subdivision (midpoint splitting only).
 * Edge crease controls how much smoothing is applied (0 = full smooth, 1 = sharp).
 *
 * @param {THREE.BufferGeometry} inputGeo
 * @param {number} levels - Number of subdivision iterations
 * @param {boolean} smooth - Apply position smoothing (true = subdivision surface)
 * @param {number} [edgeCrease=0] - Edge crease factor (0=smooth, 1=sharp)
 * @returns {THREE.BufferGeometry}
 */
function subdivideGeometry(inputGeo, levels, smooth, edgeCrease) {
  if (levels <= 0) return inputGeo;

  // Ensure we have an indexed geometry to work with
  let geo = inputGeo.index ? inputGeo : inputGeo.toNonIndexed();
  if (!geo.index) {
    // Build trivial index for non-indexed geometry
    const count = geo.getAttribute('position').count;
    const indices = [];
    for (let i = 0; i < count; i++) indices.push(i);
    geo.setIndex(indices);
  }

  for (let iter = 0; iter < levels; iter++) {
    const posAttr = geo.getAttribute('position');
    const indexArr = geo.index.array;
    const triCount = Math.floor(indexArr.length / 3);

    // Collect positions
    const positions = [];
    for (let i = 0; i < posAttr.count; i++) {
      positions.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
    }
    const origVertCount = positions.length;

    // Build edge → midpoint-vertex-index map
    const edgeMidMap = new Map();     // "min,max" → new vertex index
    const edgeToFaces = new Map();    // "min,max" → [triIdx, ...]
    const vertEdges = new Map();      // vertIdx → Set of "min,max" edge keys

    const getEdgeKey = (a, b) => Math.min(a, b) + ',' + Math.max(a, b);

    // First pass: identify edges and create midpoints
    for (let f = 0; f < triCount; f++) {
      const a = indexArr[f * 3], b = indexArr[f * 3 + 1], c = indexArr[f * 3 + 2];
      for (const [v0, v1] of [[a, b], [b, c], [a, c]]) {
        const key = getEdgeKey(v0, v1);
        if (!edgeMidMap.has(key)) {
          // Create midpoint vertex
          const midIdx = positions.length;
          positions.push([
            (positions[v0][0] + positions[v1][0]) / 2,
            (positions[v0][1] + positions[v1][1]) / 2,
            (positions[v0][2] + positions[v1][2]) / 2,
          ]);
          edgeMidMap.set(key, midIdx);
          edgeToFaces.set(key, []);
        }
        edgeToFaces.get(key).push(f);

        if (!vertEdges.has(v0)) vertEdges.set(v0, new Set());
        if (!vertEdges.has(v1)) vertEdges.set(v1, new Set());
        vertEdges.get(v0).add(key);
        vertEdges.get(v1).add(key);
      }
    }

    // Smooth: Catmull-Clark-like averaging using face points for better Blender compat.
    // Edge crease blends between smooth (0) and sharp/flat (1) positions.
    const crease = edgeCrease ?? 0;
    if (smooth && crease < 1) {
      const smoothFactor = 1 - crease; // 1 = full smooth, 0 = sharp (no smoothing)

      // Compute face points (average of each face's vertices) - Catmull-Clark step 1
      const facePoints = [];
      for (let f = 0; f < triCount; f++) {
        const a = indexArr[f * 3], b = indexArr[f * 3 + 1], c = indexArr[f * 3 + 2];
        facePoints.push([
          (positions[a][0] + positions[b][0] + positions[c][0]) / 3,
          (positions[a][1] + positions[b][1] + positions[c][1]) / 3,
          (positions[a][2] + positions[b][2] + positions[c][2]) / 3,
        ]);
      }

      // Adjust edge midpoints using Catmull-Clark-like rule:
      // edge_point = (v0 + v1 + fp0 + fp1) / 4 for interior edges
      for (const [key, midIdx] of edgeMidMap) {
        const [sv0, sv1] = key.split(',').map(Number);
        const faces = edgeToFaces.get(key);
        const simpleMid = [
          (positions[sv0][0] + positions[sv1][0]) / 2,
          (positions[sv0][1] + positions[sv1][1]) / 2,
          (positions[sv0][2] + positions[sv1][2]) / 2,
        ];
        if (faces.length === 2) {
          // Interior edge: use Catmull-Clark edge point formula
          const fp0 = facePoints[faces[0]], fp1 = facePoints[faces[1]];
          const smoothMid = [
            (positions[sv0][0] + positions[sv1][0] + fp0[0] + fp1[0]) / 4,
            (positions[sv0][1] + positions[sv1][1] + fp0[1] + fp1[1]) / 4,
            (positions[sv0][2] + positions[sv1][2] + fp0[2] + fp1[2]) / 4,
          ];
          // Blend between simple midpoint (sharp) and smooth edge point based on crease
          positions[midIdx] = [
            simpleMid[0] + (smoothMid[0] - simpleMid[0]) * smoothFactor,
            simpleMid[1] + (smoothMid[1] - simpleMid[1]) * smoothFactor,
            simpleMid[2] + (smoothMid[2] - simpleMid[2]) * smoothFactor,
          ];
        }
        // Boundary edges keep simple midpoint (already set)
      }

      // Adjust original vertices using Catmull-Clark-like vertex rule:
      // new_v = (F + 2R + (n-3)*v) / n
      // where F = avg of face points, R = avg of edge midpoints, n = valence
      const newPositions = positions.map(p => [...p]); // copy
      // Build vertex → face mapping
      const vertFaces = new Map();
      for (let f = 0; f < triCount; f++) {
        for (let j = 0; j < 3; j++) {
          const vi = indexArr[f * 3 + j];
          if (!vertFaces.has(vi)) vertFaces.set(vi, []);
          vertFaces.get(vi).push(f);
        }
      }

      for (let vi = 0; vi < origVertCount; vi++) {
        const edges = vertEdges.get(vi);
        if (!edges) continue;
        const n = edges.size; // valence
        if (n < 3) continue;

        // F: average of adjacent face points
        const adjFaces = vertFaces.get(vi) || [];
        let fx = 0, fy = 0, fz = 0;
        for (const fi of adjFaces) {
          fx += facePoints[fi][0];
          fy += facePoints[fi][1];
          fz += facePoints[fi][2];
        }
        const nf = adjFaces.length || 1;
        fx /= nf; fy /= nf; fz /= nf;

        // R: average of edge midpoints
        let rx = 0, ry = 0, rz = 0;
        for (const eKey of edges) {
          const midIdx = edgeMidMap.get(eKey);
          // Use simple midpoints for R (original positions, not smoothed)
          const [ev0, ev1] = eKey.split(',').map(Number);
          rx += (positions[ev0][0] + positions[ev1][0]) / 2;
          ry += (positions[ev0][1] + positions[ev1][1]) / 2;
          rz += (positions[ev0][2] + positions[ev1][2]) / 2;
        }
        rx /= n; ry /= n; rz /= n;

        // Catmull-Clark vertex rule: (F + 2R + (n-3)*V) / n
        const smoothPos = [
          (fx + 2 * rx + (n - 3) * positions[vi][0]) / n,
          (fy + 2 * ry + (n - 3) * positions[vi][1]) / n,
          (fz + 2 * rz + (n - 3) * positions[vi][2]) / n,
        ];

        // Blend between original (sharp) and smoothed based on crease
        newPositions[vi] = [
          positions[vi][0] + (smoothPos[0] - positions[vi][0]) * smoothFactor,
          positions[vi][1] + (smoothPos[1] - positions[vi][1]) * smoothFactor,
          positions[vi][2] + (smoothPos[2] - positions[vi][2]) * smoothFactor,
        ];
      }

      // Apply smoothed positions to original vertices only
      for (let vi = 0; vi < origVertCount; vi++) {
        positions[vi] = newPositions[vi];
      }
    }

    // Build new triangles: each original triangle → 4 sub-triangles
    const newIndices = [];
    for (let f = 0; f < triCount; f++) {
      const a = indexArr[f * 3], b = indexArr[f * 3 + 1], c = indexArr[f * 3 + 2];
      const mab = edgeMidMap.get(getEdgeKey(a, b));
      const mbc = edgeMidMap.get(getEdgeKey(b, c));
      const mac = edgeMidMap.get(getEdgeKey(a, c));

      // 4 sub-triangles
      newIndices.push(a, mab, mac);
      newIndices.push(mab, b, mbc);
      newIndices.push(mac, mbc, c);
      newIndices.push(mab, mbc, mac);
    }

    // Build new geometry
    const flatPositions = new Float32Array(positions.length * 3);
    for (let i = 0; i < positions.length; i++) {
      flatPositions[i * 3] = positions[i][0];
      flatPositions[i * 3 + 1] = positions[i][1];
      flatPositions[i * 3 + 2] = positions[i][2];
    }

    geo.dispose();
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(flatPositions, 3));
    geo.setIndex(newIndices);
    geo.computeVertexNormals();
  }

  inputGeo.dispose();
  return geo;
}

/**
 * Resample a curve geometry to a new point count or segment length.
 */
function resampleCurveGeometry(geo, opts) {
  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count < 2) return geo;

  // Compute cumulative arc lengths
  const arcLengths = [0];
  for (let i = 1; i < posAttr.count; i++) {
    const dx = posAttr.getX(i) - posAttr.getX(i - 1);
    const dy = posAttr.getY(i) - posAttr.getY(i - 1);
    const dz = posAttr.getZ(i) - posAttr.getZ(i - 1);
    arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const totalLength = arcLengths[arcLengths.length - 1];
  if (totalLength === 0) return geo;

  let targetCount;
  if (opts.mode === 'length' && opts.length > 0) {
    targetCount = Math.max(2, Math.round(totalLength / opts.length) + 1);
  } else {
    targetCount = Math.max(2, opts.count || 16);
  }

  // Interpolate new points at uniform arc-length intervals
  const pts = [];
  for (let i = 0; i < targetCount; i++) {
    const t = i / (targetCount - 1);
    const targetLen = t * totalLength;

    // Find segment containing this arc length
    let segIdx = 0;
    for (let j = 1; j < arcLengths.length; j++) {
      if (arcLengths[j] >= targetLen) { segIdx = j - 1; break; }
      if (j === arcLengths.length - 1) segIdx = j - 1;
    }

    const segLen = arcLengths[segIdx + 1] - arcLengths[segIdx];
    const localT = segLen > 0 ? (targetLen - arcLengths[segIdx]) / segLen : 0;

    const x = posAttr.getX(segIdx) + (posAttr.getX(segIdx + 1) - posAttr.getX(segIdx)) * localT;
    const y = posAttr.getY(segIdx) + (posAttr.getY(segIdx + 1) - posAttr.getY(segIdx)) * localT;
    const z = posAttr.getZ(segIdx) + (posAttr.getZ(segIdx + 1) - posAttr.getZ(segIdx)) * localT;
    pts.push(x, y, z);
  }

  geo.dispose();
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return newGeo;
}

/**
 * Merge vertices that are within a distance threshold.
 */
function mergeByDistanceGeometry(geo, threshold, mode) {
  const posAttr = geo.getAttribute('position');
  if (!posAttr) return geo;

  // For "connected" mode, build edge adjacency so we only merge connected vertices
  let edgeAdj = null;
  if (mode === 'connected') {
    edgeAdj = new Map();
    const addEdge = (a, b) => {
      if (!edgeAdj.has(a)) edgeAdj.set(a, new Set());
      if (!edgeAdj.has(b)) edgeAdj.set(b, new Set());
      edgeAdj.get(a).add(b);
      edgeAdj.get(b).add(a);
    };
    if (geo.index) {
      const idxArr = geo.index.array;
      for (let i = 0; i < idxArr.length; i += 3) {
        addEdge(idxArr[i], idxArr[i + 1]);
        addEdge(idxArr[i + 1], idxArr[i + 2]);
        addEdge(idxArr[i + 2], idxArr[i]);
      }
    } else {
      for (let i = 0; i < posAttr.count; i += 3) {
        addEdge(i, i + 1);
        addEdge(i + 1, i + 2);
        addEdge(i + 2, i);
      }
    }
  }

  // Build mapping: old vertex index → merged vertex index
  const mergedPositions = [];
  const indexMap = new Int32Array(posAttr.count).fill(-1);

  for (let i = 0; i < posAttr.count; i++) {
    if (indexMap[i] !== -1) continue;
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const newIdx = mergedPositions.length / 3;
    mergedPositions.push(x, y, z);
    indexMap[i] = newIdx;

    if (mode === 'connected' && edgeAdj) {
      // Only merge vertices that share an edge with vertex i and are within threshold
      // Use BFS/union-find approach: walk connected neighbors within distance
      const queue = [i];
      const visited = new Set([i]);
      while (queue.length > 0) {
        const cur = queue.shift();
        const neighbors = edgeAdj.get(cur);
        if (!neighbors) continue;
        for (const j of neighbors) {
          if (visited.has(j) || indexMap[j] !== -1) continue;
          const dx = posAttr.getX(j) - x, dy = posAttr.getY(j) - y, dz = posAttr.getZ(j) - z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= threshold) {
            indexMap[j] = newIdx;
            visited.add(j);
            queue.push(j);
          }
        }
      }
    } else {
      // "all" mode: merge any vertices within threshold
      for (let j = i + 1; j < posAttr.count; j++) {
        if (indexMap[j] !== -1) continue;
        const dx = posAttr.getX(j) - x, dy = posAttr.getY(j) - y, dz = posAttr.getZ(j) - z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= threshold) {
          indexMap[j] = newIdx;
        }
      }
    }
  }

  // Rebuild index buffer with merged references
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(mergedPositions, 3));

  if (geo.index) {
    const oldIdx = geo.index.array;
    const newIdx = [];
    for (let i = 0; i < oldIdx.length; i += 3) {
      const a = indexMap[oldIdx[i]], b = indexMap[oldIdx[i + 1]], c = indexMap[oldIdx[i + 2]];
      // Skip degenerate triangles
      if (a !== b && b !== c && a !== c) newIdx.push(a, b, c);
    }
    newGeo.setIndex(newIdx);
  } else {
    const newIdx = [];
    for (let i = 0; i < posAttr.count; i += 3) {
      const a = indexMap[i], b = indexMap[i + 1], c = indexMap[i + 2];
      if (a !== b && b !== c && a !== c) newIdx.push(a, b, c);
    }
    newGeo.setIndex(newIdx);
  }

  newGeo.computeVertexNormals();
  geo.dispose();
  return newGeo;
}

/**
 * Compute the convex hull of a geometry's vertices.
 * Uses an incremental algorithm for 3D convex hull.
 */
function computeConvexHull(geo) {
  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count < 4) return geo;

  // Deduplicate vertices
  const uniqueVerts = [];
  const seen = new Set();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const key = `${x.toFixed(8)},${y.toFixed(8)},${z.toFixed(8)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueVerts.push({ x, y, z });
    }
  }
  const verts = uniqueVerts;
  if (verts.length < 4) return geo;

  // Find initial tetrahedron (4 non-coplanar points)
  let p0 = 0, p1 = -1, p2 = -1, p3 = -1;
  // Find farthest point from p0
  let maxDist = 0;
  for (let i = 1; i < verts.length; i++) {
    const dx = verts[i].x - verts[p0].x, dy = verts[i].y - verts[p0].y, dz = verts[i].z - verts[p0].z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > maxDist) { maxDist = d; p1 = i; }
  }
  if (p1 === -1) return geo;

  // Find farthest from line p0-p1
  const e01 = { x: verts[p1].x - verts[p0].x, y: verts[p1].y - verts[p0].y, z: verts[p1].z - verts[p0].z };
  maxDist = 0;
  for (let i = 0; i < verts.length; i++) {
    if (i === p0 || i === p1) continue;
    const ap = { x: verts[i].x - verts[p0].x, y: verts[i].y - verts[p0].y, z: verts[i].z - verts[p0].z };
    const cx = e01.y * ap.z - e01.z * ap.y, cy = e01.z * ap.x - e01.x * ap.z, cz = e01.x * ap.y - e01.y * ap.x;
    const d = cx * cx + cy * cy + cz * cz;
    if (d > maxDist) { maxDist = d; p2 = i; }
  }
  if (p2 === -1) return geo;

  // Find farthest from plane p0-p1-p2
  const e02 = { x: verts[p2].x - verts[p0].x, y: verts[p2].y - verts[p0].y, z: verts[p2].z - verts[p0].z };
  const normal = { x: e01.y * e02.z - e01.z * e02.y, y: e01.z * e02.x - e01.x * e02.z, z: e01.x * e02.y - e01.y * e02.x };
  maxDist = 0;
  for (let i = 0; i < verts.length; i++) {
    if (i === p0 || i === p1 || i === p2) continue;
    const d = Math.abs(normal.x * (verts[i].x - verts[p0].x) + normal.y * (verts[i].y - verts[p0].y) + normal.z * (verts[i].z - verts[p0].z));
    if (d > maxDist) { maxDist = d; p3 = i; }
  }
  if (p3 === -1) return geo;

  // Orient initial tetrahedron so all normals point outward
  const d = normal.x * (verts[p3].x - verts[p0].x) + normal.y * (verts[p3].y - verts[p0].y) + normal.z * (verts[p3].z - verts[p0].z);
  let faces = d > 0
    ? [[p0, p2, p1], [p0, p1, p3], [p1, p2, p3], [p0, p3, p2]]
    : [[p0, p1, p2], [p0, p3, p1], [p1, p3, p2], [p0, p2, p3]];

  const faceNormal = (f) => {
    const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
    return { x: aby * acz - abz * acy, y: abz * acx - abx * acz, z: abx * acy - aby * acx };
  };

  // Incrementally add remaining points
  const used = new Set([p0, p1, p2, p3]);
  for (let i = 0; i < verts.length; i++) {
    if (used.has(i)) continue;
    const pt = verts[i];

    // Find visible faces
    const visible = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const n = faceNormal(faces[fi]);
      const a = verts[faces[fi][0]];
      const dot = n.x * (pt.x - a.x) + n.y * (pt.y - a.y) + n.z * (pt.z - a.z);
      if (dot > 1e-10) visible.push(fi);
    }
    if (visible.length === 0) continue;
    used.add(i);

    // Find horizon edges — edges with exactly one visible face
    const edgeCount = new Map();
    for (const fi of visible) {
      const f = faces[fi];
      for (let j = 0; j < 3; j++) {
        const a = f[j], b = f[(j + 1) % 3];
        // Store directed edge a→b
        const key = a + ',' + b;
        const reverseKey = b + ',' + a;
        if (edgeCount.has(reverseKey)) {
          edgeCount.delete(reverseKey); // shared edge, remove both
        } else {
          edgeCount.set(key, [a, b]);
        }
      }
    }

    // Remove visible faces (in reverse order to preserve indices)
    visible.sort((a, b) => b - a);
    for (const fi of visible) faces.splice(fi, 1);

    // Create new faces from horizon edges to new point
    for (const [, [a, b]] of edgeCount) {
      faces.push([b, a, i]); // reverse winding to face outward
    }
  }

  // Build geometry from hull faces
  const pts = [];
  const indices = [];
  const vertMap = new Map();
  for (const f of faces) {
    for (const vi of f) {
      if (!vertMap.has(vi)) {
        vertMap.set(vi, pts.length / 3);
        pts.push(verts[vi].x, verts[vi].y, verts[vi].z);
      }
    }
    indices.push(vertMap.get(f[0]), vertMap.get(f[1]), vertMap.get(f[2]));
  }

  geo.dispose();
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  newGeo.setIndex(indices);
  newGeo.computeVertexNormals();
  return newGeo;
}

/**
 * Compute the dual mesh: each face becomes a vertex (at centroid),
 * each original vertex becomes a face connecting adjacent centroids.
 */
function computeDualMesh(geo, keepBoundaries) {
  if (!geo.index) return geo;
  const posAttr = geo.getAttribute('position');
  const idxArr = geo.index.array;
  const triCount = Math.floor(idxArr.length / 3);
  if (triCount < 2) return geo;

  // Compute face centroids
  const centroids = [];
  for (let f = 0; f < triCount; f++) {
    const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
    centroids.push({
      x: (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3,
      y: (posAttr.getY(a) + posAttr.getY(b) + posAttr.getY(c)) / 3,
      z: (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3,
    });
  }

  // Build edge → face adjacency to detect boundary edges
  const edgeFaceCount = new Map();
  const edgeKey = (a, b) => Math.min(a, b) + ',' + Math.max(a, b);
  for (let f = 0; f < triCount; f++) {
    const v0 = idxArr[f * 3], v1 = idxArr[f * 3 + 1], v2 = idxArr[f * 3 + 2];
    for (const [a, b] of [[v0, v1], [v1, v2], [v2, v0]]) {
      const key = edgeKey(a, b);
      edgeFaceCount.set(key, (edgeFaceCount.get(key) || 0) + 1);
    }
  }

  // Identify boundary vertices (vertices touching a boundary edge)
  const boundaryVerts = new Set();
  for (const [key, count] of edgeFaceCount) {
    if (count === 1) {
      const [a, b] = key.split(',').map(Number);
      boundaryVerts.add(a);
      boundaryVerts.add(b);
    }
  }

  // Build vertex → face adjacency
  const vertFaces = new Map();
  for (let f = 0; f < triCount; f++) {
    for (let j = 0; j < 3; j++) {
      const v = idxArr[f * 3 + j];
      if (!vertFaces.has(v)) vertFaces.set(v, []);
      vertFaces.get(v).push(f);
    }
  }

  // Build face → face adjacency (faces sharing an edge)
  const faceNeighbors = new Map(); // faceIdx -> Map<faceIdx, sharedEdge>
  for (let f = 0; f < triCount; f++) faceNeighbors.set(f, new Map());
  const edgeFaces = new Map(); // edgeKey -> [faceIdx, ...]
  for (let f = 0; f < triCount; f++) {
    const v0 = idxArr[f * 3], v1 = idxArr[f * 3 + 1], v2 = idxArr[f * 3 + 2];
    for (const [a, b] of [[v0, v1], [v1, v2], [v2, v0]]) {
      const key = edgeKey(a, b);
      if (!edgeFaces.has(key)) edgeFaces.set(key, []);
      edgeFaces.get(key).push(f);
    }
  }
  for (const [, faces] of edgeFaces) {
    if (faces.length === 2) {
      faceNeighbors.get(faces[0]).set(faces[1], true);
      faceNeighbors.get(faces[1]).set(faces[0], true);
    }
  }

  // Dual mesh vertices = face centroids (+ boundary vertices if keepBoundaries)
  const pts = [];
  const indices = [];
  for (const c of centroids) pts.push(c.x, c.y, c.z);

  // If keepBoundaries, add boundary vertex positions as extra dual vertices
  const boundaryVertDualIdx = new Map();
  if (keepBoundaries) {
    for (const bv of boundaryVerts) {
      const dualIdx = pts.length / 3;
      boundaryVertDualIdx.set(bv, dualIdx);
      pts.push(posAttr.getX(bv), posAttr.getY(bv), posAttr.getZ(bv));
    }
  }

  for (const [v, adjFaces] of vertFaces) {
    const isBoundary = boundaryVerts.has(v);
    // Skip boundary vertices entirely unless keepBoundaries is set
    if (isBoundary && !keepBoundaries) continue;
    if (adjFaces.length < 3 && !isBoundary) continue;
    if (adjFaces.length < 2) continue;

    const vx = posAttr.getX(v), vy = posAttr.getY(v), vz = posAttr.getZ(v);

    // Compute proper vertex normal from adjacent face normals (area-weighted)
    let nx = 0, ny = 0, nz = 0;
    for (const fi of adjFaces) {
      const a = idxArr[fi * 3], b = idxArr[fi * 3 + 1], c = idxArr[fi * 3 + 2];
      const abx = posAttr.getX(b) - posAttr.getX(a), aby = posAttr.getY(b) - posAttr.getY(a), abz = posAttr.getZ(b) - posAttr.getZ(a);
      const acx = posAttr.getX(c) - posAttr.getX(a), acy = posAttr.getY(c) - posAttr.getY(a), acz = posAttr.getZ(c) - posAttr.getZ(a);
      nx += aby * acz - abz * acy;
      ny += abz * acx - abx * acz;
      nz += abx * acy - aby * acx;
    }
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nLen; ny /= nLen; nz /= nLen;

    // Build tangent frame for angle sorting
    const c0 = centroids[adjFaces[0]];
    let tx = c0.x - vx, ty = c0.y - vy, tz = c0.z - vz;
    // Orthogonalize tangent against normal
    const dot = tx * nx + ty * ny + tz * nz;
    tx -= dot * nx; ty -= dot * ny; tz -= dot * nz;
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tLen; ty /= tLen; tz /= tLen;
    // Bitangent = normal x tangent
    let btx = ny * tz - nz * ty, bty = nz * tx - nx * tz, btz = nx * ty - ny * tx;
    const bLen = Math.sqrt(btx * btx + bty * bty + btz * btz) || 1;
    btx /= bLen; bty /= bLen; btz /= bLen;

    // Sort faces by angle around the vertex normal
    const sorted = adjFaces.slice().sort((fi1, fi2) => {
      const c1 = centroids[fi1], c2 = centroids[fi2];
      const dx1 = c1.x - vx, dy1 = c1.y - vy, dz1 = c1.z - vz;
      const dx2 = c2.x - vx, dy2 = c2.y - vy, dz2 = c2.z - vz;
      const a1 = Math.atan2(dx1 * btx + dy1 * bty + dz1 * btz, dx1 * tx + dy1 * ty + dz1 * tz);
      const a2 = Math.atan2(dx2 * btx + dy2 * bty + dz2 * btz, dx2 * tx + dy2 * ty + dz2 * tz);
      return a1 - a2;
    });

    if (isBoundary && keepBoundaries) {
      // For boundary vertices with keepBoundaries, create a fan that includes
      // the boundary vertex position and the adjacent face centroids
      const bvIdx = boundaryVertDualIdx.get(v);
      if (bvIdx !== undefined && sorted.length >= 2) {
        // Fan: boundary vertex -> sorted centroids
        for (let i = 0; i < sorted.length - 1; i++) {
          indices.push(bvIdx, sorted[i], sorted[i + 1]);
        }
      }
    } else {
      // Interior vertex: fan triangulate the sorted polygon of centroids
      for (let i = 1; i < sorted.length - 1; i++) {
        indices.push(sorted[0], sorted[i], sorted[i + 1]);
      }
    }
  }

  geo.dispose();
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  if (indices.length > 0) newGeo.setIndex(indices);
  newGeo.computeVertexNormals();
  return newGeo;
}

/**
 * Convert a mesh to a curve by extracting boundary/edge loops.
 */
function meshToCurveGeometry(geo) {
  if (!geo.index) {
    // Non-indexed: just return as-is (already point-based)
    return geo;
  }
  const posAttr = geo.getAttribute('position');
  const idxArr = geo.index.array;
  const triCount = Math.floor(idxArr.length / 3);

  // Find boundary edges (edges used by only one triangle)
  const edgeMap = new Map();
  for (let f = 0; f < triCount; f++) {
    const verts = [idxArr[f * 3], idxArr[f * 3 + 1], idxArr[f * 3 + 2]];
    for (let j = 0; j < 3; j++) {
      const a = verts[j], b = verts[(j + 1) % 3];
      const key = Math.min(a, b) + ',' + Math.max(a, b);
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    }
  }

  // Collect boundary edge vertices
  const boundaryEdges = [];
  for (const [key, count] of edgeMap) {
    if (count === 1) {
      const [a, b] = key.split(',').map(Number);
      boundaryEdges.push([a, b]);
    }
  }

  if (boundaryEdges.length === 0) {
    // Closed mesh, no boundary - extract all unique edges instead
    const pts = [];
    const seen = new Set();
    for (const [key] of edgeMap) {
      if (seen.has(key)) continue;
      seen.add(key);
      const [a, b] = key.split(',').map(Number);
      pts.push(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
      pts.push(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
    }
    geo.dispose();
    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return newGeo;
  }

  // Chain boundary edges into a loop
  const adjMap = new Map();
  for (const [a, b] of boundaryEdges) {
    if (!adjMap.has(a)) adjMap.set(a, []);
    if (!adjMap.has(b)) adjMap.set(b, []);
    adjMap.get(a).push(b);
    adjMap.get(b).push(a);
  }

  const visited = new Set();
  const pts = [];
  let current = boundaryEdges[0][0];
  while (!visited.has(current) && adjMap.has(current)) {
    visited.add(current);
    pts.push(posAttr.getX(current), posAttr.getY(current), posAttr.getZ(current));
    const neighbors = adjMap.get(current) || [];
    current = neighbors.find(n => !visited.has(n)) ?? -1;
    if (current === -1) break;
  }

  geo.dispose();
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return newGeo;
}

// ── Field Evaluation Helpers ─────────────────────────────────────────────────

/**
 * Build element contexts from a geometry descriptor for field evaluation.
 * Returns an array of { position, normal, index, count } objects.
 *
 * @param {object} geoData - Geometry descriptor
 * @param {string} [domain='point'] - Domain: 'point', 'face', 'edge'
 * @returns {{ elements: Array, geometry: THREE.BufferGeometry|null }}
 */
export function buildElements(geoData, domain = 'point') {
  if (!geoData) return { elements: [], geometry: null };

  const item = Array.isArray(geoData) ? geoData[0] : geoData;
  if (!item) return { elements: [], geometry: null };

  const geo = buildGeometry(item);
  if (!geo) return { elements: [], geometry: null };

  const posAttr = geo.getAttribute('position');
  if (!posAttr) { geo.dispose(); return { elements: [], geometry: null }; }

  // Ensure normals exist
  if (!geo.getAttribute('normal')) {
    try { geo.computeVertexNormals(); } catch (e) { /* curves may not have normals */ }
  }
  const normAttr = geo.getAttribute('normal');

  const elements = [];

  if (domain === 'face' && geo.index) {
    const idxArr = geo.index.array;
    const triCount = Math.floor(idxArr.length / 3);
    for (let f = 0; f < triCount; f++) {
      const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
      // Face centroid as position
      elements.push({
        position: {
          x: (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3,
          y: (posAttr.getY(a) + posAttr.getY(b) + posAttr.getY(c)) / 3,
          z: (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3,
        },
        normal: normAttr ? {
          x: (normAttr.getX(a) + normAttr.getX(b) + normAttr.getX(c)) / 3,
          y: (normAttr.getY(a) + normAttr.getY(b) + normAttr.getY(c)) / 3,
          z: (normAttr.getZ(a) + normAttr.getZ(b) + normAttr.getZ(c)) / 3,
        } : { x: 0, y: 1, z: 0 },
        index: f,
        count: triCount,
      });
    }
  } else {
    // Point domain (default)
    for (let i = 0; i < posAttr.count; i++) {
      elements.push({
        position: {
          x: posAttr.getX(i),
          y: posAttr.getY(i),
          z: posAttr.getZ(i),
        },
        normal: normAttr ? {
          x: normAttr.getX(i),
          y: normAttr.getY(i),
          z: normAttr.getZ(i),
        } : { x: 0, y: 1, z: 0 },
        index: i,
        count: posAttr.count,
      });
    }
  }

  return { elements, geometry: geo };
}

// ── Geometry Analysis Helpers ────────────────────────────────────────────────

/**
 * Compute the world-space bounding box of a geometry descriptor.
 * Returns { min: {x,y,z}, max: {x,y,z} } or null.
 */
export function computeBounds(geoData) {
  if (!geoData) return null;
  const items = Array.isArray(geoData) ? geoData : [geoData];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const item of items) {
    if (!item) continue;
    const geo = buildGeometry(item);
    if (!geo) continue;

    geo.computeBoundingBox();
    const bb = geo.boundingBox;

    if (item.transforms && item.transforms.length > 0) {
      const mesh = new THREE.Mesh(geo);
      for (const t of item.transforms) {
        if (t.translate) { mesh.position.x += t.translate.x || 0; mesh.position.y += t.translate.y || 0; mesh.position.z += t.translate.z || 0; }
        if (t.rotate) { mesh.rotation.x += t.rotate.x || 0; mesh.rotation.y += t.rotate.y || 0; mesh.rotation.z += t.rotate.z || 0; }
        if (t.scale) { mesh.scale.x *= t.scale.x || 1; mesh.scale.y *= t.scale.y || 1; mesh.scale.z *= t.scale.z || 1; }
      }
      mesh.updateMatrixWorld(true);
      const corners = [
        new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z), new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
        new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z), new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
        new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z), new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z), new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
      ];
      for (const c of corners) {
        c.applyMatrix4(mesh.matrixWorld);
        minX = Math.min(minX, c.x); minY = Math.min(minY, c.y); minZ = Math.min(minZ, c.z);
        maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y); maxZ = Math.max(maxZ, c.z);
      }
    } else {
      minX = Math.min(minX, bb.min.x); minY = Math.min(minY, bb.min.y); minZ = Math.min(minZ, bb.min.z);
      maxX = Math.max(maxX, bb.max.x); maxY = Math.max(maxY, bb.max.y); maxZ = Math.max(maxZ, bb.max.z);
    }
    geo.dispose();
  }

  if (minX === Infinity) return null;
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/**
 * Count domain sizes (points, edges, faces, etc.) of a geometry descriptor.
 */
export function computeDomainSize(geoData) {
  if (!geoData) return { points: 0, edges: 0, faces: 0, faceCorners: 0, splines: 0, instances: 0 };
  const items = Array.isArray(geoData) ? geoData : [geoData];
  let totalPoints = 0, totalEdges = 0, totalFaces = 0, totalCorners = 0;
  let totalSplines = 0, totalInstances = 0;

  for (const item of items) {
    if (!item) continue;
    if (item.isInstance) { totalInstances++; continue; }

    const isCurve = ['curve_circle', 'curve_line', 'spiral', 'curve_arc', 'curve_star'].includes(item.type);
    if (isCurve) {
      totalSplines++;
      const geo = buildGeometry(item);
      if (geo) { totalPoints += geo.getAttribute('position')?.count || 0; geo.dispose(); }
      continue;
    }

    const geo = buildGeometry(item);
    if (!geo) continue;
    const posAttr = geo.getAttribute('position');
    const vertCount = posAttr ? posAttr.count : 0;
    totalPoints += vertCount;

    if (geo.index) {
      const idxCount = geo.index.count;
      totalFaces += Math.floor(idxCount / 3);
      totalCorners += idxCount;
      const edgeSet = new Set();
      for (let i = 0; i < idxCount; i += 3) {
        const a = geo.index.getX(i), b = geo.index.getX(i + 1), c = geo.index.getX(i + 2);
        edgeSet.add(Math.min(a, b) + ',' + Math.max(a, b));
        edgeSet.add(Math.min(b, c) + ',' + Math.max(b, c));
        edgeSet.add(Math.min(a, c) + ',' + Math.max(a, c));
      }
      totalEdges += edgeSet.size;
    } else {
      totalFaces += Math.floor(vertCount / 3);
      totalCorners += vertCount;
      totalEdges += vertCount; // each 3 verts → 3 edges
    }
    geo.dispose();
  }

  return { points: totalPoints, edges: totalEdges, faces: totalFaces, faceCorners: totalCorners, splines: totalSplines, instances: totalInstances };
}

/**
 * Compute the length of a curve and its point count.
 */
export function computeCurveLength(geoData) {
  if (!geoData) return { length: 0, pointCount: 0 };
  const item = Array.isArray(geoData) ? geoData[0] : geoData;
  if (!item) return { length: 0, pointCount: 0 };

  // Fast path for known curve types
  if (item.type === 'curve_circle') {
    const r = item.radius || 1;
    return { length: 2 * Math.PI * r, pointCount: (item.resolution || 16) + 1 };
  }
  if (item.type === 'curve_line') {
    const s = item.start || { x: 0, y: 0, z: 0 }, e = item.end || { x: 0, y: 0, z: 1 };
    const dx = e.x - s.x, dy = e.y - s.y, dz = e.z - s.z;
    return { length: Math.sqrt(dx * dx + dy * dy + dz * dz), pointCount: 2 };
  }
  if (item.type === 'curve_arc') {
    const r = item.radius || 1, sweep = item.sweepAngle || (315 * Math.PI / 180);
    return { length: Math.abs(r * sweep), pointCount: (item.resolution || 16) + 1 };
  }

  // General: build and sum segment lengths
  const geo = buildGeometry(item);
  if (!geo) return { length: 0, pointCount: 0 };
  const posAttr = geo.getAttribute('position');
  if (!posAttr || posAttr.count < 2) { const pc = posAttr ? posAttr.count : 0; geo.dispose(); return { length: 0, pointCount: pc }; }

  let length = 0;
  for (let i = 1; i < posAttr.count; i++) {
    const dx = posAttr.getX(i) - posAttr.getX(i - 1);
    const dy = posAttr.getY(i) - posAttr.getY(i - 1);
    const dz = posAttr.getZ(i) - posAttr.getZ(i - 1);
    length += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const pointCount = posAttr.count;
  geo.dispose();
  return { length, pointCount };
}

/**
 * Find the closest point on geometry to a source position.
 */
export function computeClosestPoint(geoData, sourcePos, targetElement) {
  if (!geoData) return { position: { x: 0, y: 0, z: 0 }, distance: 0 };
  const items = Array.isArray(geoData) ? geoData : [geoData];
  let closestPos = { x: 0, y: 0, z: 0 };
  let closestDist = Infinity;
  const sx = sourcePos?.x || 0, sy = sourcePos?.y || 0, sz = sourcePos?.z || 0;
  const mode = targetElement || 'points';

  // Helper: closest point on line segment ab to point p
  function closestPointOnSegment(ax, ay, az, bx, by, bz, px, py, pz) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const ab2 = abx * abx + aby * aby + abz * abz;
    if (ab2 < 1e-12) return { x: ax, y: ay, z: az };
    let t = (apx * abx + apy * aby + apz * abz) / ab2;
    t = Math.max(0, Math.min(1, t));
    return { x: ax + abx * t, y: ay + aby * t, z: az + abz * t };
  }

  // Helper: closest point on triangle to point p (Ericson's real-time collision detection)
  function closestPointOnTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, px, py, pz) {
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return { x: ax, y: ay, z: az };
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return { x: bx, y: by, z: bz };
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return { x: ax + abx * v, y: ay + aby * v, z: az + abz * v };
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return { x: cx, y: cy, z: cz };
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return { x: ax + acx * w, y: ay + acy * w, z: az + acz * w };
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return { x: bx + (cx - bx) * w, y: by + (cy - by) * w, z: bz + (cz - bz) * w };
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    return { x: ax + abx * v + acx * w, y: ay + aby * v + acy * w, z: az + abz * v + acz * w };
  }

  function updateClosest(pt) {
    const dx = pt.x - sx, dy = pt.y - sy, dz = pt.z - sz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < closestDist) {
      closestDist = dist;
      closestPos = pt;
    }
  }

  for (const item of items) {
    if (!item) continue;
    const geo = buildGeometry(item);
    if (!geo) continue;
    const posAttr = geo.getAttribute('position');
    if (!posAttr) { geo.dispose(); continue; }

    if (mode === 'points') {
      for (let i = 0; i < posAttr.count; i++) {
        updateClosest({ x: posAttr.getX(i), y: posAttr.getY(i), z: posAttr.getZ(i) });
      }
    } else if (mode === 'edges') {
      const getIdx = geo.index ? (i) => geo.index.getX(i) : (i) => i;
      const triCount = geo.index ? Math.floor(geo.index.count / 3) : Math.floor(posAttr.count / 3);
      const seen = new Set();
      for (let f = 0; f < triCount; f++) {
        const ai = getIdx(f * 3), bi = getIdx(f * 3 + 1), ci = getIdx(f * 3 + 2);
        const edges = [[ai, bi], [bi, ci], [ci, ai]];
        for (const [e0, e1] of edges) {
          const key = Math.min(e0, e1) + ',' + Math.max(e0, e1);
          if (seen.has(key)) continue;
          seen.add(key);
          updateClosest(closestPointOnSegment(
            posAttr.getX(e0), posAttr.getY(e0), posAttr.getZ(e0),
            posAttr.getX(e1), posAttr.getY(e1), posAttr.getZ(e1),
            sx, sy, sz
          ));
        }
      }
    } else {
      // 'faces' mode: closest point on each triangle
      const getIdx = geo.index ? (i) => geo.index.getX(i) : (i) => i;
      const triCount = geo.index ? Math.floor(geo.index.count / 3) : Math.floor(posAttr.count / 3);
      for (let f = 0; f < triCount; f++) {
        const ai = getIdx(f * 3), bi = getIdx(f * 3 + 1), ci = getIdx(f * 3 + 2);
        updateClosest(closestPointOnTriangle(
          posAttr.getX(ai), posAttr.getY(ai), posAttr.getZ(ai),
          posAttr.getX(bi), posAttr.getY(bi), posAttr.getZ(bi),
          posAttr.getX(ci), posAttr.getY(ci), posAttr.getZ(ci),
          sx, sy, sz
        ));
      }
    }
    geo.dispose();
  }

  return { position: closestPos, distance: closestDist === Infinity ? 0 : closestDist };
}

/**
 * Perform a raycast against geometry. Returns hit info.
 */
export function performRaycast(geoData, sourcePos, rayDir, rayLength) {
  const noHit = { isHit: false, hitPos: { x: 0, y: 0, z: 0 }, hitNormal: { x: 0, y: 1, z: 0 }, hitDist: 0 };
  if (!geoData) return noHit;

  const items = Array.isArray(geoData) ? geoData : [geoData];
  const origin = new THREE.Vector3(sourcePos?.x || 0, sourcePos?.y || 0, sourcePos?.z || 0);
  const direction = new THREE.Vector3(rayDir?.x || 0, rayDir?.y || 0, rayDir?.z || -1).normalize();
  const raycaster = new THREE.Raycaster(origin, direction, 0, rayLength || 100);
  let closestHit = null;

  for (const item of items) {
    if (!item) continue;
    const geo = buildGeometry(item);
    if (!geo) continue;
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    if (item.transforms) {
      for (const t of item.transforms) {
        if (t.translate) { mesh.position.x += t.translate.x || 0; mesh.position.y += t.translate.y || 0; mesh.position.z += t.translate.z || 0; }
        if (t.rotate) { mesh.rotation.x += t.rotate.x || 0; mesh.rotation.y += t.rotate.y || 0; mesh.rotation.z += t.rotate.z || 0; }
        if (t.scale) { mesh.scale.x *= t.scale.x || 1; mesh.scale.y *= t.scale.y || 1; mesh.scale.z *= t.scale.z || 1; }
      }
      mesh.updateMatrixWorld(true);
    }

    const hits = raycaster.intersectObject(mesh);
    if (hits.length > 0 && (!closestHit || hits[0].distance < closestHit.distance)) {
      closestHit = hits[0];
    }
    geo.dispose();
  }

  if (!closestHit) return noHit;

  // Extract hit normal - transform face normal by the object's world matrix if available
  let hitNormal = { x: 0, y: 1, z: 0 };
  if (closestHit.face) {
    const fn = closestHit.face.normal;
    if (closestHit.object) {
      // Transform face normal from object space to world space
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(closestHit.object.matrixWorld);
      const worldNormal = new THREE.Vector3(fn.x, fn.y, fn.z).applyMatrix3(normalMatrix).normalize();
      hitNormal = { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z };
    } else {
      hitNormal = { x: fn.x, y: fn.y, z: fn.z };
    }
  }

  // Extract UV coordinates from intersection if available
  let hitUV = { x: 0, y: 0, z: 0 };
  if (closestHit.uv) {
    hitUV = { x: closestHit.uv.x, y: closestHit.uv.y, z: 0 };
  }

  // Interpolate attribute value at hit point using barycentric coordinates
  let hitAttribute = 0;
  if (closestHit.face && closestHit.object) {
    const geo = closestHit.object.geometry;
    if (geo) {
      // Use face index to look up which triangle was hit
      const faceIdx = closestHit.faceIndex;
      if (faceIdx !== undefined && faceIdx !== null) {
        // Could interpolate any per-vertex attribute here using barycentric coords
        // For now expose the face index as the attribute value for downstream use
        hitAttribute = faceIdx;
      }
    }
  }

  return {
    isHit: true,
    hitPos: { x: closestHit.point.x, y: closestHit.point.y, z: closestHit.point.z },
    hitNormal,
    hitDist: closestHit.distance,
    hitUV,
    hitAttribute,
  };
}

/**
 * Sample all attributes at a specific index from geometry.
 * Returns position vector, normal vector, UV, and color when available.
 */
export function sampleAtIndex(geoData, index, clamp) {
  if (!geoData) return null;
  const item = Array.isArray(geoData) ? geoData[0] : geoData;
  if (!item) return null;
  const geo = buildGeometry(item);
  if (!geo) return null;
  const posAttr = geo.getAttribute('position');
  if (!posAttr) { geo.dispose(); return null; }
  const idx = clamp
    ? Math.max(0, Math.min(index, posAttr.count - 1))
    : Math.max(0, Math.min(index, posAttr.count - 1));
  const result = {
    position: { x: posAttr.getX(idx), y: posAttr.getY(idx), z: posAttr.getZ(idx) },
    count: posAttr.count,
  };
  // Sample normal if available
  const normAttr = geo.getAttribute('normal');
  if (normAttr && idx < normAttr.count) {
    result.normal = { x: normAttr.getX(idx), y: normAttr.getY(idx), z: normAttr.getZ(idx) };
  } else {
    result.normal = { x: 0, y: 1, z: 0 };
  }
  // Sample UV if available
  const uvAttr = geo.getAttribute('uv');
  if (uvAttr && idx < uvAttr.count) {
    result.uv = { x: uvAttr.getX(idx), y: uvAttr.getY(idx), z: 0 };
  }
  // Sample color if available
  const colorAttr = geo.getAttribute('color');
  if (colorAttr && idx < colorAttr.count) {
    result.color = {
      r: colorAttr.getX(idx),
      g: colorAttr.getY(idx),
      b: colorAttr.getZ(idx),
      a: colorAttr.itemSize > 3 ? colorAttr.getW(idx) : 1,
    };
  }
  geo.dispose();
  return result;
}

/**
 * Compute mesh topology analysis (edge angles, face areas, neighbor counts).
 * Returns aggregate (average) values.
 */
export function computeMeshAnalysis(geoData) {
  if (!geoData) return null;
  const item = Array.isArray(geoData) ? geoData[0] : geoData;
  if (!item) return null;
  const geo = buildGeometry(item);
  if (!geo) return null;
  const posAttr = geo.getAttribute('position');
  if (!posAttr) { geo.dispose(); return null; }

  const result = {
    vertexCount: posAttr.count,
    faceCount: 0, edgeCount: 0,
    avgFaceArea: 1.0,
    avgEdgeAngle: Math.PI,
    avgEdgeNeighborFaces: 2,
    avgVertexNeighborVerts: 4, avgVertexNeighborFaces: 4,
    avgFaceNeighborFaces: 3,
  };

  if (!geo.index) {
    result.faceCount = Math.floor(posAttr.count / 3);
    result.edgeCount = result.faceCount * 3;
    let totalArea = 0;
    for (let f = 0; f < result.faceCount; f++) {
      const ai = f * 3, bi = f * 3 + 1, ci = f * 3 + 2;
      const abx = posAttr.getX(bi) - posAttr.getX(ai), aby = posAttr.getY(bi) - posAttr.getY(ai), abz = posAttr.getZ(bi) - posAttr.getZ(ai);
      const acx = posAttr.getX(ci) - posAttr.getX(ai), acy = posAttr.getY(ci) - posAttr.getY(ai), acz = posAttr.getZ(ci) - posAttr.getZ(ai);
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      totalArea += Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
    }
    result.avgFaceArea = result.faceCount > 0 ? totalArea / result.faceCount : 1.0;
    geo.dispose();
    return result;
  }

  const idxCount = geo.index.count;
  const triCount = Math.floor(idxCount / 3);
  result.faceCount = triCount;

  // Compute per-face normals and areas
  let totalArea = 0;
  const faceNormals = [];
  for (let f = 0; f < triCount; f++) {
    const a = geo.index.getX(f * 3), b = geo.index.getX(f * 3 + 1), c = geo.index.getX(f * 3 + 2);
    const abx = posAttr.getX(b) - posAttr.getX(a), aby = posAttr.getY(b) - posAttr.getY(a), abz = posAttr.getZ(b) - posAttr.getZ(a);
    const acx = posAttr.getX(c) - posAttr.getX(a), acy = posAttr.getY(c) - posAttr.getY(a), acz = posAttr.getZ(c) - posAttr.getZ(a);
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    totalArea += len * 0.5;
    faceNormals.push(len > 0 ? { x: nx / len, y: ny / len, z: nz / len } : { x: 0, y: 1, z: 0 });
  }
  result.avgFaceArea = triCount > 0 ? totalArea / triCount : 1.0;

  // Build edge map: edge → [face indices]
  const edgeMap = new Map();
  for (let f = 0; f < triCount; f++) {
    const a = geo.index.getX(f * 3), b = geo.index.getX(f * 3 + 1), c = geo.index.getX(f * 3 + 2);
    for (const [v0, v1] of [[a, b], [b, c], [a, c]]) {
      const key = Math.min(v0, v1) + ',' + Math.max(v0, v1);
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(f);
    }
  }
  result.edgeCount = edgeMap.size;

  // Average edge dihedral angle
  let totalAngle = 0, angleCount = 0;
  let totalEdgeFaces = 0;
  for (const faces of edgeMap.values()) {
    totalEdgeFaces += faces.length;
    if (faces.length === 2) {
      const n1 = faceNormals[faces[0]], n2 = faceNormals[faces[1]];
      const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
      totalAngle += Math.acos(Math.max(-1, Math.min(1, dot)));
      angleCount++;
    }
  }
  result.avgEdgeAngle = angleCount > 0 ? totalAngle / angleCount : Math.PI;
  result.avgEdgeNeighborFaces = edgeMap.size > 0 ? totalEdgeFaces / edgeMap.size : 2;

  // Vertex neighbor counts
  const vertNeighborVerts = new Map();
  const vertNeighborFaces = new Map();
  for (let f = 0; f < triCount; f++) {
    const a = geo.index.getX(f * 3), b = geo.index.getX(f * 3 + 1), c = geo.index.getX(f * 3 + 2);
    for (const v of [a, b, c]) {
      if (!vertNeighborFaces.has(v)) vertNeighborFaces.set(v, new Set());
      vertNeighborFaces.get(v).add(f);
      if (!vertNeighborVerts.has(v)) vertNeighborVerts.set(v, new Set());
    }
    vertNeighborVerts.get(a).add(b); vertNeighborVerts.get(a).add(c);
    vertNeighborVerts.get(b).add(a); vertNeighborVerts.get(b).add(c);
    vertNeighborVerts.get(c).add(a); vertNeighborVerts.get(c).add(b);
  }
  let tvn = 0, tvf = 0;
  for (const s of vertNeighborVerts.values()) tvn += s.size;
  for (const s of vertNeighborFaces.values()) tvf += s.size;
  const vc = vertNeighborVerts.size || 1;
  result.avgVertexNeighborVerts = Math.round(tvn / vc);
  result.avgVertexNeighborFaces = Math.round(tvf / vc);

  // Face adjacency (faces sharing an edge)
  const faceAdj = new Map();
  for (const faces of edgeMap.values()) {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        if (!faceAdj.has(faces[i])) faceAdj.set(faces[i], new Set());
        if (!faceAdj.has(faces[j])) faceAdj.set(faces[j], new Set());
        faceAdj.get(faces[i]).add(faces[j]);
        faceAdj.get(faces[j]).add(faces[i]);
      }
    }
  }
  let tfn = 0;
  for (const s of faceAdj.values()) tfn += s.size;
  result.avgFaceNeighborFaces = faceAdj.size > 0 ? Math.round(tfn / faceAdj.size) : 0;

  geo.dispose();
  return result;
}

/**
 * Compute mesh topology analysis returning per-element arrays (Fields-compatible).
 * Unlike computeMeshAnalysis which returns averages, this returns typed arrays
 * indexed by element index for use with the Field system.
 */
export function computeMeshAnalysisField(geoData) {
  if (!geoData) return null;
  const item = Array.isArray(geoData) ? geoData[0] : geoData;
  if (!item) return null;
  const geo = buildGeometry(item);
  if (!geo) return null;
  const posAttr = geo.getAttribute('position');
  if (!posAttr) { geo.dispose(); return null; }

  const vertexCount = posAttr.count;

  // Non-indexed geometry: simpler path
  if (!geo.index) {
    const faceCount = Math.floor(posAttr.count / 3);
    const edgeCount = faceCount * 3; // non-unique edges for non-indexed

    const faceAreas = new Float32Array(faceCount);
    const faceVertexCounts = new Int32Array(faceCount);
    const faceNeighborFaces = new Int32Array(faceCount);

    for (let f = 0; f < faceCount; f++) {
      const ai = f * 3, bi = f * 3 + 1, ci = f * 3 + 2;
      const abx = posAttr.getX(bi) - posAttr.getX(ai), aby = posAttr.getY(bi) - posAttr.getY(ai), abz = posAttr.getZ(bi) - posAttr.getZ(ai);
      const acx = posAttr.getX(ci) - posAttr.getX(ai), acy = posAttr.getY(ci) - posAttr.getY(ai), acz = posAttr.getZ(ci) - posAttr.getZ(ai);
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      faceAreas[f] = Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
      faceVertexCounts[f] = 3;
      faceNeighborFaces[f] = 0; // no adjacency info for non-indexed
    }

    // For non-indexed geometry, edges/vertices have no shared topology
    const edgeAngles = new Float32Array(edgeCount).fill(Math.PI);
    const signedEdgeAngles = new Float32Array(edgeCount).fill(Math.PI);
    const edgeNeighborFaces = new Int32Array(edgeCount).fill(1);
    const vertexNeighborVerts = new Int32Array(vertexCount).fill(0);
    const vertexNeighborFaces = new Int32Array(vertexCount).fill(0);

    geo.dispose();
    return {
      edgeAngles, signedEdgeAngles, edgeNeighborFaces, edgeCount,
      faceAreas, faceVertexCounts, faceNeighborFaces, faceCount,
      vertexNeighborVerts, vertexNeighborFaces, vertexCount,
    };
  }

  // Indexed geometry
  const idxCount = geo.index.count;
  const triCount = Math.floor(idxCount / 3);

  // Per-face data
  const faceAreas = new Float32Array(triCount);
  const faceVertexCounts = new Int32Array(triCount);
  const faceNormals = [];

  for (let f = 0; f < triCount; f++) {
    const a = geo.index.getX(f * 3), b = geo.index.getX(f * 3 + 1), c = geo.index.getX(f * 3 + 2);
    const abx = posAttr.getX(b) - posAttr.getX(a), aby = posAttr.getY(b) - posAttr.getY(a), abz = posAttr.getZ(b) - posAttr.getZ(a);
    const acx = posAttr.getX(c) - posAttr.getX(a), acy = posAttr.getY(c) - posAttr.getY(a), acz = posAttr.getZ(c) - posAttr.getZ(a);
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    faceAreas[f] = len * 0.5;
    faceVertexCounts[f] = 3;
    faceNormals.push(len > 0 ? { x: nx / len, y: ny / len, z: nz / len } : { x: 0, y: 1, z: 0 });
  }

  // Build edge map: edge → [face indices]
  const edgeMap = new Map();
  for (let f = 0; f < triCount; f++) {
    const a = geo.index.getX(f * 3), b = geo.index.getX(f * 3 + 1), c = geo.index.getX(f * 3 + 2);
    for (const [v0, v1] of [[a, b], [b, c], [a, c]]) {
      const key = Math.min(v0, v1) + ',' + Math.max(v0, v1);
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(f);
    }
  }
  const edgeCount = edgeMap.size;

  // Per-edge data
  const edgeAngles = new Float32Array(edgeCount);
  const signedEdgeAngles = new Float32Array(edgeCount);
  const edgeNeighborFaces = new Int32Array(edgeCount);

  let edgeIdx = 0;
  for (const faces of edgeMap.values()) {
    edgeNeighborFaces[edgeIdx] = faces.length;
    if (faces.length === 2) {
      const n1 = faceNormals[faces[0]], n2 = faceNormals[faces[1]];
      const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      edgeAngles[edgeIdx] = angle;
      signedEdgeAngles[edgeIdx] = angle; // signed = unsigned for now
    } else {
      edgeAngles[edgeIdx] = Math.PI;
      signedEdgeAngles[edgeIdx] = Math.PI;
    }
    edgeIdx++;
  }

  // Vertex neighbor counts
  const vertNeighborVertsMap = new Map();
  const vertNeighborFacesMap = new Map();
  for (let f = 0; f < triCount; f++) {
    const a = geo.index.getX(f * 3), b = geo.index.getX(f * 3 + 1), c = geo.index.getX(f * 3 + 2);
    for (const v of [a, b, c]) {
      if (!vertNeighborFacesMap.has(v)) vertNeighborFacesMap.set(v, new Set());
      vertNeighborFacesMap.get(v).add(f);
      if (!vertNeighborVertsMap.has(v)) vertNeighborVertsMap.set(v, new Set());
    }
    vertNeighborVertsMap.get(a).add(b); vertNeighborVertsMap.get(a).add(c);
    vertNeighborVertsMap.get(b).add(a); vertNeighborVertsMap.get(b).add(c);
    vertNeighborVertsMap.get(c).add(a); vertNeighborVertsMap.get(c).add(b);
  }

  const vertexNeighborVerts = new Int32Array(vertexCount);
  const vertexNeighborFaces = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const vs = vertNeighborVertsMap.get(v);
    const fs = vertNeighborFacesMap.get(v);
    vertexNeighborVerts[v] = vs ? vs.size : 0;
    vertexNeighborFaces[v] = fs ? fs.size : 0;
  }

  // Face adjacency (faces sharing an edge)
  const faceAdjMap = new Map();
  for (const faces of edgeMap.values()) {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        if (!faceAdjMap.has(faces[i])) faceAdjMap.set(faces[i], new Set());
        if (!faceAdjMap.has(faces[j])) faceAdjMap.set(faces[j], new Set());
        faceAdjMap.get(faces[i]).add(faces[j]);
        faceAdjMap.get(faces[j]).add(faces[i]);
      }
    }
  }

  const faceNeighborFaces = new Int32Array(triCount);
  for (let f = 0; f < triCount; f++) {
    const adj = faceAdjMap.get(f);
    faceNeighborFaces[f] = adj ? adj.size : 0;
  }

  geo.dispose();
  return {
    edgeAngles, signedEdgeAngles, edgeNeighborFaces, edgeCount,
    faceAreas, faceVertexCounts, faceNeighborFaces, faceCount: triCount,
    vertexNeighborVerts, vertexNeighborFaces, vertexCount,
  };
}

/**
 * Build a complete Three.js mesh (geometry + material + transforms) from geo data.
 * Returns { mesh, verts, faces } or null.
 *
 * @param {object} geoData - Geometry descriptor produced by the node evaluator.
 * @param {boolean} [wireframeMode=false] - Whether to render in wireframe mode.
 * @returns {{ mesh: THREE.Object3D, verts: number, faces: number }|null}
 */
export function buildMesh(geoData, wireframeMode = false) {
  let geometry = buildGeometry(geoData);
  if (!geometry) return null;

  const isWireframeOnly = geoData.wireframeOnly;
  const isPoints = geoData.type === 'points' && !geoData.pointsToVertices;
  const isCurve = (geoData.type === 'curve_circle' || geoData.type === 'curve_line' || geoData.type === 'spiral' || geoData.type === 'curve_arc' || geoData.type === 'curve_star' || geoData.meshToCurve) && !geoData.pointsToVertices;
  const isUnfilledCircle = geoData.type === 'mesh_circle' && geoData.fillType === 'none';

  // Apply flipFaces
  if (geoData.flipFaces && geometry.index) {
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    geometry.index.needsUpdate = true;
  }

  let mesh;

  if (isPoints) {
    const pointsMaterial = new THREE.PointsMaterial({
      color: 0x69f0ae,
      size: 0.08,
      sizeAttenuation: true,
    });
    mesh = new THREE.Points(geometry, pointsMaterial);
  } else if (isCurve || isUnfilledCircle) {
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffab40, linewidth: 2 });
    mesh = new THREE.LineLoop(geometry, lineMaterial);
  } else {
    const mat = geoData.material;
    const material = new THREE.MeshStandardMaterial({
      color: mat?.color || (isWireframeOnly ? 0x4fc3f7 : 0x6688cc),
      metalness: mat?.metallic ?? 0.1,
      roughness: mat?.roughness ?? 0.6,
      flatShading: !geoData.smooth,
      wireframe: wireframeMode || isWireframeOnly,
      side: THREE.DoubleSide,
      transparent: isWireframeOnly,
      opacity: isWireframeOnly ? 0.4 : 1,
    });
    mesh = new THREE.Mesh(geometry, material);
  }

  // Apply transforms
  if (geoData.transforms) {
    for (const t of geoData.transforms) {
      if (t.translate) {
        mesh.position.x += t.translate.x || 0;
        mesh.position.y += t.translate.y || 0;
        mesh.position.z += t.translate.z || 0;
      }
      if (t.rotate) {
        mesh.rotation.x += t.rotate.x || 0;
        mesh.rotation.y += t.rotate.y || 0;
        mesh.rotation.z += t.rotate.z || 0;
      }
      if (t.scale) {
        mesh.scale.x *= t.scale.x || 1;
        mesh.scale.y *= t.scale.y || 1;
        mesh.scale.z *= t.scale.z || 1;
      }
    }
  }

  // Apply set position as translation (simplified)
  if (geoData.setPosition) {
    const off = geoData.setPosition.offset;
    if (off) {
      mesh.position.x += off.x || 0;
      mesh.position.y += off.y || 0;
      mesh.position.z += off.z || 0;
    }
  }

  const verts = geometry.getAttribute('position')?.count || 0;
  const indexCount = geometry.index ? geometry.index.count : verts;
  const faces = Math.floor(indexCount / 3);

  return { mesh, verts, faces };
}
