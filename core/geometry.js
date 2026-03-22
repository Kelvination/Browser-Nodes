/**
 * core/geometry.js - Real geometry data model matching Blender's GeometrySet.
 *
 * In Blender, geometry nodes operate on REAL data — actual vertex positions,
 * spline control points, face indices. This module provides those data structures.
 *
 * Architecture:
 *   GeometrySet (top-level container)
 *     ├── MeshComponent   (vertices, edges, faces, corners + per-domain attributes)
 *     ├── CurveComponent   (splines with control points + per-domain attributes)
 *     └── InstancesComponent (transforms + geometry references)
 *
 * Each component stores per-domain attributes (position, normal, radius, UVs, etc.)
 * Fields evaluate against real element data from these components.
 */

// ── Domain & Attribute Type Constants ─────────────────────────────────────────

export const DOMAIN = {
  POINT: 'POINT',
  EDGE: 'EDGE',
  FACE: 'FACE',
  CORNER: 'CORNER',
  CURVE_POINT: 'CURVE_POINT',
  SPLINE: 'SPLINE',
  INSTANCE: 'INSTANCE',
};

export const ATTR_TYPE = {
  FLOAT: 'FLOAT',
  INT: 'INT',
  BOOL: 'BOOL',
  FLOAT_VECTOR: 'FLOAT_VECTOR',
  FLOAT_COLOR: 'FLOAT_COLOR',
  FLOAT2: 'FLOAT2',
};

// ── Utility ──────────────────────────────────────────────────────────────────

function cloneVec(v) { return { x: v.x, y: v.y, z: v.z }; }
function cloneVec2(v) { return { x: v.x, y: v.y }; }
function cloneColor(c) { return { r: c.r, g: c.g, b: c.b, a: c.a }; }

function cloneAttrValue(val, type) {
  if (val === null || val === undefined) return val;
  switch (type) {
    case ATTR_TYPE.FLOAT_VECTOR: return cloneVec(val);
    case ATTR_TYPE.FLOAT2: return cloneVec2(val);
    case ATTR_TYPE.FLOAT_COLOR: return cloneColor(val);
    default: return val;
  }
}

function cloneAttrArray(arr, type) {
  return arr.map(v => cloneAttrValue(v, type));
}

function defaultForType(type) {
  switch (type) {
    case ATTR_TYPE.FLOAT: return 0;
    case ATTR_TYPE.INT: return 0;
    case ATTR_TYPE.BOOL: return false;
    case ATTR_TYPE.FLOAT_VECTOR: return { x: 0, y: 0, z: 0 };
    case ATTR_TYPE.FLOAT_COLOR: return { r: 0, g: 0, b: 0, a: 1 };
    case ATTR_TYPE.FLOAT2: return { x: 0, y: 0 };
    default: return 0;
  }
}

// ── AttributeMap ─────────────────────────────────────────────────────────────

/**
 * Stores named, typed attribute arrays for a single domain.
 */
class AttributeMap {
  constructor() {
    this._attrs = new Map(); // name -> { type: ATTR_TYPE, data: Array }
  }

  has(name) { return this._attrs.has(name); }

  get(name) {
    const attr = this._attrs.get(name);
    return attr ? attr.data : null;
  }

  getWithType(name) {
    return this._attrs.get(name) || null;
  }

  set(name, type, data) {
    this._attrs.set(name, { type, data });
  }

  remove(name) {
    this._attrs.delete(name);
  }

  names() {
    return [...this._attrs.keys()];
  }

  clone() {
    const copy = new AttributeMap();
    for (const [name, attr] of this._attrs) {
      copy._attrs.set(name, {
        type: attr.type,
        data: cloneAttrArray(attr.data, attr.type),
      });
    }
    return copy;
  }

  /** Resize all attribute arrays to `count`, filling new entries with defaults. */
  resize(count) {
    for (const [, attr] of this._attrs) {
      while (attr.data.length < count) {
        attr.data.push(defaultForType(attr.type));
      }
      if (attr.data.length > count) {
        attr.data.length = count;
      }
    }
  }

  /** Append another AttributeMap's data (for join operations). */
  append(other) {
    const mySize = this.size;
    const otherSize = other.size;

    // Pad attributes that exist in 'this' but not in 'other'
    // so they maintain correct length after appending
    for (const [name, myAttr] of this._attrs) {
      if (!other._attrs.has(name)) {
        const def = defaultForType(myAttr.type);
        for (let i = 0; i < otherSize; i++) {
          myAttr.data.push(cloneAttrValue(def, myAttr.type));
        }
      }
    }

    // Append other's data, padding for attributes new to 'this'
    for (const [name, otherAttr] of other._attrs) {
      const mine = this._attrs.get(name);
      if (mine) {
        mine.data.push(...otherAttr.data);
      } else {
        // Attribute exists only in other — pad with defaults for existing elements
        const def = defaultForType(otherAttr.type);
        const padded = [];
        for (let i = 0; i < mySize; i++) {
          padded.push(cloneAttrValue(def, otherAttr.type));
        }
        padded.push(...otherAttr.data);
        this._attrs.set(name, {
          type: otherAttr.type,
          data: padded,
        });
      }
    }
  }

  /** Keep only elements at the given indices. */
  filter(indices) {
    for (const [, attr] of this._attrs) {
      attr.data = indices.map(i => cloneAttrValue(attr.data[i], attr.type));
    }
  }

  get size() {
    for (const [, attr] of this._attrs) return attr.data.length;
    return 0;
  }
}

// ── MeshComponent ────────────────────────────────────────────────────────────

/**
 * Real mesh data: vertices (positions), edges, faces (polygons), corners (loops).
 *
 * Blender domains:
 *   POINT  - per-vertex (positions, vertex groups, etc.)
 *   EDGE   - per-edge (crease, seam, etc.)
 *   FACE   - per-face (material index, shade smooth, etc.)
 *   CORNER - per-face-corner (UVs, per-corner normals, etc.)
 *
 * Topology:
 *   positions[]    - vertex positions (POINT domain built-in)
 *   edges[]        - [v1, v2] index pairs
 *   faceVertCounts - number of vertices per face
 *   cornerVerts    - flat array of vertex indices for all face corners
 */
export class MeshComponent {
  constructor() {
    this.positions = [];       // [{x,y,z}, ...] one per vertex
    this.edges = [];           // [[v1,v2], ...] vertex index pairs
    this.faceVertCounts = [];  // [3, 4, 3, ...] verts per face
    this.cornerVerts = [];     // [v0, v1, v2, v0, v1, v2, v3, ...] flat corner array

    // Per-domain attribute storage
    this.pointAttrs = new AttributeMap();    // POINT domain
    this.edgeAttrs = new AttributeMap();     // EDGE domain
    this.faceAttrs = new AttributeMap();     // FACE domain
    this.cornerAttrs = new AttributeMap();   // CORNER domain
  }

  get vertexCount() { return this.positions.length; }
  get edgeCount() { return this.edges.length; }
  get faceCount() { return this.faceVertCounts.length; }
  get cornerCount() { return this.cornerVerts.length; }

  /**
   * Build a cached array of corner offsets for O(1) face lookup.
   * Lazily computed and invalidated when face topology changes.
   */
  _ensureCornerOffsets() {
    if (this._cornerOffsets && this._cornerOffsets.length === this.faceVertCounts.length) {
      return this._cornerOffsets;
    }
    const offsets = new Array(this.faceVertCounts.length);
    let offset = 0;
    for (let i = 0; i < this.faceVertCounts.length; i++) {
      offsets[i] = offset;
      offset += this.faceVertCounts[i];
    }
    this._cornerOffsets = offsets;
    return offsets;
  }

  /** Invalidate the corner offset cache (call after modifying face topology). */
  invalidateCornerOffsets() {
    this._cornerOffsets = null;
  }

  /** Get the vertex indices of a specific face. */
  getFaceVertices(faceIdx) {
    const offsets = this._ensureCornerOffsets();
    const offset = offsets[faceIdx];
    const count = this.faceVertCounts[faceIdx];
    return this.cornerVerts.slice(offset, offset + count);
  }

  /** Get the starting corner offset for a face. */
  getFaceCornerStart(faceIdx) {
    const offsets = this._ensureCornerOffsets();
    return offsets[faceIdx];
  }

  /** Compute the center position of a face. */
  getFaceCenter(faceIdx) {
    const verts = this.getFaceVertices(faceIdx);
    const center = { x: 0, y: 0, z: 0 };
    for (const vi of verts) {
      center.x += this.positions[vi].x;
      center.y += this.positions[vi].y;
      center.z += this.positions[vi].z;
    }
    const n = verts.length;
    center.x /= n; center.y /= n; center.z /= n;
    return center;
  }

  /** Compute flat normal for a face (using first 3 vertices). */
  getFaceNormal(faceIdx) {
    const verts = this.getFaceVertices(faceIdx);
    if (verts.length < 3) return { x: 0, y: 1, z: 0 };
    const a = this.positions[verts[0]];
    const b = this.positions[verts[1]];
    const c = this.positions[verts[2]];
    // Cross product of (b-a) x (c-a)
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /** Compute vertex normals by averaging adjacent face normals. */
  computeVertexNormals() {
    const normals = this.positions.map(() => ({ x: 0, y: 0, z: 0 }));
    const counts = new Array(this.positions.length).fill(0);

    for (let fi = 0; fi < this.faceCount; fi++) {
      const fn = this.getFaceNormal(fi);
      const verts = this.getFaceVertices(fi);
      for (const vi of verts) {
        normals[vi].x += fn.x;
        normals[vi].y += fn.y;
        normals[vi].z += fn.z;
        counts[vi]++;
      }
    }

    for (let i = 0; i < normals.length; i++) {
      if (counts[i] > 0) {
        const len = Math.sqrt(
          normals[i].x ** 2 + normals[i].y ** 2 + normals[i].z ** 2
        ) || 1;
        normals[i].x /= len;
        normals[i].y /= len;
        normals[i].z /= len;
      } else {
        normals[i] = { x: 0, y: 1, z: 0 };
      }
    }
    return normals;
  }

  /** Deep clone this mesh component. */
  copy() {
    const m = new MeshComponent();
    m.positions = this.positions.map(cloneVec);
    m.edges = this.edges.map(e => [...e]);
    m.faceVertCounts = [...this.faceVertCounts];
    m.cornerVerts = [...this.cornerVerts];
    m.pointAttrs = this.pointAttrs.clone();
    m.edgeAttrs = this.edgeAttrs.clone();
    m.faceAttrs = this.faceAttrs.clone();
    m.cornerAttrs = this.cornerAttrs.clone();
    return m;
  }

  /** Build element contexts for field evaluation on a domain. */
  buildElements(domain) {
    switch (domain) {
      case DOMAIN.POINT: {
        const normals = this.computeVertexNormals();
        const count = this.vertexCount;
        return this.positions.map((pos, i) => ({
          index: i,
          count,
          position: cloneVec(pos),
          normal: normals[i],
        }));
      }
      case DOMAIN.FACE: {
        const count = this.faceCount;
        const elements = [];
        for (let i = 0; i < count; i++) {
          elements.push({
            index: i,
            count,
            position: this.getFaceCenter(i),
            normal: this.getFaceNormal(i),
          });
        }
        return elements;
      }
      case DOMAIN.EDGE: {
        const count = this.edgeCount;
        return this.edges.map((edge, i) => {
          const a = this.positions[edge[0]];
          const b = this.positions[edge[1]];
          return {
            index: i,
            count,
            position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 },
            normal: { x: 0, y: 1, z: 0 },
          };
        });
      }
      case DOMAIN.CORNER: {
        const count = this.cornerCount;
        return this.cornerVerts.map((vi, i) => ({
          index: i,
          count,
          position: cloneVec(this.positions[vi]),
          normal: { x: 0, y: 1, z: 0 },
        }));
      }
      default:
        return [];
    }
  }
}

// ── CurveComponent ───────────────────────────────────────────────────────────

/**
 * Real curve data: one or more splines, each with control points.
 *
 * Blender domains:
 *   CURVE_POINT - per control point (position, radius, tilt, handles)
 *   SPLINE      - per spline (cyclic, resolution, type)
 *
 * Spline types: POLY, BEZIER, NURBS
 */
export class CurveComponent {
  constructor() {
    this.splines = [];
    // Each spline: {
    //   type: 'POLY' | 'BEZIER' | 'NURBS',
    //   positions: [{x,y,z}, ...],
    //   handleLeft: [{x,y,z}, ...],   // BEZIER only
    //   handleRight: [{x,y,z}, ...],  // BEZIER only
    //   radii: [float, ...],
    //   tilts: [float, ...],
    //   cyclic: bool,
    //   resolution: int
    // }

    this.pointAttrs = new AttributeMap();   // CURVE_POINT domain
    this.splineAttrs = new AttributeMap();  // SPLINE domain
  }

  get splineCount() { return this.splines.length; }

  /** Total control points across all splines. */
  get pointCount() {
    let count = 0;
    for (const s of this.splines) count += s.positions.length;
    return count;
  }

  /** Get flat list of all control point positions. */
  getAllPositions() {
    const all = [];
    for (const s of this.splines) {
      for (const p of s.positions) all.push(p);
    }
    return all;
  }

  /** Evaluate a point on a spline at parameter t (0..1). */
  evaluateSpline(splineIdx, t) {
    const spline = this.splines[splineIdx];
    if (!spline) return { x: 0, y: 0, z: 0 };

    const pts = spline.positions;
    const n = pts.length;
    if (n === 0) return { x: 0, y: 0, z: 0 };
    if (n === 1) return cloneVec(pts[0]);

    if (spline.type === 'BEZIER' && spline.handleLeft && spline.handleRight) {
      return this._evaluateBezierSpline(spline, t);
    }

    // POLY: linear interpolation between control points
    const cyclic = spline.cyclic;
    const segCount = cyclic ? n : n - 1;
    if (segCount <= 0) return cloneVec(pts[0]);

    const tClamped = cyclic ? ((t % 1) + 1) % 1 : Math.max(0, Math.min(1, t));
    const seg = tClamped * segCount;
    const segIdx = Math.min(Math.floor(seg), segCount - 1);
    const segT = seg - segIdx;

    const p0 = pts[segIdx];
    const p1 = pts[(segIdx + 1) % n];

    return {
      x: p0.x + (p1.x - p0.x) * segT,
      y: p0.y + (p1.y - p0.y) * segT,
      z: p0.z + (p1.z - p0.z) * segT,
    };
  }

  /** Evaluate a bezier spline at parameter t. */
  _evaluateBezierSpline(spline, t) {
    const pts = spline.positions;
    const hl = spline.handleLeft;
    const hr = spline.handleRight;
    const n = pts.length;
    const cyclic = spline.cyclic;
    const segCount = cyclic ? n : n - 1;
    if (segCount <= 0) return cloneVec(pts[0]);

    const tClamped = cyclic ? ((t % 1) + 1) % 1 : Math.max(0, Math.min(1, t));
    const seg = tClamped * segCount;
    const segIdx = Math.min(Math.floor(seg), segCount - 1);
    const u = seg - segIdx;

    const i0 = segIdx;
    const i1 = (segIdx + 1) % n;
    const p0 = pts[i0], p3 = pts[i1];
    const p1 = hr[i0], p2 = hl[i1];

    // Cubic bezier: B(u) = (1-u)^3*p0 + 3*(1-u)^2*u*p1 + 3*(1-u)*u^2*p2 + u^3*p3
    const u2 = u * u, u3 = u2 * u;
    const mu = 1 - u, mu2 = mu * mu, mu3 = mu2 * mu;

    return {
      x: mu3 * p0.x + 3 * mu2 * u * p1.x + 3 * mu * u2 * p2.x + u3 * p3.x,
      y: mu3 * p0.y + 3 * mu2 * u * p1.y + 3 * mu * u2 * p2.y + u3 * p3.y,
      z: mu3 * p0.z + 3 * mu2 * u * p1.z + 3 * mu * u2 * p2.z + u3 * p3.z,
    };
  }

  /** Evaluate the tangent (derivative) at parameter t. */
  evaluateSplineTangent(splineIdx, t) {
    const epsilon = 0.001;
    const p0 = this.evaluateSpline(splineIdx, t - epsilon);
    const p1 = this.evaluateSpline(splineIdx, t + epsilon);
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  }

  /** Evaluate radius at parameter t by interpolating control point radii. */
  evaluateSplineRadius(splineIdx, t) {
    const spline = this.splines[splineIdx];
    if (!spline || !spline.radii || spline.radii.length === 0) return 1;
    const n = spline.radii.length;
    if (n === 1) return spline.radii[0];
    const tClamped = Math.max(0, Math.min(1, t));
    const f = tClamped * (n - 1);
    const i = Math.min(Math.floor(f), n - 2);
    const frac = f - i;
    return spline.radii[i] + (spline.radii[i + 1] - spline.radii[i]) * frac;
  }

  /** Compute approximate arc length of a spline. */
  splineLength(splineIdx, segments = 64) {
    let length = 0;
    let prev = this.evaluateSpline(splineIdx, 0);
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const curr = this.evaluateSpline(splineIdx, t);
      const dx = curr.x - prev.x, dy = curr.y - prev.y, dz = curr.z - prev.z;
      length += Math.sqrt(dx * dx + dy * dy + dz * dz);
      prev = curr;
    }
    return length;
  }

  /** Resample a spline to `count` evenly-spaced points. Returns new positions array. */
  resampleSpline(splineIdx, count) {
    if (count < 2) count = 2;
    const positions = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      positions.push(this.evaluateSpline(splineIdx, t));
    }
    return positions;
  }

  /** Deep clone this curve component. */
  copy() {
    const c = new CurveComponent();
    c.splines = this.splines.map(s => ({
      type: s.type,
      positions: s.positions.map(cloneVec),
      handleLeft: s.handleLeft ? s.handleLeft.map(cloneVec) : null,
      handleRight: s.handleRight ? s.handleRight.map(cloneVec) : null,
      radii: s.radii ? [...s.radii] : null,
      tilts: s.tilts ? [...s.tilts] : null,
      cyclic: s.cyclic,
      resolution: s.resolution,
    }));
    c.pointAttrs = this.pointAttrs.clone();
    c.splineAttrs = this.splineAttrs.clone();
    return c;
  }

  /** Build element contexts for field evaluation. */
  buildElements(domain) {
    if (domain === DOMAIN.CURVE_POINT || domain === DOMAIN.POINT) {
      const all = [];
      const totalCount = this.pointCount;
      let globalIdx = 0;
      for (let si = 0; si < this.splines.length; si++) {
        const spline = this.splines[si];
        const pointsInSpline = spline.positions.length;
        for (let i = 0; i < pointsInSpline; i++) {
          all.push({
            index: globalIdx,
            count: totalCount,
            position: cloneVec(spline.positions[i]),
            normal: { x: 0, y: 0, z: 1 },
            // Curve-specific context for field evaluation
            splineIndex: si,
            splineCount: this.splines.length,
            localIndex: i,
            localCount: pointsInSpline,
            // Parameter t along spline (0..1)
            parameter: pointsInSpline > 1 ? i / (pointsInSpline - 1) : 0,
          });
          globalIdx++;
        }
      }
      return all;
    }
    if (domain === DOMAIN.SPLINE) {
      return this.splines.map((s, i) => ({
        index: i,
        count: this.splineCount,
        position: s.positions.length > 0 ? cloneVec(s.positions[0]) : { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
      }));
    }
    return [];
  }
}

// ── InstancesComponent ───────────────────────────────────────────────────────

/**
 * Instances: transforms + references to geometry.
 * In Blender, Instance on Points creates instances at each point position.
 * Realize Instances converts instances back to real geometry.
 */
export class InstancesComponent {
  constructor() {
    this.transforms = [];     // [{position:{x,y,z}, rotation:{x,y,z}, scale:{x,y,z}}, ...]
    this.references = [];     // [GeometrySet, ...] what each instance points to
    this.instanceAttrs = new AttributeMap(); // INSTANCE domain
  }

  get instanceCount() { return this.transforms.length; }

  addInstance(position, rotation, scale, reference) {
    this.transforms.push({
      position: position ? cloneVec(position) : { x: 0, y: 0, z: 0 },
      rotation: rotation ? cloneVec(rotation) : { x: 0, y: 0, z: 0 },
      scale: scale ? cloneVec(scale) : { x: 1, y: 1, z: 1 },
    });
    this.references.push(reference);
  }

  /** Deep clone. */
  copy() {
    const inst = new InstancesComponent();
    inst.transforms = this.transforms.map(t => ({
      position: cloneVec(t.position),
      rotation: cloneVec(t.rotation),
      scale: cloneVec(t.scale),
    }));
    // References are shared (not deep cloned) — they're read-only geometry templates
    inst.references = [...this.references];
    inst.instanceAttrs = this.instanceAttrs.clone();
    return inst;
  }

  buildElements(domain) {
    if (domain === DOMAIN.INSTANCE || domain === DOMAIN.POINT) {
      return this.transforms.map((t, i) => ({
        index: i,
        count: this.instanceCount,
        position: cloneVec(t.position),
        normal: { x: 0, y: 1, z: 0 },
      }));
    }
    return [];
  }
}

// ── GeometrySet ──────────────────────────────────────────────────────────────

/**
 * Top-level geometry container, matching Blender's GeometrySet.
 * Can hold mesh, curve, and instances simultaneously.
 */
export class GeometrySet {
  constructor() {
    this.mesh = null;       // MeshComponent | null
    this.curve = null;      // CurveComponent | null
    this.instances = null;  // InstancesComponent | null
  }

  get hasMesh() { return this.mesh !== null && this.mesh.vertexCount > 0; }
  get hasCurve() { return this.curve !== null && this.curve.splineCount > 0; }
  get hasInstances() { return this.instances !== null && this.instances.instanceCount > 0; }

  /** Deep clone the entire geometry set. */
  copy() {
    const gs = new GeometrySet();
    gs.mesh = this.mesh ? this.mesh.copy() : null;
    gs.curve = this.curve ? this.curve.copy() : null;
    gs.instances = this.instances ? this.instances.copy() : null;
    return gs;
  }

  /** Get element count for a domain. */
  domainSize(domain) {
    switch (domain) {
      case DOMAIN.POINT: return this.mesh ? this.mesh.vertexCount : 0;
      case DOMAIN.EDGE: return this.mesh ? this.mesh.edgeCount : 0;
      case DOMAIN.FACE: return this.mesh ? this.mesh.faceCount : 0;
      case DOMAIN.CORNER: return this.mesh ? this.mesh.cornerCount : 0;
      case DOMAIN.CURVE_POINT: return this.curve ? this.curve.pointCount : 0;
      case DOMAIN.SPLINE: return this.curve ? this.curve.splineCount : 0;
      case DOMAIN.INSTANCE: return this.instances ? this.instances.instanceCount : 0;
      default: return 0;
    }
  }

  /**
   * Build element contexts for field evaluation on a specific domain.
   * Returns [{index, count, position, normal}, ...] - one per element.
   */
  buildElements(domain) {
    switch (domain) {
      case DOMAIN.POINT:
        return this.mesh ? this.mesh.buildElements(DOMAIN.POINT) : [];
      case DOMAIN.EDGE:
        return this.mesh ? this.mesh.buildElements(DOMAIN.EDGE) : [];
      case DOMAIN.FACE:
        return this.mesh ? this.mesh.buildElements(DOMAIN.FACE) : [];
      case DOMAIN.CORNER:
        return this.mesh ? this.mesh.buildElements(DOMAIN.CORNER) : [];
      case DOMAIN.CURVE_POINT:
        return this.curve ? this.curve.buildElements(DOMAIN.CURVE_POINT) : [];
      case DOMAIN.SPLINE:
        return this.curve ? this.curve.buildElements(DOMAIN.SPLINE) : [];
      case DOMAIN.INSTANCE:
        return this.instances ? this.instances.buildElements(DOMAIN.INSTANCE) : [];
      default:
        return [];
    }
  }

  /**
   * Join another GeometrySet into this one.
   * Merges mesh vertices, curve splines, and instances.
   */
  join(other) {
    if (!other) return;

    // Join meshes
    if (other.mesh && other.mesh.vertexCount > 0) {
      if (!this.mesh) {
        this.mesh = other.mesh.copy();
      } else {
        const offset = this.mesh.vertexCount;
        const cornerOffset = this.mesh.cornerCount;

        // Append positions
        for (const p of other.mesh.positions) {
          this.mesh.positions.push(cloneVec(p));
        }

        // Append edges (offset vertex indices)
        for (const e of other.mesh.edges) {
          this.mesh.edges.push([e[0] + offset, e[1] + offset]);
        }

        // Append faces
        this.mesh.faceVertCounts.push(...other.mesh.faceVertCounts);
        for (const vi of other.mesh.cornerVerts) {
          this.mesh.cornerVerts.push(vi + offset);
        }

        // Append attributes
        this.mesh.pointAttrs.append(other.mesh.pointAttrs);
        this.mesh.edgeAttrs.append(other.mesh.edgeAttrs);
        this.mesh.faceAttrs.append(other.mesh.faceAttrs);
        this.mesh.cornerAttrs.append(other.mesh.cornerAttrs);
      }
    }

    // Join curves
    if (other.curve && other.curve.splineCount > 0) {
      if (!this.curve) {
        this.curve = other.curve.copy();
      } else {
        for (const s of other.curve.splines) {
          this.curve.splines.push({
            type: s.type,
            positions: s.positions.map(cloneVec),
            handleLeft: s.handleLeft ? s.handleLeft.map(cloneVec) : null,
            handleRight: s.handleRight ? s.handleRight.map(cloneVec) : null,
            radii: s.radii ? [...s.radii] : null,
            tilts: s.tilts ? [...s.tilts] : null,
            cyclic: s.cyclic,
            resolution: s.resolution,
          });
        }
        this.curve.pointAttrs.append(other.curve.pointAttrs);
        this.curve.splineAttrs.append(other.curve.splineAttrs);
      }
    }

    // Join instances
    if (other.instances && other.instances.instanceCount > 0) {
      if (!this.instances) {
        this.instances = other.instances.copy();
      } else {
        for (let i = 0; i < other.instances.instanceCount; i++) {
          const t = other.instances.transforms[i];
          this.instances.transforms.push({
            position: cloneVec(t.position),
            rotation: cloneVec(t.rotation),
            scale: cloneVec(t.scale),
          });
          this.instances.references.push(other.instances.references[i]);
        }
        this.instances.instanceAttrs.append(other.instances.instanceAttrs);
      }
    }
  }
}

// ── Mesh Primitive Builders ──────────────────────────────────────────────────

/**
 * Create a grid mesh (like Blender's Mesh Grid node).
 * Grid lies in XY plane, centered at origin.
 */
export function createMeshGrid(sizeX, sizeY, verticesX, verticesY) {
  const mesh = new MeshComponent();
  verticesX = Math.max(2, Math.round(verticesX));
  verticesY = Math.max(2, Math.round(verticesY));

  const halfX = sizeX / 2, halfY = sizeY / 2;

  // Create vertices
  for (let iy = 0; iy < verticesY; iy++) {
    for (let ix = 0; ix < verticesX; ix++) {
      mesh.positions.push({
        x: -halfX + (ix / (verticesX - 1)) * sizeX,
        y: -halfY + (iy / (verticesY - 1)) * sizeY,
        z: 0,
      });
    }
  }

  // Create faces and edges
  for (let iy = 0; iy < verticesY - 1; iy++) {
    for (let ix = 0; ix < verticesX - 1; ix++) {
      const bl = iy * verticesX + ix;
      const br = bl + 1;
      const tl = bl + verticesX;
      const tr = tl + 1;

      // Quad face (CCW winding)
      mesh.faceVertCounts.push(4);
      mesh.cornerVerts.push(bl, br, tr, tl);

      // Horizontal edge
      mesh.edges.push([bl, br]);
      // Vertical edge
      mesh.edges.push([bl, tl]);
    }
    // Right column vertical edges
    const rightCol = (iy + 1) * verticesX - 1;
    mesh.edges.push([rightCol, rightCol + verticesX]);
  }
  // Bottom row right edges + top row horizontal edges
  for (let ix = 0; ix < verticesX - 1; ix++) {
    mesh.edges.push([(verticesY - 1) * verticesX + ix, (verticesY - 1) * verticesX + ix + 1]);
  }

  // UV attribute on CORNER domain
  const uvs = [];
  for (let iy = 0; iy < verticesY - 1; iy++) {
    for (let ix = 0; ix < verticesX - 1; ix++) {
      uvs.push(
        { x: ix / (verticesX - 1), y: iy / (verticesY - 1) },
        { x: (ix + 1) / (verticesX - 1), y: iy / (verticesY - 1) },
        { x: (ix + 1) / (verticesX - 1), y: (iy + 1) / (verticesY - 1) },
        { x: ix / (verticesX - 1), y: (iy + 1) / (verticesY - 1) }
      );
    }
  }
  mesh.cornerAttrs.set('uv_map', ATTR_TYPE.FLOAT2, uvs);

  return mesh;
}

/**
 * Create a cube/box mesh (like Blender's Mesh Cube node).
 */
export function createMeshCube(sizeX, sizeY, sizeZ, verticesX, verticesY, verticesZ) {
  const vx = Math.max(2, Math.round(verticesX || 2));
  const vy = Math.max(2, Math.round(verticesY || 2));
  const vz = Math.max(2, Math.round(verticesZ || 2));

  const mesh = new MeshComponent();
  const hx = sizeX / 2, hy = sizeY / 2, hz = sizeZ / 2;

  // Build a subdivided box: 6 face grids with shared edge/corner vertices.
  // Blender ref: bke_mesh_primitive_cuboid_calc
  const vertMap = new Map();
  const edgeSet = new Set();

  function addVert(px, py, pz) {
    const kx = Math.round(px * 1e6) / 1e6;
    const ky = Math.round(py * 1e6) / 1e6;
    const kz = Math.round(pz * 1e6) / 1e6;
    const key = `${kx},${ky},${kz}`;
    if (vertMap.has(key)) return vertMap.get(key);
    const idx = mesh.positions.length;
    mesh.positions.push({ x: px, y: py, z: pz });
    vertMap.set(key, idx);
    return idx;
  }

  function addEdge(a, b) {
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      mesh.edges.push([Math.min(a, b), Math.max(a, b)]);
    }
  }

  function addFaceGrid(resU, resV, posFunc, ccw) {
    const grid = [];
    for (let iv = 0; iv < resV; iv++) {
      const row = [];
      for (let iu = 0; iu < resU; iu++) {
        const p = posFunc(iu / (resU - 1), iv / (resV - 1));
        row.push(addVert(p.x, p.y, p.z));
      }
      grid.push(row);
    }
    for (let iv = 0; iv < resV - 1; iv++) {
      for (let iu = 0; iu < resU - 1; iu++) {
        const bl = grid[iv][iu], br = grid[iv][iu + 1];
        const tr = grid[iv + 1][iu + 1], tl = grid[iv + 1][iu];
        mesh.faceVertCounts.push(4);
        if (ccw) mesh.cornerVerts.push(bl, br, tr, tl);
        else mesh.cornerVerts.push(bl, tl, tr, br);
        addEdge(bl, br); addEdge(br, tr); addEdge(tr, tl); addEdge(tl, bl);
      }
    }
  }

  // -Z back face
  addFaceGrid(vx, vy, (u, v) => ({ x: -hx + u * sizeX, y: -hy + v * sizeY, z: -hz }), false);
  // +Z front face
  addFaceGrid(vx, vy, (u, v) => ({ x: -hx + u * sizeX, y: -hy + v * sizeY, z: hz }), true);
  // -Y bottom face
  addFaceGrid(vx, vz, (u, v) => ({ x: -hx + u * sizeX, y: -hy, z: -hz + v * sizeZ }), true);
  // +Y top face
  addFaceGrid(vx, vz, (u, v) => ({ x: -hx + u * sizeX, y: hy, z: -hz + v * sizeZ }), false);
  // -X left face
  addFaceGrid(vz, vy, (u, v) => ({ x: -hx, y: -hy + v * sizeY, z: -hz + u * sizeZ }), true);
  // +X right face
  addFaceGrid(vz, vy, (u, v) => ({ x: hx, y: -hy + v * sizeY, z: -hz + u * sizeZ }), false);

  return mesh;
}

/**
 * Create a cylinder mesh (like Blender's Mesh Cylinder node).
 */
export function createMeshCylinder(vertices, radius, depth, fillType) {
  const mesh = new MeshComponent();
  vertices = Math.max(3, Math.round(vertices));
  const halfDepth = depth / 2;
  const hasFill = fillType !== 'NONE';

  // Bottom ring + top ring
  for (let ring = 0; ring < 2; ring++) {
    const z = ring === 0 ? -halfDepth : halfDepth;
    for (let i = 0; i < vertices; i++) {
      const angle = (i / vertices) * Math.PI * 2;
      mesh.positions.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z,
      });
    }
  }

  // If filled, add center vertices for caps
  let bottomCenter = -1, topCenter = -1;
  if (hasFill) {
    bottomCenter = mesh.positions.length;
    mesh.positions.push({ x: 0, y: 0, z: -halfDepth });
    topCenter = mesh.positions.length;
    mesh.positions.push({ x: 0, y: 0, z: halfDepth });
  }

  // Side faces (quads)
  for (let i = 0; i < vertices; i++) {
    const next = (i + 1) % vertices;
    const bl = i, br = next;
    const tl = i + vertices, tr = next + vertices;
    mesh.faceVertCounts.push(4);
    mesh.cornerVerts.push(bl, br, tr, tl);
    // Side edges
    mesh.edges.push([bl, br]);
    mesh.edges.push([bl, tl]);
  }

  // Cap faces
  if (hasFill) {
    if (fillType === 'NGON') {
      // Bottom cap (single ngon, reversed winding)
      mesh.faceVertCounts.push(vertices);
      for (let i = vertices - 1; i >= 0; i--) mesh.cornerVerts.push(i);
      // Top cap
      mesh.faceVertCounts.push(vertices);
      for (let i = 0; i < vertices; i++) mesh.cornerVerts.push(i + vertices);
    } else {
      // Triangle fan caps
      for (let i = 0; i < vertices; i++) {
        const next = (i + 1) % vertices;
        // Bottom
        mesh.faceVertCounts.push(3);
        mesh.cornerVerts.push(bottomCenter, next, i);
        // Top
        mesh.faceVertCounts.push(3);
        mesh.cornerVerts.push(topCenter, i + vertices, next + vertices);
      }
    }
  }

  // Cap edges
  for (let i = 0; i < vertices; i++) {
    mesh.edges.push([i + vertices, (i + 1) % vertices + vertices]);
  }

  return mesh;
}

/**
 * Create a UV sphere mesh.
 */
export function createMeshUVSphere(segments, rings, radius) {
  const mesh = new MeshComponent();
  segments = Math.max(3, Math.round(segments));
  rings = Math.max(2, Math.round(rings));

  // Top pole
  mesh.positions.push({ x: 0, y: 0, z: radius });

  // Middle rings
  for (let ring = 1; ring < rings; ring++) {
    const phi = (ring / rings) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let seg = 0; seg < segments; seg++) {
      const theta = (seg / segments) * Math.PI * 2;
      mesh.positions.push({
        x: Math.cos(theta) * sinPhi * radius,
        y: Math.sin(theta) * sinPhi * radius,
        z: cosPhi * radius,
      });
    }
  }

  // Bottom pole
  const bottomPole = mesh.positions.length;
  mesh.positions.push({ x: 0, y: 0, z: -radius });

  // Top cap triangles
  for (let seg = 0; seg < segments; seg++) {
    const next = (seg + 1) % segments;
    mesh.faceVertCounts.push(3);
    mesh.cornerVerts.push(0, seg + 1, next + 1);
  }

  // Middle quads
  for (let ring = 0; ring < rings - 2; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      const next = (seg + 1) % segments;
      const curr = 1 + ring * segments + seg;
      const currNext = 1 + ring * segments + next;
      const below = 1 + (ring + 1) * segments + seg;
      const belowNext = 1 + (ring + 1) * segments + next;
      mesh.faceVertCounts.push(4);
      mesh.cornerVerts.push(curr, currNext, belowNext, below);
    }
  }

  // Bottom cap triangles
  const lastRingStart = 1 + (rings - 2) * segments;
  for (let seg = 0; seg < segments; seg++) {
    const next = (seg + 1) % segments;
    mesh.faceVertCounts.push(3);
    mesh.cornerVerts.push(lastRingStart + seg, bottomPole, lastRingStart + next);
  }

  // Build edges from faces
  _buildEdgesFromFaces(mesh);

  return mesh;
}

/**
 * Create an icosphere mesh.
 */
export function createMeshIcoSphere(radius, subdivisions) {
  subdivisions = Math.max(1, Math.min(6, Math.round(subdivisions)));
  const mesh = new MeshComponent();

  // Start with icosahedron
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  // Normalize to radius
  for (const v of verts) {
    const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
    mesh.positions.push({ x: v[0] / len * radius, y: v[1] / len * radius, z: v[2] / len * radius });
  }

  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  // Subdivide
  for (let sub = 1; sub < subdivisions; sub++) {
    const midCache = {};
    const newFaces = [];

    function getMidpoint(a, b) {
      const key = Math.min(a, b) + '_' + Math.max(a, b);
      if (midCache[key] !== undefined) return midCache[key];
      const pa = mesh.positions[a], pb = mesh.positions[b];
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, mz = (pa.z + pb.z) / 2;
      const len = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
      mesh.positions.push({ x: mx / len * radius, y: my / len * radius, z: mz / len * radius });
      midCache[key] = mesh.positions.length - 1;
      return midCache[key];
    }

    for (const [a, b, c] of faces) {
      const ab = getMidpoint(a, b);
      const bc = getMidpoint(b, c);
      const ca = getMidpoint(c, a);
      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = newFaces;
  }

  for (const [a, b, c] of faces) {
    mesh.faceVertCounts.push(3);
    mesh.cornerVerts.push(a, b, c);
  }

  _buildEdgesFromFaces(mesh);
  return mesh;
}

/**
 * Create a cone mesh.
 */
export function createMeshCone(vertices, radiusTop, radiusBottom, depth, fillType) {
  const mesh = new MeshComponent();
  vertices = Math.max(3, Math.round(vertices));
  const halfDepth = depth / 2;
  const hasFill = fillType !== 'NONE';

  // Bottom ring
  for (let i = 0; i < vertices; i++) {
    const angle = (i / vertices) * Math.PI * 2;
    mesh.positions.push({
      x: Math.cos(angle) * radiusBottom,
      y: Math.sin(angle) * radiusBottom,
      z: -halfDepth,
    });
  }

  if (radiusTop > 0.0001) {
    // Top ring (truncated cone)
    for (let i = 0; i < vertices; i++) {
      const angle = (i / vertices) * Math.PI * 2;
      mesh.positions.push({
        x: Math.cos(angle) * radiusTop,
        y: Math.sin(angle) * radiusTop,
        z: halfDepth,
      });
    }

    // Side quads
    for (let i = 0; i < vertices; i++) {
      const next = (i + 1) % vertices;
      mesh.faceVertCounts.push(4);
      mesh.cornerVerts.push(i, next, next + vertices, i + vertices);
    }
  } else {
    // Point cone — single top vertex
    const topIdx = mesh.positions.length;
    mesh.positions.push({ x: 0, y: 0, z: halfDepth });

    // Side triangles
    for (let i = 0; i < vertices; i++) {
      const next = (i + 1) % vertices;
      mesh.faceVertCounts.push(3);
      mesh.cornerVerts.push(i, next, topIdx);
    }
  }

  // Bottom cap
  if (hasFill) {
    mesh.faceVertCounts.push(vertices);
    for (let i = vertices - 1; i >= 0; i--) mesh.cornerVerts.push(i);
    if (radiusTop > 0.0001) {
      mesh.faceVertCounts.push(vertices);
      for (let i = 0; i < vertices; i++) mesh.cornerVerts.push(i + vertices);
    }
  }

  _buildEdgesFromFaces(mesh);
  return mesh;
}

/**
 * Create a torus mesh.
 */
export function createMeshTorus(majorSegments, minorSegments, majorRadius, minorRadius) {
  const mesh = new MeshComponent();
  majorSegments = Math.max(3, Math.round(majorSegments));
  minorSegments = Math.max(3, Math.round(minorSegments));

  // Vertices
  for (let i = 0; i < majorSegments; i++) {
    const theta = (i / majorSegments) * Math.PI * 2;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    for (let j = 0; j < minorSegments; j++) {
      const phi = (j / minorSegments) * Math.PI * 2;
      const r = majorRadius + minorRadius * Math.cos(phi);
      mesh.positions.push({
        x: r * cosT,
        y: r * sinT,
        z: minorRadius * Math.sin(phi),
      });
    }
  }

  // Faces (quads)
  for (let i = 0; i < majorSegments; i++) {
    const nextI = (i + 1) % majorSegments;
    for (let j = 0; j < minorSegments; j++) {
      const nextJ = (j + 1) % minorSegments;
      mesh.faceVertCounts.push(4);
      mesh.cornerVerts.push(
        i * minorSegments + j,
        nextI * minorSegments + j,
        nextI * minorSegments + nextJ,
        i * minorSegments + nextJ
      );
    }
  }

  _buildEdgesFromFaces(mesh);
  return mesh;
}

/**
 * Create a line mesh (Blender's Mesh Line).
 */
export function createMeshLine(count, startX, startY, startZ, offsetX, offsetY, offsetZ) {
  const mesh = new MeshComponent();
  count = Math.max(2, Math.round(count));

  for (let i = 0; i < count; i++) {
    mesh.positions.push({
      x: startX + offsetX * i / (count - 1),
      y: startY + offsetY * i / (count - 1),
      z: startZ + offsetZ * i / (count - 1),
    });
  }

  for (let i = 0; i < count - 1; i++) {
    mesh.edges.push([i, i + 1]);
  }

  return mesh;
}

// ── Curve Primitive Builders ─────────────────────────────────────────────────

/**
 * Create a line curve (Blender's Curve Line node).
 */
export function createCurveLine(start, end) {
  const curve = new CurveComponent();
  curve.splines.push({
    type: 'POLY',
    positions: [cloneVec(start), cloneVec(end)],
    handleLeft: null,
    handleRight: null,
    radii: [1, 1],
    tilts: [0, 0],
    cyclic: false,
    resolution: 12,
  });
  return curve;
}

/**
 * Create a circle curve (Blender's Curve Circle node).
 */
export function createCurveCircle(resolution, radius) {
  const curve = new CurveComponent();
  resolution = Math.max(3, Math.round(resolution));
  const positions = [];
  const radii = [];
  const tilts = [];

  for (let i = 0; i < resolution; i++) {
    const angle = (i / resolution) * Math.PI * 2;
    positions.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: 0,
    });
    radii.push(1);
    tilts.push(0);
  }

  curve.splines.push({
    type: 'POLY',
    positions,
    handleLeft: null,
    handleRight: null,
    radii,
    tilts,
    cyclic: true,
    resolution: 12,
  });
  return curve;
}

// ── Helper: Build edges from face topology ───────────────────────────────────

function _buildEdgesFromFaces(mesh) {
  const edgeSet = new Set();
  let cornerIdx = 0;
  for (let fi = 0; fi < mesh.faceCount; fi++) {
    const count = mesh.faceVertCounts[fi];
    for (let j = 0; j < count; j++) {
      const a = mesh.cornerVerts[cornerIdx + j];
      const b = mesh.cornerVerts[cornerIdx + (j + 1) % count];
      const key = Math.min(a, b) + ',' + Math.max(a, b);
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        mesh.edges.push([Math.min(a, b), Math.max(a, b)]);
      }
    }
    cornerIdx += count;
  }
}

// ── Transform Helpers ────────────────────────────────────────────────────────

/**
 * Apply a 4x4 transform to all positions in a mesh.
 */
export function transformMeshPositions(mesh, matrix) {
  for (let i = 0; i < mesh.positions.length; i++) {
    mesh.positions[i] = applyMatrix4(mesh.positions[i], matrix);
  }
}

/**
 * Apply Euler rotation (XYZ order) and scale/translate to a position.
 */
export function applyTransform(pos, translation, rotation, scale) {
  // Scale
  let x = pos.x * scale.x, y = pos.y * scale.y, z = pos.z * scale.z;

  // Rotate (Euler XYZ)
  if (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0) {
    const result = rotateEulerXYZ(x, y, z, rotation.x, rotation.y, rotation.z);
    x = result.x; y = result.y; z = result.z;
  }

  // Translate
  return { x: x + translation.x, y: y + translation.y, z: z + translation.z };
}

export function rotateEulerXYZ(x, y, z, rx, ry, rz) {
  // Rotate around X
  if (rx !== 0) {
    const c = Math.cos(rx), s = Math.sin(rx);
    const ny = y * c - z * s, nz = y * s + z * c;
    y = ny; z = nz;
  }
  // Rotate around Y
  if (ry !== 0) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const nx = x * c + z * s, nz = -x * s + z * c;
    x = nx; z = nz;
  }
  // Rotate around Z
  if (rz !== 0) {
    const c = Math.cos(rz), s = Math.sin(rz);
    const nx = x * c - y * s, ny = x * s + y * c;
    x = nx; y = ny;
  }
  return { x, y, z };
}

function applyMatrix4(pos, m) {
  // m is a 16-element array in column-major order
  const x = pos.x, y = pos.y, z = pos.z;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}
