/**
 * Unit tests for core/registry.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SocketType, SocketColors } from '../../core/registry.js';

// Create a fresh registry for each test (avoid singleton state pollution)
class NodeRegistry {
  constructor() {
    this._types = {};
    this._categories = {};
  }
  addCategory(graphType, catId, def) {
    if (!this._categories[graphType]) this._categories[graphType] = {};
    this._categories[graphType][catId] = def;
  }
  addNode(graphType, typeId, def) {
    if (!this._types[graphType]) this._types[graphType] = {};
    this._types[graphType][typeId] = def;
  }
  addNodes(graphType, defs) {
    for (const [typeId, def] of Object.entries(defs)) {
      this.addNode(graphType, typeId, def);
    }
  }
  getNodeDef(graphType, typeId) {
    return this._types[graphType]?.[typeId] || null;
  }
  getNodeTypes(graphType) {
    return this._types[graphType] || {};
  }
  getCategories(graphType) {
    return this._categories[graphType] || {};
  }
}

describe('SocketType constants', () => {
  it('should define all expected socket types', () => {
    assert.equal(SocketType.GEOMETRY, 'geometry');
    assert.equal(SocketType.FLOAT, 'float');
    assert.equal(SocketType.INT, 'int');
    assert.equal(SocketType.VECTOR, 'vector');
    assert.equal(SocketType.BOOL, 'bool');
    assert.equal(SocketType.COLOR, 'color');
    assert.equal(SocketType.SHADER, 'shader');
  });
});

describe('SocketColors', () => {
  it('should have a color for each socket type', () => {
    for (const type of Object.values(SocketType)) {
      assert.ok(SocketColors[type], `Missing color for socket type: ${type}`);
      assert.match(SocketColors[type], /^#[0-9a-fA-F]{6}$/, `Invalid color format for ${type}`);
    }
  });
});

describe('NodeRegistry', () => {
  it('should register and retrieve categories', () => {
    const reg = new NodeRegistry();
    reg.addCategory('geo', 'MESH', { name: 'Mesh', color: '#ff0000', icon: 'M' });

    const cats = reg.getCategories('geo');
    assert.deepEqual(cats.MESH, { name: 'Mesh', color: '#ff0000', icon: 'M' });
  });

  it('should return empty object for unknown graph type categories', () => {
    const reg = new NodeRegistry();
    assert.deepEqual(reg.getCategories('unknown'), {});
  });

  it('should register and retrieve a single node', () => {
    const reg = new NodeRegistry();
    const nodeDef = {
      label: 'Test Node',
      category: 'TEST',
      inputs: [],
      outputs: [],
      defaults: {},
      evaluate: () => ({ outputs: [] }),
    };
    reg.addNode('geo', 'test_node', nodeDef);

    const retrieved = reg.getNodeDef('geo', 'test_node');
    assert.equal(retrieved.label, 'Test Node');
    assert.equal(retrieved.category, 'TEST');
  });

  it('should return null for unknown node type', () => {
    const reg = new NodeRegistry();
    assert.equal(reg.getNodeDef('geo', 'nonexistent'), null);
  });

  it('should register multiple nodes at once via addNodes', () => {
    const reg = new NodeRegistry();
    reg.addNodes('geo', {
      node_a: { label: 'Node A', category: 'TEST' },
      node_b: { label: 'Node B', category: 'TEST' },
    });

    assert.equal(reg.getNodeDef('geo', 'node_a').label, 'Node A');
    assert.equal(reg.getNodeDef('geo', 'node_b').label, 'Node B');
  });

  it('should keep graph types separate', () => {
    const reg = new NodeRegistry();
    reg.addNode('geo', 'shared_id', { label: 'Geo Version' });
    reg.addNode('shader', 'shared_id', { label: 'Shader Version' });

    assert.equal(reg.getNodeDef('geo', 'shared_id').label, 'Geo Version');
    assert.equal(reg.getNodeDef('shader', 'shared_id').label, 'Shader Version');
  });

  it('should list all node types for a graph type', () => {
    const reg = new NodeRegistry();
    reg.addNode('geo', 'a', { label: 'A' });
    reg.addNode('geo', 'b', { label: 'B' });

    const types = reg.getNodeTypes('geo');
    assert.equal(Object.keys(types).length, 2);
    assert.ok(types.a);
    assert.ok(types.b);
  });

  it('should return empty object for unknown graph type nodes', () => {
    const reg = new NodeRegistry();
    assert.deepEqual(reg.getNodeTypes('unknown'), {});
  });

  it('should overwrite existing node with same id', () => {
    const reg = new NodeRegistry();
    reg.addNode('geo', 'x', { label: 'Original' });
    reg.addNode('geo', 'x', { label: 'Replaced' });

    assert.equal(reg.getNodeDef('geo', 'x').label, 'Replaced');
  });
});
