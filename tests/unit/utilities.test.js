/**
 * Unit tests for utility and flow control nodes:
 * switch, noise_texture, domain_size
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { registry, SocketType } from '../../core/registry.js';
import { GeometrySet, MeshComponent, DOMAIN } from '../../core/geometry.js';
import { createMeshCube, createMeshGrid } from '../../core/geometry.js';
import { Field } from '../../core/field.js';
import { registerPrimitiveNodes } from '../../geo/nodes_v2_primitives.js';
import { registerOperationNodes } from '../../geo/nodes_v2_operations.js';
import { registerFieldNodes } from '../../geo/nodes_v2_fields.js';
import { registerMeshOpNodes } from '../../geo/nodes_v2_mesh_ops.js';
import { registerUtilityNodes } from '../../geo/nodes_v2_utilities.js';

before(() => {
  registerPrimitiveNodes(registry);
  registerOperationNodes(registry);
  registerFieldNodes(registry);
  registerMeshOpNodes(registry);
  registerUtilityNodes(registry);
});

// ── Switch Node ──────────────────────────────────────────────────────────

describe('Switch Node', () => {
  it('should register switch', () => {
    const def = registry.getNodeDef('geo', 'switch');
    assert.ok(def, 'switch should be registered');
    assert.equal(def.label, 'Switch');
  });

  it('should output False value when Switch is false', () => {
    const def = registry.getNodeDef('geo', 'switch');
    const result = def.evaluate(
      { input_type: 'FLOAT' },
      { 'Switch': false, 'False': 42, 'True': 99 }
    );
    assert.equal(result.outputs[0], 42);
  });

  it('should output True value when Switch is true', () => {
    const def = registry.getNodeDef('geo', 'switch');
    const result = def.evaluate(
      { input_type: 'FLOAT' },
      { 'Switch': true, 'False': 42, 'True': 99 }
    );
    assert.equal(result.outputs[0], 99);
  });

  it('should work with geometry type', () => {
    const def = registry.getNodeDef('geo', 'switch');
    const geo1 = new GeometrySet();
    const geo2 = new GeometrySet();
    geo2.mesh = new MeshComponent();
    geo2.mesh.positions = [{ x: 1, y: 0, z: 0 }];

    const result = def.evaluate(
      { input_type: 'GEOMETRY' },
      { 'Switch': true, 'False': geo1, 'True': geo2 }
    );
    assert.ok(result.outputs[0].mesh);
    assert.equal(result.outputs[0].mesh.vertexCount, 1);
  });

  it('should have dynamic inputs based on type', () => {
    const def = registry.getNodeDef('geo', 'switch');
    const floatInputs = def.getInputs({ input_type: 'FLOAT' });
    assert.equal(floatInputs[1].type, SocketType.FLOAT);

    const vecInputs = def.getInputs({ input_type: 'VECTOR' });
    assert.equal(vecInputs[1].type, SocketType.VECTOR);

    const geoInputs = def.getInputs({ input_type: 'GEOMETRY' });
    assert.equal(geoInputs[1].type, SocketType.GEOMETRY);
  });

  it('should handle field-based switch', () => {
    const def = registry.getNodeDef('geo', 'switch');
    const switchField = new Field('bool', (el) => el.index % 2 === 0);

    const result = def.evaluate(
      { input_type: 'FLOAT' },
      { 'Switch': switchField, 'False': 0, 'True': 1 }
    );

    // Should return a field
    assert.ok(result.outputs[0] instanceof Field, 'should return a Field');
    assert.equal(result.outputs[0].evaluateAt({ index: 0 }), 1, 'even index → true');
    assert.equal(result.outputs[0].evaluateAt({ index: 1 }), 0, 'odd index → false');
  });
});

// ── Noise Texture ────────────────────────────────────────────────────────

describe('Noise Texture', () => {
  it('should register noise_texture', () => {
    const def = registry.getNodeDef('geo', 'noise_texture');
    assert.ok(def);
    assert.equal(def.label, 'Noise Texture');
  });

  it('should produce field outputs when Vector is a field', () => {
    const def = registry.getNodeDef('geo', 'noise_texture');
    const posField = new Field('vector', (el) => el.position);

    const result = def.evaluate(
      { scale: 5, detail: 2, roughness: 0.5, lacunarity: 2, distortion: 0 },
      { 'Vector': posField, 'Scale': 5, 'Detail': 2, 'Roughness': 0.5, 'Lacunarity': 2, 'Distortion': 0 }
    );

    assert.ok(result.outputs[0] instanceof Field, 'Fac should be a Field');
    assert.ok(result.outputs[1] instanceof Field, 'Color should be a Field');

    // Evaluate at a point
    const fac = result.outputs[0].evaluateAt({ position: { x: 1, y: 2, z: 3 }, index: 0, count: 1 });
    assert.ok(typeof fac === 'number', 'Fac should be a number');
    assert.ok(fac >= 0 && fac <= 1, `Fac should be in [0,1], got ${fac}`);
  });

  it('should produce different values at different positions', () => {
    const def = registry.getNodeDef('geo', 'noise_texture');
    const posField = new Field('vector', (el) => el.position);

    const result = def.evaluate(
      { scale: 5, detail: 2, roughness: 0.5, lacunarity: 2, distortion: 0 },
      { 'Vector': posField, 'Scale': 5, 'Detail': 2, 'Roughness': 0.5, 'Lacunarity': 2, 'Distortion': 0 }
    );

    // Use non-integer positions since Perlin noise is 0 at lattice points
    const fac1 = result.outputs[0].evaluateAt({ position: { x: 0.3, y: 0.7, z: 0.1 }, index: 0, count: 1 });
    const fac2 = result.outputs[0].evaluateAt({ position: { x: 5.8, y: 3.2, z: 7.9 }, index: 1, count: 1 });

    // Very unlikely to be exactly equal at different positions
    assert.notEqual(fac1, fac2, 'should produce different values at different positions');
  });

  it('should produce scalar outputs when no field inputs', () => {
    const def = registry.getNodeDef('geo', 'noise_texture');
    const result = def.evaluate(
      { scale: 5, detail: 2, roughness: 0.5, lacunarity: 2, distortion: 0, dimensions: '3D' },
      { 'Vector': { x: 1, y: 2, z: 3 }, 'Scale': null, 'Detail': null, 'Roughness': null, 'Lacunarity': null, 'Distortion': null }
    );

    assert.ok(typeof result.outputs[0] === 'number', 'Fac should be a number');
    assert.ok(result.outputs[1] && typeof result.outputs[1].r === 'number', 'Color should have r component');
  });
});

// ── Domain Size ──────────────────────────────────────────────────────────

describe('Domain Size', () => {
  it('should register domain_size', () => {
    const def = registry.getNodeDef('geo', 'domain_size');
    assert.ok(def);
    assert.equal(def.label, 'Domain Size');
  });

  it('should return correct counts for a cube', () => {
    const def = registry.getNodeDef('geo', 'domain_size');
    const geo = new GeometrySet();
    geo.mesh = createMeshCube(2, 2, 2, 2, 2, 2);

    const result = def.evaluate({}, { 'Geometry': geo });
    const [points, edges, faces, corners, splines, instances] = result.outputs;

    assert.ok(points > 0, 'should have points');
    assert.ok(edges > 0, 'should have edges');
    assert.ok(faces > 0, 'should have faces');
    assert.ok(corners > 0, 'should have corners');
    assert.equal(splines, 0, 'should have no splines');
    assert.equal(instances, 0, 'should have no instances');
  });

  it('should return all zeros for empty geometry', () => {
    const def = registry.getNodeDef('geo', 'domain_size');
    const result = def.evaluate({}, { 'Geometry': null });
    for (const count of result.outputs) {
      assert.equal(count, 0);
    }
  });
});
