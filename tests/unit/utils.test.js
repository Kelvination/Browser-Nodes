/**
 * Unit tests for core/utils.js - Shared vector math and noise utilities.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  vecAdd, vecSub, vecScale, vecDot, vecCross,
  vecLength, vecNormalize, vecDistance, vecReflect,
  vecProject, vecFaceforward, ensureVec,
  seededRandom, hash3, lerp, smoothstep, clampVal,
  perlinNoise3D, fbmNoise3D, voronoi3D,
} from '../../core/utils.js';

describe('Vector Math', () => {
  it('vecAdd should add component-wise', () => {
    const r = vecAdd({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 });
    assert.deepEqual(r, { x: 5, y: 7, z: 9 });
  });

  it('vecSub should subtract component-wise', () => {
    const r = vecSub({ x: 5, y: 7, z: 9 }, { x: 4, y: 5, z: 6 });
    assert.deepEqual(r, { x: 1, y: 2, z: 3 });
  });

  it('vecScale should scale all components', () => {
    const r = vecScale({ x: 1, y: 2, z: 3 }, 2);
    assert.deepEqual(r, { x: 2, y: 4, z: 6 });
  });

  it('vecDot should compute dot product', () => {
    assert.equal(vecDot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), 0);
    assert.equal(vecDot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }), 32);
  });

  it('vecCross should compute cross product', () => {
    const r = vecCross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    assert.deepEqual(r, { x: 0, y: 0, z: 1 });
  });

  it('vecLength should compute magnitude', () => {
    assert.equal(vecLength({ x: 3, y: 4, z: 0 }), 5);
    assert.equal(vecLength({ x: 0, y: 0, z: 0 }), 0);
  });

  it('vecNormalize should return unit vector', () => {
    const r = vecNormalize({ x: 3, y: 0, z: 0 });
    assert.ok(Math.abs(r.x - 1) < 1e-10);
    assert.ok(Math.abs(r.y) < 1e-10);
    assert.ok(Math.abs(r.z) < 1e-10);
  });

  it('vecNormalize should handle zero vector', () => {
    const r = vecNormalize({ x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(vecLength(r)) < 1e-10 || Math.abs(vecLength(r) - 1) < 1e-10);
  });

  it('vecDistance should compute Euclidean distance', () => {
    const d = vecDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
    assert.equal(d, 5);
  });

  it('vecReflect should reflect vector around normal', () => {
    const r = vecReflect({ x: 1, y: -1, z: 0 }, { x: 0, y: 1, z: 0 });
    assert.ok(Math.abs(r.x - 1) < 1e-10);
    assert.ok(Math.abs(r.y - 1) < 1e-10);
  });

  it('vecProject should project a onto b', () => {
    const r = vecProject({ x: 3, y: 4, z: 0 }, { x: 1, y: 0, z: 0 });
    assert.ok(Math.abs(r.x - 3) < 1e-10);
    assert.ok(Math.abs(r.y) < 1e-10);
  });

  it('vecProject should handle zero vector', () => {
    const r = vecProject({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 });
    assert.deepEqual(r, { x: 0, y: 0, z: 0 });
  });

  it('vecFaceforward should flip if facing away', () => {
    const r = vecFaceforward(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    );
    // dot(reference, incident) >= 0, so vector is negated
    assert.equal(r.y, -1);
  });

  it('ensureVec should pass through valid vectors', () => {
    const v = { x: 1, y: 2, z: 3 };
    assert.equal(ensureVec(v), v);
  });

  it('ensureVec should return zero for non-vectors', () => {
    assert.deepEqual(ensureVec(null), { x: 0, y: 0, z: 0 });
    assert.deepEqual(ensureVec(5), { x: 0, y: 0, z: 0 });
    assert.deepEqual(ensureVec(undefined), { x: 0, y: 0, z: 0 });
  });
});

describe('Scalar Math', () => {
  it('lerp should interpolate linearly', () => {
    assert.equal(lerp(0, 10, 0.5), 5);
    assert.equal(lerp(0, 10, 0), 0);
    assert.equal(lerp(0, 10, 1), 10);
  });

  it('smoothstep should be 0 at 0 and 1 at 1', () => {
    assert.equal(smoothstep(0), 0);
    assert.equal(smoothstep(1), 1);
    assert.ok(smoothstep(0.5) > 0.4 && smoothstep(0.5) < 0.6);
  });

  it('clampVal should clamp to range', () => {
    assert.equal(clampVal(5, 0, 10), 5);
    assert.equal(clampVal(-1, 0, 10), 0);
    assert.equal(clampVal(15, 0, 10), 10);
  });
});

describe('PRNG', () => {
  it('seededRandom should return values in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = seededRandom(i);
      assert.ok(v >= 0 && v < 1, `Out of range: ${v}`);
    }
  });

  it('seededRandom should be deterministic', () => {
    assert.equal(seededRandom(42), seededRandom(42));
  });

  it('hash3 should return values in [0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const v = hash3(i, i + 1, i + 2);
      assert.ok(v >= 0 && v < 1, `Out of range: ${v}`);
    }
  });
});

describe('Noise Functions', () => {
  it('perlinNoise3D should return values in roughly [-1, 1]', () => {
    for (let i = 0; i < 50; i++) {
      const v = perlinNoise3D(i * 0.1, i * 0.2, i * 0.3);
      assert.ok(v >= -1.5 && v <= 1.5, `Perlin out of range: ${v}`);
    }
  });

  it('fbmNoise3D should return finite values', () => {
    const v = fbmNoise3D(1.5, 2.5, 3.5, 4, 0.5, 2);
    assert.ok(Number.isFinite(v));
  });

  it('voronoi3D should return distance and color', () => {
    const r = voronoi3D(0.5, 0.5, 0.5, 1.0, 'f1', 'euclidean', 1.0);
    assert.ok(Number.isFinite(r.dist));
    assert.ok(r.col && Number.isFinite(r.col.x));
    assert.ok(r.position && Number.isFinite(r.position.x));
  });

  it('voronoi3D features should produce different results', () => {
    const f1 = voronoi3D(0.5, 0.5, 0.5, 1.0, 'f1', 'euclidean', 1.0);
    const f2 = voronoi3D(0.5, 0.5, 0.5, 1.0, 'f2', 'euclidean', 1.0);
    assert.ok(f1.dist !== f2.dist || f1.dist === 0);
  });
});
