/**
 * core/field.js - Field evaluation system for geometry nodes.
 *
 * In Blender's geometry nodes, "fields" are lazy per-element data producers.
 * Instead of returning a single scalar/vector, field nodes return a Field object
 * that can be evaluated against geometry to produce one value per element.
 *
 * Example: The Position node returns a Field that, when evaluated on a mesh,
 * returns the position of each vertex. Math nodes propagate fields: if you add
 * a Position field to a constant vector, you get a new field that evaluates to
 * (vertex_position + constant) for each vertex.
 *
 * Field consumers (Set Position, Delete Geometry, etc.) build the geometry,
 * create element contexts, evaluate the field per-element, and apply operations.
 */

/**
 * A Field wraps a per-element evaluation function.
 *
 * @param {string} type - Output type: 'float', 'vector', 'int', 'bool'
 * @param {function} evaluateFn - (element: Element) => value
 *   where Element = { position: {x,y,z}, normal: {x,y,z}, index: number, count: number }
 */
export class Field {
  constructor(type, evaluateFn) {
    this.isField = true;
    this.type = type;
    this._fn = evaluateFn;
  }

  /** Evaluate the field for a single element context. */
  evaluateAt(element) {
    return this._fn(element);
  }

  /** Evaluate the field for all elements, returning an array. */
  evaluateAll(elements) {
    const results = new Array(elements.length);
    for (let i = 0; i < elements.length; i++) {
      results[i] = this._fn(elements[i]);
    }
    return results;
  }
}

/** Check if a value is a Field. */
export function isField(value) {
  return value != null && value.isField === true;
}

/**
 * Resolve a value that might be a Field or a scalar.
 * - If it's a Field, evaluate it for all elements.
 * - If it's a scalar/vector, repeat it for all elements.
 *
 * @param {*} value - Field or scalar
 * @param {Array} elements - Element contexts
 * @returns {Array} One value per element
 */
export function resolveField(value, elements) {
  if (isField(value)) {
    return value.evaluateAll(elements);
  }
  // Scalar/vector: repeat for all elements
  // Clone objects to avoid shared reference mutations
  if (value !== null && typeof value === 'object') {
    return Array.from({ length: elements.length }, () => ({ ...value }));
  }
  return new Array(elements.length).fill(value);
}

/**
 * Resolve a value to a single scalar (for cases where we don't have element context).
 * If it's a Field, evaluate at index 0 with a default element.
 */
export function resolveScalar(value, fallback = 0) {
  if (isField(value)) {
    return value.evaluateAt({ position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, index: 0, count: 1 });
  }
  return value ?? fallback;
}

/**
 * Resolve a boolean field/scalar to a per-element boolean array.
 * Commonly used for Selection inputs on geometry operations.
 *
 * @param {*} value - Field, boolean, or null/undefined
 * @param {Array} elements - Element contexts
 * @returns {boolean[]|null} Per-element booleans, or null if input is null/undefined
 */
export function resolveSelection(value, elements) {
  if (value == null) return null;
  if (isField(value)) return value.evaluateAll(elements);
  return new Array(elements.length).fill(!!value);
}

// ── Built-in Field Constructors ──────────────────────────────────────────────

/** Position field: returns the element's vertex position as {x, y, z}. */
export function positionField() {
  return new Field('vector', (el) => ({
    x: el.position.x,
    y: el.position.y,
    z: el.position.z,
  }));
}

/** Normal field: returns the element's normal as {x, y, z}. */
export function normalField() {
  return new Field('vector', (el) => ({
    x: el.normal.x,
    y: el.normal.y,
    z: el.normal.z,
  }));
}

/** Index field: returns the element's index as an integer. */
export function indexField() {
  return new Field('int', (el) => el.index);
}

// ── Field Composition Helpers ────────────────────────────────────────────────

/**
 * Create a field that applies a unary function to another field's output.
 * If input is not a field, returns fn(input) as a scalar.
 */
export function mapField(input, type, fn) {
  if (isField(input)) {
    return new Field(type, (el) => fn(input.evaluateAt(el)));
  }
  return fn(input);
}

/**
 * Create a field that combines two inputs with a binary function.
 * If neither input is a field, returns fn(a, b) as a scalar.
 * If either is a field, returns a new field.
 */
export function combineFields(a, b, type, fn) {
  const aIsField = isField(a);
  const bIsField = isField(b);

  if (!aIsField && !bIsField) {
    return fn(a, b);
  }

  return new Field(type, (el) => {
    const va = aIsField ? a.evaluateAt(el) : a;
    const vb = bIsField ? b.evaluateAt(el) : b;
    return fn(va, vb);
  });
}

/**
 * Create a field that combines three inputs with a ternary function.
 */
export function combineFields3(a, b, c, type, fn) {
  const af = isField(a), bf = isField(b), cf = isField(c);
  if (!af && !bf && !cf) return fn(a, b, c);

  return new Field(type, (el) => {
    const va = af ? a.evaluateAt(el) : a;
    const vb = bf ? b.evaluateAt(el) : b;
    const vc = cf ? c.evaluateAt(el) : c;
    return fn(va, vb, vc);
  });
}

/**
 * Wrap a scalar/vector as a constant field.
 */
export function constantField(value, type = 'float') {
  return new Field(type, () => value);
}

// ── Vector Field Helpers ─────────────────────────────────────────────────────

/** Separate a vector field into 3 float fields (or scalars). */
export function separateXYZ(vecInput) {
  if (isField(vecInput)) {
    return {
      x: new Field('float', (el) => {
        const v = vecInput.evaluateAt(el);
        return (v && typeof v === 'object') ? (v.x || 0) : 0;
      }),
      y: new Field('float', (el) => {
        const v = vecInput.evaluateAt(el);
        return (v && typeof v === 'object') ? (v.y || 0) : 0;
      }),
      z: new Field('float', (el) => {
        const v = vecInput.evaluateAt(el);
        return (v && typeof v === 'object') ? (v.z || 0) : 0;
      }),
    };
  }
  // Plain vector
  const v = vecInput || { x: 0, y: 0, z: 0 };
  return { x: v.x || 0, y: v.y || 0, z: v.z || 0 };
}

/** Combine 3 float fields/scalars into a vector field (or vector). */
export function combineXYZ(x, y, z) {
  const xf = isField(x), yf = isField(y), zf = isField(z);
  if (!xf && !yf && !zf) {
    return { x: x || 0, y: y || 0, z: z || 0 };
  }
  return new Field('vector', (el) => ({
    x: xf ? x.evaluateAt(el) : (x || 0),
    y: yf ? y.evaluateAt(el) : (y || 0),
    z: zf ? z.evaluateAt(el) : (z || 0),
  }));
}
