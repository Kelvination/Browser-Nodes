/**
 * core/registry.js - Shared node type registry for all graph types.
 *
 * Both geometry and shader graphs register their node types here.
 * Each node type has: label, category, inputs, outputs, defaults, props,
 * and an `evaluate` function (so logic lives with the definition).
 */

export const SocketType = {
  GEOMETRY: 'geometry',
  FLOAT: 'float',
  INT: 'int',
  VECTOR: 'vector',
  BOOL: 'bool',
  COLOR: 'color',
  SHADER: 'shader',
};

export const SocketColors = {
  geometry: '#69f0ae',
  float: '#90a4ae',
  int: '#4fc3f7',
  vector: '#7c4dff',
  bool: '#ffab40',
  color: '#ffd54f',
  shader: '#4caf50',
};

/**
 * NodeRegistry holds all node types keyed by graph type ('geo' or 'shader').
 * Categories are also per-graph.
 */
class NodeRegistry {
  constructor() {
    this._types = {};       // { graphType: { nodeTypeId: definition } }
    this._categories = {};  // { graphType: { catId: { name, color, icon } } }
  }

  /**
   * Register a category for a graph type.
   */
  addCategory(graphType, catId, def) {
    if (!this._categories[graphType]) this._categories[graphType] = {};
    this._categories[graphType][catId] = def;
  }

  /**
   * Register a node type. `def` must include:
   *   label, category, inputs[], outputs[], defaults, evaluate(values, inputs)
   * Optional: props[], singular
   */
  addNode(graphType, typeId, def) {
    if (!this._types[graphType]) this._types[graphType] = {};
    this._types[graphType][typeId] = def;
  }

  /**
   * Register many nodes at once from an object { typeId: def, ... }
   */
  addNodes(graphType, defs) {
    for (const [typeId, def] of Object.entries(defs)) {
      this.addNode(graphType, typeId, def);
    }
  }

  /**
   * Get a single node type definition.
   */
  getNodeDef(graphType, typeId) {
    return this._types[graphType]?.[typeId] || null;
  }

  /**
   * Get all node types for a graph type.
   */
  getNodeTypes(graphType) {
    return this._types[graphType] || {};
  }

  /**
   * Get all categories for a graph type.
   */
  getCategories(graphType) {
    return this._categories[graphType] || {};
  }
}

// Singleton
export const registry = new NodeRegistry();
