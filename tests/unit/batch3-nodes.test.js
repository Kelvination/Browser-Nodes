/**
 * Unit tests for batch 3 nodes:
 * id, scene_time, named_attribute, store_named_attribute, vector_rotate,
 * curve_tangent, endpoint_selection, subdivide_curve, reverse_curve,
 * points, scale_elements, mesh_line, mesh_circle
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry, SocketType } from '../../core/registry.js';
import {
  GeometrySet, MeshComponent, CurveComponent,
  DOMAIN, createMeshGrid, createMeshCube,
} from '../../core/geometry.js';
import { Field } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';
import { registerCurveNodes } from '../../geo/nodes_v2_curves.js';
import { registerMeshOpNodes } from '../../geo/nodes_v2_mesh_ops.js';
import { registerUtilityNodes } from '../../geo/nodes_v2_utilities.js';
import { registerSamplingNodes } from '../../geo/nodes_v2_sampling.js';
import { registerPointOpNodes } from '../../geo/nodes_v2_point_ops.js';

before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerFieldNodes(registry);
  registerCurveNodes(registry);
  registerMeshOpNodes(registry);
  registerUtilityNodes(registry);
  registerSamplingNodes(registry);
  registerPointOpNodes(registry);
});

function makeGridGeo() {
  const geo = new GeometrySet();
  geo.mesh = createMeshGrid(1, 1, 3, 3);
  return geo;
}

function makeCurveGeo() {
  const geo = new GeometrySet();
  geo.curve = new CurveComponent();
  geo.curve.splines.push({
    type: 'POLY',
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ],
    handleLeft: null, handleRight: null,
    radii: [1, 1, 1, 1], tilts: [0, 0, 0, 0],
    cyclic: false, resolution: 12,
  });
  return geo;
}

// ── Field Input Nodes ────────────────────────────────────────────────────

describe('ID Node', () => {
  it('should register id', () => {
    const def = registry.getNodeDef('geo', 'id');
    assert.ok(def);
    assert.equal(def.label, 'ID');
  });

  it('should return an integer field', () => {
    const def = registry.getNodeDef('geo', 'id');
    const result = def.evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
    assert.equal(result.outputs[0].evaluateAt({ index: 5, count: 10 }), 5);
  });
});

describe('Scene Time', () => {
  it('should register scene_time', () => {
    const def = registry.getNodeDef('geo', 'scene_time');
    assert.ok(def);
    assert.equal(def.label, 'Scene Time');
  });

  it('should return seconds and frame', () => {
    const def = registry.getNodeDef('geo', 'scene_time');
    const result = def.evaluate({}, {});
    assert.equal(typeof result.outputs[0], 'number'); // seconds
    assert.equal(typeof result.outputs[1], 'number'); // frame
  });
});

describe('Named Attribute', () => {
  it('should register named_attribute', () => {
    const def = registry.getNodeDef('geo', 'named_attribute');
    assert.ok(def);
  });

  it('should return Attribute and Exists fields', () => {
    const def = registry.getNodeDef('geo', 'named_attribute');
    const result = def.evaluate({ data_type: 'FLOAT', name: 'test' }, {});
    assert.ok(result.outputs[0] instanceof Field, 'Attribute should be a Field');
    assert.ok(result.outputs[1] instanceof Field, 'Exists should be a Field');
  });
});

describe('Store Named Attribute', () => {
  it('should register store_named_attribute', () => {
    const def = registry.getNodeDef('geo', 'store_named_attribute');
    assert.ok(def);
  });

  it('should pass through geometry', () => {
    const def = registry.getNodeDef('geo', 'store_named_attribute');
    const geo = makeGridGeo();
    const result = def.evaluate(
      { data_type: 'FLOAT', domain: 'POINT', name: 'test' },
      { 'Geometry': geo, 'Selection': null, 'Value': 42 }
    );
    assert.ok(result.outputs[0] instanceof GeometrySet);
    assert.ok(result.outputs[0].mesh.vertexCount > 0);
  });
});

// ── Vector Rotate ────────────────────────────────────────────────────────

describe('Vector Rotate', () => {
  it('should register vector_rotate', () => {
    const def = registry.getNodeDef('geo', 'vector_rotate');
    assert.ok(def);
    assert.equal(def.label, 'Vector Rotate');
  });

  it('should rotate a vector', () => {
    const def = registry.getNodeDef('geo', 'vector_rotate');
    const result = def.evaluate({}, {
      'Vector': { x: 1, y: 0, z: 0 },
      'Rotation': { x: 0, y: 0, z: Math.PI / 2 }, // 90 degrees around Z
    });
    const v = result.outputs[0];
    assert.ok(Math.abs(v.x) < 0.01, `x should be ~0, got ${v.x}`);
    assert.ok(Math.abs(v.y - 1) < 0.01, `y should be ~1, got ${v.y}`);
  });

  it('should return field when inputs are fields', () => {
    const def = registry.getNodeDef('geo', 'vector_rotate');
    const vecField = new Field('vector', () => ({ x: 1, y: 0, z: 0 }));
    const result = def.evaluate({}, {
      'Vector': vecField,
      'Rotation': { x: 0, y: 0, z: 0 },
    });
    assert.ok(result.outputs[0] instanceof Field);
  });
});

// ── Curve Nodes ──────────────────────────────────────────────────────────

describe('Curve Tangent', () => {
  it('should register curve_tangent', () => {
    const def = registry.getNodeDef('geo', 'curve_tangent');
    assert.ok(def);
  });

  it('should return a vector field', () => {
    const def = registry.getNodeDef('geo', 'curve_tangent');
    const result = def.evaluate({}, {});
    assert.ok(result.outputs[0] instanceof Field);
  });
});

describe('Endpoint Selection', () => {
  it('should register endpoint_selection', () => {
    const def = registry.getNodeDef('geo', 'endpoint_selection');
    assert.ok(def);
  });

  it('should select endpoints', () => {
    const def = registry.getNodeDef('geo', 'endpoint_selection');
    const result = def.evaluate(
      { start_size: 1, end_size: 1 },
      { 'Start Size': 1, 'End Size': 1 }
    );
    const sel = result.outputs[0];
    assert.ok(sel instanceof Field);

    // First and last of 5 elements should be selected
    assert.equal(sel.evaluateAt({ index: 0, count: 5, localIndex: 0, localCount: 5 }), true);
    assert.equal(sel.evaluateAt({ index: 2, count: 5, localIndex: 2, localCount: 5 }), false);
    assert.equal(sel.evaluateAt({ index: 4, count: 5, localIndex: 4, localCount: 5 }), true);
  });
});

describe('Subdivide Curve', () => {
  it('should register subdivide_curve', () => {
    const def = registry.getNodeDef('geo', 'subdivide_curve');
    assert.ok(def);
  });

  it('should add points between control points', () => {
    const def = registry.getNodeDef('geo', 'subdivide_curve');
    const geo = makeCurveGeo(); // 4 points, 3 segments
    const origCount = geo.curve.splines[0].positions.length;

    const result = def.evaluate(
      { cuts: 2 },
      { 'Curve': geo, 'Cuts': 2 }
    );

    const newCount = result.outputs[0].curve.splines[0].positions.length;
    // 3 segments × 2 cuts = 6 new points + 4 original = 10 total
    assert.equal(newCount, 10, `should have 10 points, got ${newCount}`);
  });

  it('should pass through at 0 cuts', () => {
    const def = registry.getNodeDef('geo', 'subdivide_curve');
    const geo = makeCurveGeo();
    const result = def.evaluate(
      { cuts: 0 },
      { 'Curve': geo, 'Cuts': 0 }
    );
    assert.equal(result.outputs[0].curve.splines[0].positions.length, 4);
  });
});

describe('Reverse Curve', () => {
  it('should register reverse_curve', () => {
    const def = registry.getNodeDef('geo', 'reverse_curve');
    assert.ok(def);
  });

  it('should reverse control point order', () => {
    const def = registry.getNodeDef('geo', 'reverse_curve');
    const geo = makeCurveGeo();

    const result = def.evaluate({}, { 'Curve': geo, 'Selection': null });
    const pts = result.outputs[0].curve.splines[0].positions;

    // Original: [0,0,0], [1,0,0], [2,0,0], [3,0,0]
    // Reversed: [3,0,0], [2,0,0], [1,0,0], [0,0,0]
    assert.ok(Math.abs(pts[0].x - 3) < 0.01, 'first point should be x=3');
    assert.ok(Math.abs(pts[3].x - 0) < 0.01, 'last point should be x=0');
  });
});

// ── Points Node ──────────────────────────────────────────────────────────

describe('Points Node', () => {
  it('should register points', () => {
    const def = registry.getNodeDef('geo', 'points');
    assert.ok(def);
    assert.equal(def.label, 'Points');
  });

  it('should create N points', () => {
    const def = registry.getNodeDef('geo', 'points');
    const result = def.evaluate(
      { count: 5, radius: 0.1 },
      { 'Count': 5, 'Position': null, 'Radius': null }
    );
    assert.ok(result.outputs[0].mesh);
    assert.equal(result.outputs[0].mesh.vertexCount, 5);
  });

  it('should use position field', () => {
    const def = registry.getNodeDef('geo', 'points');
    const posField = new Field('vector', (el) => ({ x: el.index, y: 0, z: 0 }));
    const result = def.evaluate(
      { count: 3, radius: 0.1 },
      { 'Count': 3, 'Position': posField, 'Radius': null }
    );
    const pts = result.outputs[0].mesh.positions;
    assert.ok(Math.abs(pts[0].x) < 0.01);
    assert.ok(Math.abs(pts[1].x - 1) < 0.01);
    assert.ok(Math.abs(pts[2].x - 2) < 0.01);
  });
});

// ── Scale Elements ───────────────────────────────────────────────────────

describe('Scale Elements', () => {
  it('should register scale_elements', () => {
    const def = registry.getNodeDef('geo', 'scale_elements');
    assert.ok(def);
    assert.equal(def.label, 'Scale Elements');
  });

  it('should scale face elements', () => {
    const def = registry.getNodeDef('geo', 'scale_elements');
    const geo = makeGridGeo();

    // Scale all faces by 0.5
    const result = def.evaluate(
      { domain: 'FACE', scale: 0.5 },
      { 'Geometry': geo, 'Selection': null, 'Scale': 0.5, 'Center': null }
    );

    assert.ok(result.outputs[0].mesh);
    // Vertices should have moved toward face centers
    assert.equal(result.outputs[0].mesh.vertexCount, geo.mesh.vertexCount);
  });

  it('should handle empty geometry', () => {
    const def = registry.getNodeDef('geo', 'scale_elements');
    const result = def.evaluate(
      { domain: 'FACE', scale: 1 },
      { 'Geometry': null, 'Selection': null, 'Scale': 1, 'Center': null }
    );
    assert.ok(result.outputs[0] instanceof GeometrySet);
  });
});
