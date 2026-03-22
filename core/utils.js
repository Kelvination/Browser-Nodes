/**
 * core/utils.js - Shared math utilities (noise, PRNG, interpolation, vector ops).
 */

// ── Vector Math ──────────────────────────────────────────────────────────────
// Shared 3D vector operations used across geometry node modules.

export function vecAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vecSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vecScale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vecDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vecCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vecLength(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vecNormalize(v) {
  const len = vecLength(v) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function vecDistance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function vecReflect(v, n) {
  const d = 2 * vecDot(v, n);
  return { x: v.x - d * n.x, y: v.y - d * n.y, z: v.z - d * n.z };
}

export function vecProject(a, b) {
  const bLenSq = vecDot(b, b);
  if (bLenSq === 0) return { x: 0, y: 0, z: 0 };
  const s = vecDot(a, b) / bLenSq;
  return { x: b.x * s, y: b.y * s, z: b.z * s };
}

export function vecFaceforward(v, incident, reference) {
  return vecDot(reference, incident) < 0 ? v : { x: -v.x, y: -v.y, z: -v.z };
}

export function ensureVec(v) {
  if (v && typeof v === 'object' && 'x' in v) return v;
  return { x: 0, y: 0, z: 0 };
}

// ── Scalar Math ──────────────────────────────────────────────────────────────

// Seeded PRNG (mulberry32)
export function seededRandom(seed) {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 3D hash
export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(t) { return t * t * (3 - 2 * t); }
export function clampVal(v, mn, mx) { return Math.min(Math.max(v, mn), mx); }

export function valueNoise3D(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smoothstep(x - ix), fy = smoothstep(y - iy), fz = smoothstep(z - iz);
  return lerp(
    lerp(
      lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx),
      lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    lerp(
      lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx),
      lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}

// Gradient table for Perlin noise
const _gradients3D = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
  [1,1,0],[0,-1,1],[-1,1,0],[0,-1,-1],
];

function _perlinFade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

function _gradDot3(hash, x, y, z) {
  const g = _gradients3D[hash & 15];
  return g[0] * x + g[1] * y + g[2] * z;
}

// Permutation table for Perlin noise
const _perm = new Uint8Array(512);
(function() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher-Yates shuffle with fixed seed
  let s = 42;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) _perm[i] = p[i & 255];
})();

/** Perlin gradient noise, returns value in roughly [-1, 1] range */
export function perlinNoise3D(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = _perlinFade(fx), v = _perlinFade(fy), w = _perlinFade(fz);
  const X = ix & 255, Y = iy & 255, Z = iz & 255;
  const A  = _perm[X] + Y,     AA = _perm[A] + Z,   AB = _perm[A + 1] + Z;
  const B  = _perm[X + 1] + Y, BA = _perm[B] + Z,   BB = _perm[B + 1] + Z;
  return lerp(
    lerp(
      lerp(_gradDot3(_perm[AA],     fx,   fy,   fz),
           _gradDot3(_perm[BA],     fx-1, fy,   fz), u),
      lerp(_gradDot3(_perm[AB],     fx,   fy-1, fz),
           _gradDot3(_perm[BB],     fx-1, fy-1, fz), u), v),
    lerp(
      lerp(_gradDot3(_perm[AA + 1], fx,   fy,   fz-1),
           _gradDot3(_perm[BA + 1], fx-1, fy,   fz-1), u),
      lerp(_gradDot3(_perm[AB + 1], fx,   fy-1, fz-1),
           _gradDot3(_perm[BB + 1], fx-1, fy-1, fz-1), u), v), w);
}

export function fbmNoise3D(x, y, z, octaves, roughness, lacunarity) {
  const lac = lacunarity || 2;
  let val = 0, amp = 1, freq = 1, maxVal = 0;
  for (let i = 0; i < octaves; i++) {
    val += perlinNoise3D(x * freq, y * freq, z * freq) * amp;
    maxVal += amp;
    amp *= roughness;
    freq *= lac;
  }
  return val / maxVal;
}

// Distance metric helpers for Voronoi
function _voronoiDist(dx, dy, dz, metric, exponent) {
  switch (metric) {
    case 'manhattan': return Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    case 'chebychev': return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    case 'minkowski': {
      const e = exponent || 0.5;
      return Math.pow(Math.pow(Math.abs(dx), e) + Math.pow(Math.abs(dy), e) + Math.pow(Math.abs(dz), e), 1 / e);
    }
    default: return Math.sqrt(dx * dx + dy * dy + dz * dz); // euclidean
  }
}

// Voronoi helper (used by both geo and shader texture nodes)
export function voronoi3D(sx, sy, sz, randomness, feature, metric, smoothness, exponent) {
  const ix = Math.floor(sx), iy = Math.floor(sy), iz = Math.floor(sz);
  let minDist = 999, minDist2 = 999;
  let closestPt = { x: 0, y: 0, z: 0 };
  let closestCell = { x: 0, y: 0, z: 0 };
  let secondPt = { x: 0, y: 0, z: 0 };

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
        const px = cx + hash3(cx, cy, cz) * randomness;
        const py = cy + hash3(cx + 73, cy + 157, cz + 31) * randomness;
        const pz = cz + hash3(cx + 139, cy + 29, cz + 97) * randomness;
        const ddx = sx - px, ddy = sy - py, ddz = sz - pz;
        const d = _voronoiDist(ddx, ddy, ddz, metric, exponent);
        if (d < minDist) {
          minDist2 = minDist;
          secondPt = { ...closestPt };
          minDist = d;
          closestPt = { x: px, y: py, z: pz };
          closestCell = { x: cx, y: cy, z: cz };
        } else if (d < minDist2) {
          minDist2 = d;
          secondPt = { x: px, y: py, z: pz };
        }
      }
    }
  }

  let dist;
  switch (feature) {
    case 'f1': dist = minDist; break;
    case 'f2': dist = minDist2; break;
    case 'smooth_f1': {
      // Smooth minimum of F1 and F2
      const s = smoothness ?? 1;
      if (s <= 0) {
        dist = minDist;
      } else {
        const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (minDist2 - minDist) / (s + 0.0001)));
        dist = lerp(minDist2, minDist, h) - s * h * (1 - h);
      }
      break;
    }
    case 'distance_to_edge': {
      // Distance to the edge between the two closest cells
      const midX = (closestPt.x + secondPt.x) * 0.5;
      const midY = (closestPt.y + secondPt.y) * 0.5;
      const midZ = (closestPt.z + secondPt.z) * 0.5;
      const edgeDirX = secondPt.x - closestPt.x;
      const edgeDirY = secondPt.y - closestPt.y;
      const edgeDirZ = secondPt.z - closestPt.z;
      const edgeLen = Math.sqrt(edgeDirX * edgeDirX + edgeDirY * edgeDirY + edgeDirZ * edgeDirZ) || 1;
      dist = Math.abs((sx - midX) * edgeDirX + (sy - midY) * edgeDirY + (sz - midZ) * edgeDirZ) / edgeLen;
      break;
    }
    case 'n_sphere_radius': dist = minDist2 > 0 ? minDist / minDist2 * 0.5 : 0; break;
    default: dist = minDist;
  }

  const col = {
    x: hash3(Math.floor(closestPt.x * 100), Math.floor(closestPt.y * 100), 0),
    y: hash3(Math.floor(closestPt.x * 100), 0, Math.floor(closestPt.z * 100)),
    z: hash3(0, Math.floor(closestPt.y * 100), Math.floor(closestPt.z * 100)),
  };
  return { dist, col, position: closestPt };
}
