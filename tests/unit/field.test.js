/**
 * Unit tests for core/field.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Field,
  isField,
  resolveField,
  resolveScalar,
  positionField,
  normalField,
  indexField,
  mapField,
  combineFields,
  combineFields3,
  constantField,
  separateXYZ,
  combineXYZ,
} from '../../core/field.js';

// Test element contexts
const elements = [
  { position: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 1, z: 0 }, index: 0, count: 3 },
  { position: { x: 4, y: 5, z: 6 }, normal: { x: 0, y: 0, z: 1 }, index: 1, count: 3 },
  { position: { x: 7, y: 8, z: 9 }, normal: { x: 1, y: 0, z: 0 }, index: 2, count: 3 },
];

describe('Field', () => {
  it('should construct with type and function', () => {
    const f = new Field('float', () => 42);
    assert.equal(f.isField, true);
    assert.equal(f.type, 'float');
  });

  it('should evaluate at a single element', () => {
    const f = new Field('float', (el) => el.index * 10);
    assert.equal(f.evaluateAt(elements[0]), 0);
    assert.equal(f.evaluateAt(elements[1]), 10);
    assert.equal(f.evaluateAt(elements[2]), 20);
  });

  it('should evaluate all elements', () => {
    const f = new Field('float', (el) => el.index);
    const results = f.evaluateAll(elements);
    assert.deepEqual(results, [0, 1, 2]);
  });
});

describe('isField', () => {
  it('should return true for Field instances', () => {
    assert.equal(isField(new Field('float', () => 0)), true);
  });

  it('should return false for non-fields', () => {
    assert.equal(isField(42), false);
    assert.equal(isField(null), false);
    assert.equal(isField(undefined), false);
    assert.equal(isField({ x: 1 }), false);
    assert.equal(isField('string'), false);
  });
});

describe('resolveField', () => {
  it('should evaluate a field for all elements', () => {
    const f = new Field('float', (el) => el.index + 1);
    const results = resolveField(f, elements);
    assert.deepEqual(results, [1, 2, 3]);
  });

  it('should repeat a scalar for all elements', () => {
    const results = resolveField(5, elements);
    assert.deepEqual(results, [5, 5, 5]);
  });

  it('should clone objects for all elements', () => {
    const vec = { x: 1, y: 2, z: 3 };
    const results = resolveField(vec, elements);
    assert.equal(results.length, 3);
    assert.deepEqual(results[0], { x: 1, y: 2, z: 3 });
    // Ensure they're cloned, not the same reference
    assert.notEqual(results[0], results[1]);
  });
});

describe('resolveScalar', () => {
  it('should return scalar values directly', () => {
    assert.equal(resolveScalar(42), 42);
  });

  it('should evaluate a field at default element', () => {
    const f = new Field('float', (el) => el.index + 100);
    assert.equal(resolveScalar(f), 100); // index=0 at default
  });

  it('should return fallback for null/undefined', () => {
    assert.equal(resolveScalar(null, 99), 99);
    assert.equal(resolveScalar(undefined, 99), 99);
  });
});

describe('Built-in field constructors', () => {
  it('positionField should return element positions', () => {
    const f = positionField();
    assert.equal(f.type, 'vector');
    const result = f.evaluateAt(elements[1]);
    assert.deepEqual(result, { x: 4, y: 5, z: 6 });
  });

  it('normalField should return element normals', () => {
    const f = normalField();
    assert.equal(f.type, 'vector');
    const result = f.evaluateAt(elements[2]);
    assert.deepEqual(result, { x: 1, y: 0, z: 0 });
  });

  it('indexField should return element indices', () => {
    const f = indexField();
    assert.equal(f.type, 'int');
    assert.equal(f.evaluateAt(elements[0]), 0);
    assert.equal(f.evaluateAt(elements[2]), 2);
  });
});

describe('mapField', () => {
  it('should map a field through a function', () => {
    const f = new Field('float', (el) => el.index);
    const mapped = mapField(f, 'float', (v) => v * 2);
    assert.equal(isField(mapped), true);
    assert.equal(mapped.evaluateAt(elements[2]), 4);
  });

  it('should apply function directly to scalars', () => {
    const result = mapField(5, 'float', (v) => v * 2);
    assert.equal(result, 10);
  });
});

describe('combineFields', () => {
  it('should combine two fields', () => {
    const a = new Field('float', (el) => el.index);
    const b = new Field('float', (el) => el.index * 10);
    const combined = combineFields(a, b, 'float', (va, vb) => va + vb);
    assert.equal(isField(combined), true);
    assert.equal(combined.evaluateAt(elements[2]), 22); // 2 + 20
  });

  it('should combine field + scalar', () => {
    const a = new Field('float', (el) => el.index);
    const combined = combineFields(a, 100, 'float', (va, vb) => va + vb);
    assert.equal(isField(combined), true);
    assert.equal(combined.evaluateAt(elements[1]), 101);
  });

  it('should return scalar for two scalars', () => {
    const result = combineFields(3, 4, 'float', (a, b) => a + b);
    assert.equal(result, 7);
  });
});

describe('combineFields3', () => {
  it('should combine three fields', () => {
    const a = new Field('float', () => 1);
    const b = new Field('float', () => 2);
    const c = new Field('float', () => 3);
    const combined = combineFields3(a, b, c, 'float', (x, y, z) => x + y + z);
    assert.equal(isField(combined), true);
    assert.equal(combined.evaluateAt(elements[0]), 6);
  });

  it('should return scalar when no fields involved', () => {
    const result = combineFields3(1, 2, 3, 'float', (a, b, c) => a + b + c);
    assert.equal(result, 6);
  });
});

describe('constantField', () => {
  it('should return the same value for all elements', () => {
    const f = constantField(42, 'float');
    assert.equal(f.evaluateAt(elements[0]), 42);
    assert.equal(f.evaluateAt(elements[2]), 42);
  });
});

describe('separateXYZ', () => {
  it('should separate a vector field into 3 float fields', () => {
    const vecField = positionField();
    const { x, y, z } = separateXYZ(vecField);
    assert.equal(isField(x), true);
    assert.equal(isField(y), true);
    assert.equal(isField(z), true);
    assert.equal(x.evaluateAt(elements[0]), 1);
    assert.equal(y.evaluateAt(elements[0]), 2);
    assert.equal(z.evaluateAt(elements[0]), 3);
  });

  it('should separate a plain vector into scalars', () => {
    const { x, y, z } = separateXYZ({ x: 10, y: 20, z: 30 });
    assert.equal(x, 10);
    assert.equal(y, 20);
    assert.equal(z, 30);
  });

  it('should handle null input', () => {
    const { x, y, z } = separateXYZ(null);
    assert.equal(x, 0);
    assert.equal(y, 0);
    assert.equal(z, 0);
  });
});

describe('combineXYZ', () => {
  it('should combine 3 scalars into a vector', () => {
    const result = combineXYZ(1, 2, 3);
    assert.deepEqual(result, { x: 1, y: 2, z: 3 });
  });

  it('should return a field if any input is a field', () => {
    const xField = new Field('float', (el) => el.index);
    const result = combineXYZ(xField, 5, 10);
    assert.equal(isField(result), true);
    const vec = result.evaluateAt(elements[1]);
    assert.deepEqual(vec, { x: 1, y: 5, z: 10 });
  });
});
