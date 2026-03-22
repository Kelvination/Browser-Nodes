/**
 * Unit tests for core/graph.js
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../../core/registry.js';
import { NodeGraph } from '../../core/graph.js';

// Register minimal test node types
function ensureTestNodesRegistered() {
  if (!registry.getNodeDef('test', 'test_output')) {
    registry.addNode('test', 'test_output', {
      label: 'Output',
      category: 'OUTPUT',
      inputs: [{ name: 'Value', type: 'float' }],
      outputs: [],
      defaults: {},
      singular: true,
      evaluate(values, inputs) {
        return { outputs: [], value: inputs['Value'] ?? 0 };
      },
    });
  }
  if (!registry.getNodeDef('test', 'test_add')) {
    registry.addNode('test', 'test_add', {
      label: 'Add',
      category: 'MATH',
      inputs: [
        { name: 'A', type: 'float' },
        { name: 'B', type: 'float' },
      ],
      outputs: [{ name: 'Result', type: 'float' }],
      defaults: { a: 0, b: 0 },
      evaluate(values, inputs) {
        const a = inputs['A'] ?? values.a;
        const b = inputs['B'] ?? values.b;
        return { outputs: [a + b] };
      },
    });
  }
  if (!registry.getNodeDef('test', 'test_value')) {
    registry.addNode('test', 'test_value', {
      label: 'Value',
      category: 'INPUT',
      inputs: [],
      outputs: [{ name: 'Value', type: 'float' }],
      defaults: { value: 0 },
      evaluate(values) {
        return { outputs: [values.value] };
      },
    });
  }
}

describe('NodeGraph', () => {
  beforeEach(() => {
    ensureTestNodesRegistered();
  });

  describe('typesCompatible', () => {
    it('should allow same-type connections', () => {
      assert.ok(NodeGraph.typesCompatible('float', 'float'));
      assert.ok(NodeGraph.typesCompatible('int', 'int'));
    });

    it('should allow numeric coercions', () => {
      assert.ok(NodeGraph.typesCompatible('float', 'int'));
      assert.ok(NodeGraph.typesCompatible('int', 'float'));
      assert.ok(NodeGraph.typesCompatible('bool', 'float'));
      assert.ok(NodeGraph.typesCompatible('float', 'bool'));
    });

    it('should reject incompatible types', () => {
      assert.ok(!NodeGraph.typesCompatible('geometry', 'float'));
      assert.ok(!NodeGraph.typesCompatible('vector', 'float'));
      assert.ok(!NodeGraph.typesCompatible('shader', 'float'));
    });
  });

  describe('Node management', () => {
    it('should add nodes', () => {
      const graph = new NodeGraph('test');
      const node = graph.addNode('test_value', 100, 200);
      assert.ok(node);
      assert.equal(node.type, 'test_value');
      assert.equal(node.x, 100);
      assert.equal(node.y, 200);
      assert.equal(graph.nodes.length, 1);
    });

    it('should return null for unknown node type', () => {
      const graph = new NodeGraph('test');
      const node = graph.addNode('nonexistent', 0, 0);
      assert.equal(node, null);
    });

    it('should enforce singular constraint', () => {
      const graph = new NodeGraph('test');
      const first = graph.addNode('test_output', 0, 0);
      const second = graph.addNode('test_output', 100, 100);
      assert.ok(first);
      assert.equal(second, first); // returns existing
      assert.equal(graph.nodes.length, 1);
    });

    it('should remove nodes and their connections', () => {
      const graph = new NodeGraph('test');
      const n1 = graph.addNode('test_value', 0, 0);
      const n2 = graph.addNode('test_add', 200, 0);
      graph.addConnection(n1.id, 0, n2.id, 0);

      graph.removeNode(n1.id);
      assert.equal(graph.nodes.length, 1);
      assert.equal(graph.connections.length, 0);
    });

    it('should move nodes', () => {
      const graph = new NodeGraph('test');
      const node = graph.addNode('test_value', 0, 0);
      graph.moveNode(node.id, 50, 75);
      assert.equal(node.x, 50);
      assert.equal(node.y, 75);
    });
  });

  describe('Connections', () => {
    it('should add valid connections', () => {
      const graph = new NodeGraph('test');
      const n1 = graph.addNode('test_value', 0, 0);
      const n2 = graph.addNode('test_add', 200, 0);
      const ok = graph.addConnection(n1.id, 0, n2.id, 0);
      assert.ok(ok);
      assert.equal(graph.connections.length, 1);
    });

    it('should prevent self-connections', () => {
      const graph = new NodeGraph('test');
      const n1 = graph.addNode('test_add', 0, 0);
      const ok = graph.addConnection(n1.id, 0, n1.id, 1);
      assert.ok(!ok);
    });

    it('should replace existing input connections', () => {
      const graph = new NodeGraph('test');
      const n1 = graph.addNode('test_value', 0, 0);
      const n2 = graph.addNode('test_value', 0, 100);
      const n3 = graph.addNode('test_add', 200, 0);

      graph.addConnection(n1.id, 0, n3.id, 0);
      graph.addConnection(n2.id, 0, n3.id, 0); // same input socket
      assert.equal(graph.connections.length, 1);
      assert.equal(graph.connections[0].fromNode, n2.id);
    });

    it('should remove specific connections', () => {
      const graph = new NodeGraph('test');
      const n1 = graph.addNode('test_value', 0, 0);
      const n2 = graph.addNode('test_add', 200, 0);
      graph.addConnection(n1.id, 0, n2.id, 0);

      graph.removeConnection(n1.id, 0, n2.id, 0);
      assert.equal(graph.connections.length, 0);
    });

    it('should find input connections', () => {
      const graph = new NodeGraph('test');
      const n1 = graph.addNode('test_value', 0, 0);
      const n2 = graph.addNode('test_add', 200, 0);
      graph.addConnection(n1.id, 0, n2.id, 0);

      const conn = graph.getInputConnection(n2.id, 0);
      assert.ok(conn);
      assert.equal(conn.fromNode, n1.id);
    });
  });

  describe('Undo', () => {
    it('should undo node additions', () => {
      const graph = new NodeGraph('test');
      graph.addNode('test_value', 0, 0);
      assert.equal(graph.nodes.length, 1);

      const ok = graph.undo();
      assert.ok(ok);
      assert.equal(graph.nodes.length, 0);
    });

    it('should return false when nothing to undo', () => {
      const graph = new NodeGraph('test');
      assert.ok(!graph.undo());
    });
  });

  describe('Values', () => {
    it('should set node values', () => {
      const graph = new NodeGraph('test');
      const node = graph.addNode('test_value', 0, 0);
      graph.setNodeValue(node.id, 'value', 42);
      assert.equal(node.values.value, 42);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize', () => {
      const graph = new NodeGraph('test');
      const n1 = graph.addNode('test_value', 10, 20);
      graph.setNodeValue(n1.id, 'value', 5);

      const json = graph.toJSON();
      const graph2 = new NodeGraph('test');
      const ok = graph2.fromJSON(json);
      assert.ok(ok);
      assert.equal(graph2.nodes.length, 1);
      assert.equal(graph2.nodes[0].values.value, 5);
    });

    it('should handle invalid JSON gracefully', () => {
      const graph = new NodeGraph('test');
      assert.ok(!graph.fromJSON('not json'));
    });
  });
});
