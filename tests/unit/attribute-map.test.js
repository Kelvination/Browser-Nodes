/**
 * Unit tests for AttributeMap in core/geometry.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MeshComponent, ATTR_TYPE } from '../../core/geometry.js';

describe('AttributeMap', () => {
  it('should store and retrieve attributes', () => {
    const mesh = new MeshComponent();
    mesh.positions.push({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    mesh.pointAttrs.set('weight', ATTR_TYPE.FLOAT, [0.5, 1.0]);

    assert.ok(mesh.pointAttrs.has('weight'));
    const data = mesh.pointAttrs.get('weight');
    assert.deepEqual(data, [0.5, 1.0]);
  });

  it('should return null for missing attributes', () => {
    const mesh = new MeshComponent();
    assert.equal(mesh.pointAttrs.get('nonexistent'), null);
    assert.equal(mesh.pointAttrs.has('nonexistent'), false);
  });

  it('should remove attributes', () => {
    const mesh = new MeshComponent();
    mesh.pointAttrs.set('temp', ATTR_TYPE.FLOAT, [1, 2, 3]);
    mesh.pointAttrs.remove('temp');
    assert.equal(mesh.pointAttrs.has('temp'), false);
  });

  it('should list attribute names', () => {
    const mesh = new MeshComponent();
    mesh.pointAttrs.set('a', ATTR_TYPE.FLOAT, [1]);
    mesh.pointAttrs.set('b', ATTR_TYPE.INT, [2]);
    const names = mesh.pointAttrs.names();
    assert.ok(names.includes('a'));
    assert.ok(names.includes('b'));
    assert.equal(names.length, 2);
  });

  it('should deep clone via clone()', () => {
    const mesh = new MeshComponent();
    mesh.pointAttrs.set('pos', ATTR_TYPE.FLOAT_VECTOR, [{ x: 1, y: 2, z: 3 }]);

    const clone = mesh.pointAttrs.clone();
    clone.get('pos')[0].x = 999;
    assert.equal(mesh.pointAttrs.get('pos')[0].x, 1);
  });

  it('should resize attributes to target count', () => {
    const mesh = new MeshComponent();
    mesh.pointAttrs.set('weight', ATTR_TYPE.FLOAT, [1, 2]);

    mesh.pointAttrs.resize(4);
    const data = mesh.pointAttrs.get('weight');
    assert.equal(data.length, 4);
    assert.equal(data[2], 0); // default for FLOAT
    assert.equal(data[3], 0);
  });

  it('should truncate on resize to smaller count', () => {
    const mesh = new MeshComponent();
    mesh.pointAttrs.set('weight', ATTR_TYPE.FLOAT, [1, 2, 3, 4]);

    mesh.pointAttrs.resize(2);
    assert.equal(mesh.pointAttrs.get('weight').length, 2);
  });

  it('should append another AttributeMap', () => {
    const mesh1 = new MeshComponent();
    mesh1.pointAttrs.set('w', ATTR_TYPE.FLOAT, [1, 2]);

    const mesh2 = new MeshComponent();
    mesh2.pointAttrs.set('w', ATTR_TYPE.FLOAT, [3, 4]);

    mesh1.pointAttrs.append(mesh2.pointAttrs);
    assert.deepEqual(mesh1.pointAttrs.get('w'), [1, 2, 3, 4]);
  });

  it('should filter by indices', () => {
    const mesh = new MeshComponent();
    mesh.pointAttrs.set('val', ATTR_TYPE.FLOAT, [10, 20, 30, 40, 50]);

    mesh.pointAttrs.filter([0, 2, 4]);
    assert.deepEqual(mesh.pointAttrs.get('val'), [10, 30, 50]);
  });

  it('should report correct size', () => {
    const mesh = new MeshComponent();
    assert.equal(mesh.pointAttrs.size, 0);

    mesh.pointAttrs.set('x', ATTR_TYPE.FLOAT, [1, 2, 3]);
    assert.equal(mesh.pointAttrs.size, 3);
  });

  it('getWithType should return type info', () => {
    const mesh = new MeshComponent();
    mesh.pointAttrs.set('color', ATTR_TYPE.FLOAT_COLOR, [{ r: 1, g: 0, b: 0, a: 1 }]);

    const attr = mesh.pointAttrs.getWithType('color');
    assert.ok(attr);
    assert.equal(attr.type, ATTR_TYPE.FLOAT_COLOR);
    assert.equal(attr.data.length, 1);
  });
});

describe('MeshComponent corner offset caching', () => {
  it('getFaceVertices should use cached offsets', () => {
    const mesh = new MeshComponent();
    mesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
    ];
    mesh.faceVertCounts = [3, 3];
    mesh.cornerVerts = [0, 1, 2, 2, 3, 4];

    const face0 = mesh.getFaceVertices(0);
    assert.deepEqual(face0, [0, 1, 2]);

    const face1 = mesh.getFaceVertices(1);
    assert.deepEqual(face1, [2, 3, 4]);

    // Second call should use cache
    const face0Again = mesh.getFaceVertices(0);
    assert.deepEqual(face0Again, [0, 1, 2]);
  });

  it('getFaceCornerStart should return correct offsets', () => {
    const mesh = new MeshComponent();
    mesh.faceVertCounts = [3, 4, 3];
    mesh.cornerVerts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    assert.equal(mesh.getFaceCornerStart(0), 0);
    assert.equal(mesh.getFaceCornerStart(1), 3);
    assert.equal(mesh.getFaceCornerStart(2), 7);
  });

  it('invalidateCornerOffsets should force recalculation', () => {
    const mesh = new MeshComponent();
    mesh.faceVertCounts = [3];
    mesh.cornerVerts = [0, 1, 2];

    mesh.getFaceVertices(0); // builds cache

    mesh.faceVertCounts = [4];
    mesh.cornerVerts = [0, 1, 2, 3];
    mesh.invalidateCornerOffsets();

    const verts = mesh.getFaceVertices(0);
    assert.deepEqual(verts, [0, 1, 2, 3]);
  });
});

describe('AttributeMap.append() padding', () => {
  it('should pad new attribute with defaults for existing elements', () => {
    const map1 = new MeshComponent();
    map1.positions = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
    map1.pointAttrs.set('weight', ATTR_TYPE.FLOAT, [1.0, 2.0]);

    const map2 = new MeshComponent();
    map2.positions = [{ x: 2, y: 0, z: 0 }];
    map2.pointAttrs.set('weight', ATTR_TYPE.FLOAT, [3.0]);
    map2.pointAttrs.set('color', ATTR_TYPE.FLOAT_VECTOR, [{ x: 1, y: 0, z: 0 }]);

    map1.pointAttrs.append(map2.pointAttrs);

    // 'weight' should be [1, 2, 3]
    assert.deepEqual(map1.pointAttrs.get('weight'), [1.0, 2.0, 3.0]);

    // 'color' should be [{default}, {default}, {1,0,0}] - padded for existing 2 elements
    const colors = map1.pointAttrs.get('color');
    assert.equal(colors.length, 3);
    assert.deepEqual(colors[0], { x: 0, y: 0, z: 0 }); // default
    assert.deepEqual(colors[1], { x: 0, y: 0, z: 0 }); // default
    assert.deepEqual(colors[2], { x: 1, y: 0, z: 0 }); // actual value
  });

  it('should pad existing attributes missing from other', () => {
    const map1 = new MeshComponent();
    map1.positions = [{ x: 0, y: 0, z: 0 }];
    map1.pointAttrs.set('weight', ATTR_TYPE.FLOAT, [1.0]);
    map1.pointAttrs.set('extra', ATTR_TYPE.INT, [42]);

    const map2 = new MeshComponent();
    map2.positions = [{ x: 1, y: 0, z: 0 }];
    map2.pointAttrs.set('weight', ATTR_TYPE.FLOAT, [2.0]);
    // 'extra' not in map2

    map1.pointAttrs.append(map2.pointAttrs);

    // 'weight' should be [1, 2]
    assert.deepEqual(map1.pointAttrs.get('weight'), [1.0, 2.0]);

    // 'extra' should be [42, 0] - padded with default for INT
    const extra = map1.pointAttrs.get('extra');
    assert.equal(extra.length, 2);
    assert.equal(extra[0], 42);
    assert.equal(extra[1], 0); // default for INT
  });

  it('should handle both sides having unique attributes', () => {
    const map1 = new MeshComponent();
    map1.positions = [{ x: 0, y: 0, z: 0 }];
    map1.pointAttrs.set('a', ATTR_TYPE.FLOAT, [1.0]);

    const map2 = new MeshComponent();
    map2.positions = [{ x: 1, y: 0, z: 0 }];
    map2.pointAttrs.set('b', ATTR_TYPE.FLOAT, [2.0]);

    map1.pointAttrs.append(map2.pointAttrs);

    // 'a' should be [1, 0] - padded for other
    assert.deepEqual(map1.pointAttrs.get('a'), [1.0, 0]);

    // 'b' should be [0, 2] - padded for existing
    assert.deepEqual(map1.pointAttrs.get('b'), [0, 2.0]);
  });
});
