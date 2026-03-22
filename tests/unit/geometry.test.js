/**
 * Unit tests for core/geometry.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN,
  ATTR_TYPE,
  MeshComponent,
  CurveComponent,
  InstancesComponent,
  GeometrySet,
  createMeshGrid,
  createMeshCube,
  createMeshCylinder,
  createMeshUVSphere,
  createMeshIcoSphere,
  createMeshCone,
  createMeshTorus,
  createCurveLine,
  createCurveCircle,
  applyTransform,
  rotateEulerXYZ,
} from '../../core/geometry.js';

describe('DOMAIN constants', () => {
  it('should define all Blender domains', () => {
    assert.equal(DOMAIN.POINT, 'POINT');
    assert.equal(DOMAIN.EDGE, 'EDGE');
    assert.equal(DOMAIN.FACE, 'FACE');
    assert.equal(DOMAIN.CORNER, 'CORNER');
    assert.equal(DOMAIN.CURVE_POINT, 'CURVE_POINT');
    assert.equal(DOMAIN.SPLINE, 'SPLINE');
    assert.equal(DOMAIN.INSTANCE, 'INSTANCE');
  });
});

describe('ATTR_TYPE constants', () => {
  it('should define all attribute types', () => {
    assert.equal(ATTR_TYPE.FLOAT, 'FLOAT');
    assert.equal(ATTR_TYPE.INT, 'INT');
    assert.equal(ATTR_TYPE.BOOL, 'BOOL');
    assert.equal(ATTR_TYPE.FLOAT_VECTOR, 'FLOAT_VECTOR');
    assert.equal(ATTR_TYPE.FLOAT_COLOR, 'FLOAT_COLOR');
    assert.equal(ATTR_TYPE.FLOAT2, 'FLOAT2');
  });
});

describe('MeshComponent', () => {
  it('should initialize with empty arrays', () => {
    const mesh = new MeshComponent();
    assert.equal(mesh.vertexCount, 0);
    assert.equal(mesh.edgeCount, 0);
    assert.equal(mesh.faceCount, 0);
    assert.equal(mesh.cornerCount, 0);
  });

  it('should track vertex count from positions', () => {
    const mesh = new MeshComponent();
    mesh.positions.push({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    assert.equal(mesh.vertexCount, 2);
  });

  it('should deep copy via copy()', () => {
    const mesh = new MeshComponent();
    mesh.positions.push({ x: 1, y: 2, z: 3 });
    mesh.edges.push([0, 1]);
    mesh.faceVertCounts.push(3);
    mesh.cornerVerts.push(0, 1, 2);

    const clone = mesh.copy();
    assert.deepEqual(clone.positions[0], { x: 1, y: 2, z: 3 });
    mesh.positions[0].x = 999;
    assert.equal(clone.positions[0].x, 1);
  });

  it('should build point-domain elements for field evaluation', () => {
    const mesh = new MeshComponent();
    mesh.positions.push(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    );

    const elements = mesh.buildElements(DOMAIN.POINT);
    assert.equal(elements.length, 2);
    assert.deepEqual(elements[0].position, { x: 0, y: 0, z: 0 });
    assert.equal(elements[0].index, 0);
    assert.equal(elements[1].index, 1);
    assert.equal(elements[0].count, 2);
  });
});

describe('CurveComponent', () => {
  it('should initialize with empty splines', () => {
    const curve = new CurveComponent();
    assert.equal(curve.splineCount, 0);
  });

  it('should store splines', () => {
    const curve = new CurveComponent();
    curve.splines.push({
      type: 'POLY',
      cyclic: false,
      positions: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      radii: [1, 1],
      tilts: [0, 0],
    });
    assert.equal(curve.splineCount, 1);
    assert.equal(curve.pointCount, 2);
  });

  it('should deep copy via copy()', () => {
    const curve = new CurveComponent();
    curve.splines.push({
      type: 'POLY',
      cyclic: false,
      positions: [{ x: 0, y: 0, z: 0 }],
      radii: [1],
      tilts: [0],
    });

    const clone = curve.copy();
    assert.equal(clone.splineCount, 1);
    curve.splines[0].positions[0].x = 999;
    assert.equal(clone.splines[0].positions[0].x, 0);
  });
});

describe('InstancesComponent', () => {
  it('should initialize empty', () => {
    const inst = new InstancesComponent();
    assert.equal(inst.instanceCount, 0);
  });

  it('should add instances', () => {
    const inst = new InstancesComponent();
    const geo = new GeometrySet();
    inst.addInstance({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, geo);
    assert.equal(inst.instanceCount, 1);
  });

  it('should deep copy via copy()', () => {
    const inst = new InstancesComponent();
    const geo = new GeometrySet();
    inst.addInstance({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, geo);

    const clone = inst.copy();
    inst.transforms[0].position.x = 999;
    assert.equal(clone.transforms[0].position.x, 1);
  });
});

describe('GeometrySet', () => {
  it('should initialize with null components', () => {
    const gs = new GeometrySet();
    assert.equal(gs.mesh, null);
    assert.equal(gs.curve, null);
    assert.equal(gs.instances, null);
  });

  it('should deep copy all components', () => {
    const gs = new GeometrySet();
    gs.mesh = new MeshComponent();
    gs.mesh.positions.push({ x: 1, y: 2, z: 3 });
    gs.curve = new CurveComponent();
    gs.instances = new InstancesComponent();

    const copy = gs.copy();
    assert.notEqual(copy, gs);
    assert.notEqual(copy.mesh, gs.mesh);
    gs.mesh.positions[0].x = 999;
    assert.equal(copy.mesh.positions[0].x, 1);
  });
});

describe('Mesh Primitive Factories', () => {
  it('createMeshGrid should produce correct vertex count', () => {
    const mesh = createMeshGrid(1, 1, 3, 3);
    assert.equal(mesh.vertexCount, 9);
    assert.ok(mesh.faceCount > 0);
  });

  it('createMeshCube should produce 8+ vertices', () => {
    const mesh = createMeshCube(1, 1, 1, 2, 2, 2);
    assert.ok(mesh.vertexCount >= 8);
    assert.ok(mesh.faceCount > 0);
  });

  it('createMeshCylinder should produce valid mesh', () => {
    const mesh = createMeshCylinder(8, 1, 2, 'NGON');
    assert.ok(mesh.vertexCount > 0);
    assert.ok(mesh.faceCount > 0);
  });

  it('createMeshUVSphere should produce valid mesh', () => {
    const mesh = createMeshUVSphere(8, 4, 1);
    assert.ok(mesh.vertexCount > 0);
    assert.ok(mesh.faceCount > 0);
  });

  it('createMeshIcoSphere should produce 12 vertices at subdivision 0', () => {
    const mesh = createMeshIcoSphere(1, 0);
    assert.equal(mesh.vertexCount, 12);
    assert.equal(mesh.faceCount, 20);
  });

  it('createMeshCone should produce valid mesh', () => {
    const mesh = createMeshCone(8, 0, 1, 2, 'NGON');
    assert.ok(mesh.vertexCount > 0);
    assert.ok(mesh.faceCount > 0);
  });

  it('createMeshTorus should produce valid mesh', () => {
    const mesh = createMeshTorus(12, 6, 1, 0.25);
    assert.equal(mesh.vertexCount, 12 * 6);
    assert.equal(mesh.faceCount, 12 * 6);
  });
});

describe('Curve Primitive Factories', () => {
  it('createCurveLine should produce 2-point spline', () => {
    const curve = createCurveLine({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    assert.equal(curve.splineCount, 1);
    assert.equal(curve.pointCount, 2);
    assert.equal(curve.splines[0].type, 'POLY');
  });

  it('createCurveCircle should produce correct point count', () => {
    const curve = createCurveCircle(16, 1);
    assert.equal(curve.splineCount, 1);
    assert.equal(curve.pointCount, 16);
    assert.equal(curve.splines[0].cyclic, true);
  });
});

describe('Transform utilities', () => {
  it('applyTransform should apply translation', () => {
    const result = applyTransform(
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 2, z: 3 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
    );
    assert.equal(result.x, 1);
    assert.equal(result.y, 2);
    assert.equal(result.z, 3);
  });

  it('applyTransform should apply scale', () => {
    const result = applyTransform(
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 3, z: 4 },
    );
    assert.equal(result.x, 2);
    assert.equal(result.y, 3);
    assert.equal(result.z, 4);
  });

  it('rotateEulerXYZ with zero rotation should be identity', () => {
    const result = rotateEulerXYZ(1, 2, 3, 0, 0, 0);
    assert.ok(Math.abs(result.x - 1) < 1e-10);
    assert.ok(Math.abs(result.y - 2) < 1e-10);
    assert.ok(Math.abs(result.z - 3) < 1e-10);
  });

  it('rotateEulerXYZ 90deg Y should swap x and z', () => {
    const result = rotateEulerXYZ(1, 0, 0, 0, Math.PI / 2, 0);
    assert.ok(Math.abs(result.x - 0) < 1e-10);
    assert.ok(Math.abs(result.y - 0) < 1e-10);
    assert.ok(Math.abs(result.z - (-1)) < 1e-10);
  });
});
