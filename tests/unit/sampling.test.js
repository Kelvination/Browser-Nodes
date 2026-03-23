/**
 * Unit tests for sampling nodes:
 * geometry_proximity, sample_index, sample_nearest
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry, SocketType } from '../../core/registry.js';
import { GeometrySet, MeshComponent, DOMAIN } from '../../core/geometry.js';
import { createMeshGrid, createMeshCube } from '../../core/geometry.js';
import { Field } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';
import { registerSamplingNodes } from '../../geo/nodes_v2_sampling.js';

before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerFieldNodes(registry);
  registerSamplingNodes(registry);
});

function makeCubeGeo() {
  const geo = new GeometrySet();
  geo.mesh = createMeshCube(2, 2, 2, 2, 2, 2);
  return geo;
}

function makeGridGeo() {
  const geo = new GeometrySet();
  geo.mesh = createMeshGrid(2, 2, 3, 3);
  return geo;
}

// ── Geometry Proximity ───────────────────────────────────────────────────

describe('Geometry Proximity', () => {
  it('should register geometry_proximity', () => {
    const def = registry.getNodeDef('geo', 'geometry_proximity');
    assert.ok(def);
    assert.equal(def.label, 'Geometry Proximity');
  });

  it('should return field outputs', () => {
    const def = registry.getNodeDef('geo', 'geometry_proximity');
    const target = makeCubeGeo();

    const result = def.evaluate(
      { target_element: 'POINTS' },
      { 'Target': target, 'Source Position': null }
    );

    assert.ok(result.outputs[0] instanceof Field, 'Position should be a Field');
    assert.ok(result.outputs[1] instanceof Field, 'Distance should be a Field');
  });

  it('should find nearest point on target', () => {
    const def = registry.getNodeDef('geo', 'geometry_proximity');
    const target = makeGridGeo(); // grid centered at origin in XY plane

    const result = def.evaluate(
      { target_element: 'POINTS' },
      { 'Target': target, 'Source Position': null }
    );

    // Query from a point above the grid center
    const el = { position: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 1, z: 0 }, index: 0, count: 1 };
    const closestPos = result.outputs[0].evaluateAt(el);
    const dist = result.outputs[1].evaluateAt(el);

    // Closest grid vertex should be near (0, 0, 0)
    assert.ok(Math.abs(closestPos.x) < 0.5, 'closest x should be near 0');
    assert.ok(Math.abs(closestPos.y) < 0.5, 'closest y should be near 0');
    assert.ok(Math.abs(closestPos.z) < 0.01, 'closest z should be 0 (grid is in XY plane)');
    assert.ok(Math.abs(dist - 5) < 0.5, 'distance should be approximately 5');
  });

  it('should handle empty target', () => {
    const def = registry.getNodeDef('geo', 'geometry_proximity');
    const result = def.evaluate(
      { target_element: 'POINTS' },
      { 'Target': null, 'Source Position': null }
    );
    assert.ok(result.outputs[0] instanceof Field);
    assert.ok(result.outputs[1] instanceof Field);
  });
});

// ── Sample Index ─────────────────────────────────────────────────────────

describe('Sample Index', () => {
  it('should register sample_index', () => {
    const def = registry.getNodeDef('geo', 'sample_index');
    assert.ok(def);
    assert.equal(def.label, 'Sample Index');
  });

  it('should have dynamic inputs based on data_type', () => {
    const def = registry.getNodeDef('geo', 'sample_index');
    const floatInputs = def.getInputs({ data_type: 'FLOAT' });
    assert.equal(floatInputs[1].type, SocketType.FLOAT);

    const vecInputs = def.getInputs({ data_type: 'FLOAT_VECTOR' });
    assert.equal(vecInputs[1].type, SocketType.VECTOR);
  });

  it('should sample float values at index', () => {
    const def = registry.getNodeDef('geo', 'sample_index');
    const geo = makeGridGeo();

    // Create a field that returns position.x
    const valueField = new Field('float', (el) => el.position.x);

    const result = def.evaluate(
      { data_type: 'FLOAT', domain: 'POINT', clamp: false },
      { 'Geometry': geo, 'Value': valueField, 'Index': 0 }
    );

    assert.ok(result.outputs[0] instanceof Field, 'should return a Field');

    // Evaluate the result field
    const el = { position: { x: 999, y: 0, z: 0 }, index: 5, count: 10 };
    const sampled = result.outputs[0].evaluateAt(el);
    assert.ok(typeof sampled === 'number', 'sampled value should be a number');
  });

  it('should clamp index when enabled', () => {
    const def = registry.getNodeDef('geo', 'sample_index');
    const geo = makeGridGeo();
    const valueField = new Field('float', (el) => el.index * 10);

    const result = def.evaluate(
      { data_type: 'FLOAT', domain: 'POINT', clamp: true },
      { 'Geometry': geo, 'Value': valueField, 'Index': 999 }
    );

    const el = { position: { x: 0, y: 0, z: 0 }, index: 0, count: 1 };
    const sampled = result.outputs[0].evaluateAt(el);
    // Should be clamped to last index
    const lastIdx = geo.mesh.vertexCount - 1;
    assert.equal(sampled, lastIdx * 10);
  });

  it('should return default for out-of-bounds without clamp', () => {
    const def = registry.getNodeDef('geo', 'sample_index');
    const geo = makeGridGeo();
    const valueField = new Field('float', (el) => el.index * 10);

    const result = def.evaluate(
      { data_type: 'FLOAT', domain: 'POINT', clamp: false },
      { 'Geometry': geo, 'Value': valueField, 'Index': 999 }
    );

    const el = { position: { x: 0, y: 0, z: 0 }, index: 0, count: 1 };
    const sampled = result.outputs[0].evaluateAt(el);
    assert.equal(sampled, 0, 'out-of-bounds should return default (0)');
  });
});

// ── Sample Nearest ───────────────────────────────────────────────────────

describe('Sample Nearest', () => {
  it('should register sample_nearest', () => {
    const def = registry.getNodeDef('geo', 'sample_nearest');
    assert.ok(def);
    assert.equal(def.label, 'Sample Nearest');
  });

  it('should find nearest point index', () => {
    const def = registry.getNodeDef('geo', 'sample_nearest');

    // Create simple geometry with 3 known points
    const geo = new GeometrySet();
    geo.mesh = new MeshComponent();
    geo.mesh.positions = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
    ];

    const result = def.evaluate(
      { domain: 'POINT' },
      { 'Geometry': geo, 'Sample Position': null }
    );

    assert.ok(result.outputs[0] instanceof Field, 'should return a Field');

    // Query from near vertex 1
    const el = { position: { x: 9, y: 0, z: 0 }, index: 0, count: 1 };
    const nearestIdx = result.outputs[0].evaluateAt(el);
    assert.equal(nearestIdx, 1, 'should find vertex 1 as nearest');

    // Query from near vertex 2
    const el2 = { position: { x: 1, y: 9, z: 0 }, index: 0, count: 1 };
    const nearestIdx2 = result.outputs[0].evaluateAt(el2);
    assert.equal(nearestIdx2, 2, 'should find vertex 2 as nearest');
  });

  it('should handle empty geometry', () => {
    const def = registry.getNodeDef('geo', 'sample_nearest');
    const result = def.evaluate(
      { domain: 'POINT' },
      { 'Geometry': null, 'Sample Position': null }
    );
    assert.ok(result.outputs[0] instanceof Field);
  });
});
