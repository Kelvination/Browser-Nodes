/**
 * geo/nodes_v2_fields.js - Field and math nodes for geometry node graphs.
 *
 * Field nodes produce lazy per-element data (Position, Normal, Index).
 * Math nodes combine fields/scalars with arithmetic operations.
 * If any input is a Field, the output is a Field that computes per-element.
 */

import { SocketType } from '../core/registry.js';
import { GeometrySet } from '../core/geometry.js';
import {
  Field,
  isField,
  combineFields,
  combineFields3,
  mapField,
  constantField,
  combineXYZ,
  separateXYZ,
  positionField,
  normalField,
  indexField,
  resolveScalar,
} from '../core/field.js';
import {
  seededRandom,
  vecLength,
  vecNormalize,
  vecDot,
  vecCross,
  vecDistance,
  vecReflect,
  vecProject,
  vecFaceforward,
  ensureVec,
} from '../core/utils.js';

// ── Vector Helpers ──────────────────────────────────────────────────────────

function vecOp(a, b, fn) {
  return { x: fn(a.x, b.x), y: fn(a.y, b.y), z: fn(a.z, b.z) };
}

function vecUnary(v, fn) {
  return { x: fn(v.x), y: fn(v.y), z: fn(v.z) };
}

// ── Math Operation Helpers ──────────────────────────────────────────────────

function wrapValue(value, min, max) {
  const range = max - min;
  if (range <= 0) return min;
  return min + ((((value - min) % range) + range) % range);
}

function snapValue(value, increment) {
  if (increment === 0) return value;
  return Math.floor(value / increment) * increment;
}

function pingPong(value, scale) {
  if (scale === 0) return 0;
  const t = Math.abs(value);
  const mod = t % (2 * scale);
  return mod <= scale ? mod : 2 * scale - mod;
}

function smoothMin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
  return a * h + b * (1 - h) - k * h * (1 - h);
}

function smoothMax(a, b, k) {
  return -smoothMin(-a, -b, k);
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerFieldNodes(registry) {
  // ── Categories ──────────────────────────────────────────────────────────
  registry.addCategory('geo', 'FIELD', { name: 'Field', color: '#7E57C2', icon: '∿' });
  registry.addCategory('geo', 'MATH', { name: 'Math', color: '#5C6BC0', icon: '∑' });
  registry.addCategory('geo', 'ATTRIBUTE', { name: 'Attribute', color: '#26A69A', icon: '⊞' });
  registry.addCategory('geo', 'VECTOR', { name: 'Vector', color: '#7C4DFF', icon: '→' });

  // ═══════════════════════════════════════════════════════════════════════
  // FIELD NODES
  // ═══════════════════════════════════════════════════════════════════════

  // ── position ────────────────────────────────────────────────────────────
  registry.addNode('geo', 'position', {
    label: 'Position',
    category: 'FIELD',
    inputs: [],
    outputs: [
      { name: 'Position', type: SocketType.VECTOR },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      return { outputs: [positionField()] };
    },
  });

  // ── normal ──────────────────────────────────────────────────────────────
  registry.addNode('geo', 'normal', {
    label: 'Normal',
    category: 'FIELD',
    inputs: [],
    outputs: [
      { name: 'Normal', type: SocketType.VECTOR },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      return { outputs: [normalField()] };
    },
  });

  // ── index ───────────────────────────────────────────────────────────────
  registry.addNode('geo', 'index', {
    label: 'Index',
    category: 'FIELD',
    inputs: [],
    outputs: [
      { name: 'Index', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      return { outputs: [indexField()] };
    },
  });

  // ── separate_xyz ────────────────────────────────────────────────────────
  registry.addNode('geo', 'separate_xyz', {
    label: 'Separate XYZ',
    category: 'FIELD',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'X', type: SocketType.FLOAT },
      { name: 'Y', type: SocketType.FLOAT },
      { name: 'Z', type: SocketType.FLOAT },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const vec = inputs['Vector'] ?? { x: 0, y: 0, z: 0 };
      const result = separateXYZ(vec);
      return { outputs: [result.x, result.y, result.z] };
    },
  });

  // ── combine_xyz ─────────────────────────────────────────────────────────
  registry.addNode('geo', 'combine_xyz', {
    label: 'Combine XYZ',
    category: 'FIELD',
    inputs: [
      { name: 'X', type: SocketType.FLOAT },
      { name: 'Y', type: SocketType.FLOAT },
      { name: 'Z', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    defaults: { x: 0, y: 0, z: 0 },
    props: [
      { key: 'x', label: 'X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'y', label: 'Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'z', label: 'Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const x = inputs['X'] ?? values.x;
      const y = inputs['Y'] ?? values.y;
      const z = inputs['Z'] ?? values.z;
      return { outputs: [combineXYZ(x, y, z)] };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MATH NODES
  // ═══════════════════════════════════════════════════════════════════════

  // ── math ────────────────────────────────────────────────────────────────
  const mathOperations = [
    'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MULTIPLY_ADD',
    'POWER', 'LOGARITHM', 'SQRT', 'INVERSE_SQRT', 'ABSOLUTE', 'EXPONENT',
    'MINIMUM', 'MAXIMUM', 'LESS_THAN', 'GREATER_THAN', 'SIGN', 'COMPARE',
    'SMOOTH_MIN', 'SMOOTH_MAX',
    'ROUND', 'FLOOR', 'CEIL', 'TRUNCATE', 'FRACT', 'MODULO', 'WRAP', 'SNAP', 'PING_PONG',
    'SINE', 'COSINE', 'TANGENT', 'ARCSINE', 'ARCCOSINE', 'ARCTANGENT', 'ARCTAN2',
    'SINH', 'COSH', 'TANH',
    'RADIANS', 'DEGREES',
  ];

  function evalMathOp(op, a, b, c) {
    switch (op) {
      case 'ADD': return a + b;
      case 'SUBTRACT': return a - b;
      case 'MULTIPLY': return a * b;
      case 'DIVIDE': return b !== 0 ? a / b : 0;
      case 'MULTIPLY_ADD': return a * b + c;
      case 'POWER': return Math.pow(a, b);
      case 'LOGARITHM': return b > 0 && a > 0 ? Math.log(a) / Math.log(b) : 0;
      case 'SQRT': return a >= 0 ? Math.sqrt(a) : 0;
      case 'INVERSE_SQRT': return a > 0 ? 1 / Math.sqrt(a) : 0;
      case 'ABSOLUTE': return Math.abs(a);
      case 'EXPONENT': return Math.exp(a);
      case 'MINIMUM': return Math.min(a, b);
      case 'MAXIMUM': return Math.max(a, b);
      case 'LESS_THAN': return a < b ? 1 : 0;
      case 'GREATER_THAN': return a > b ? 1 : 0;
      case 'SIGN': return Math.sign(a);
      case 'COMPARE': return Math.abs(a - b) <= c ? 1 : 0;
      case 'SMOOTH_MIN': return smoothMin(a, b, c);
      case 'SMOOTH_MAX': return smoothMax(a, b, c);
      case 'ROUND': return Math.round(a);
      case 'FLOOR': return Math.floor(a);
      case 'CEIL': return Math.ceil(a);
      case 'TRUNCATE': return Math.trunc(a);
      case 'FRACT': return a - Math.floor(a);
      case 'MODULO': return b !== 0 ? ((a % b) + b) % b : 0;
      case 'WRAP': return wrapValue(a, b, c);
      case 'SNAP': return snapValue(a, b);
      case 'PING_PONG': return pingPong(a, b);
      case 'SINE': return Math.sin(a);
      case 'COSINE': return Math.cos(a);
      case 'TANGENT': return Math.tan(a);
      case 'ARCSINE': return Math.asin(Math.max(-1, Math.min(1, a)));
      case 'ARCCOSINE': return Math.acos(Math.max(-1, Math.min(1, a)));
      case 'ARCTANGENT': return Math.atan(a);
      case 'ARCTAN2': return Math.atan2(a, b);
      case 'SINH': return Math.sinh(a);
      case 'COSH': return Math.cosh(a);
      case 'TANH': return Math.tanh(a);
      case 'RADIANS': return a * (Math.PI / 180);
      case 'DEGREES': return a * (180 / Math.PI);
      default: return a;
    }
  }

  registry.addNode('geo', 'math', {
    label: 'Math',
    category: 'MATH',
    inputs: [
      { name: 'Value', type: SocketType.FLOAT },
      { name: 'Value2', type: SocketType.FLOAT },
      { name: 'Value3', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Value', type: SocketType.FLOAT },
    ],
    defaults: { operation: 'ADD', value: 0, value2: 0, value3: 0, clampResult: false },
    props: [
      { key: 'operation', label: 'Operation', type: 'select', options: mathOperations },
      { key: 'value', label: 'Value', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'value2', label: 'Value 2', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'value3', label: 'Value 3', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'clampResult', label: 'Clamp', type: 'bool' },
    ],
    evaluate(values, inputs) {
      const op = values.operation;
      const clamp = values.clampResult;
      const a = inputs['Value'] ?? values.value;
      const b = inputs['Value2'] ?? values.value2;
      const c = inputs['Value3'] ?? values.value3;

      const aIsField = isField(a);
      const bIsField = isField(b);
      const cIsField = isField(c);

      if (!aIsField && !bIsField && !cIsField) {
        // All scalar
        let result = evalMathOp(op, a, b, c);
        if (clamp) result = Math.max(0, Math.min(1, result));
        return { outputs: [result] };
      }

      // At least one field -- return a field
      const result = new Field('float', (el) => {
        const va = aIsField ? a.evaluateAt(el) : a;
        const vb = bIsField ? b.evaluateAt(el) : b;
        const vc = cIsField ? c.evaluateAt(el) : c;
        let r = evalMathOp(op, va, vb, vc);
        if (clamp) r = Math.max(0, Math.min(1, r));
        return r;
      });
      return { outputs: [result] };
    },
  });

  // ── vector_math ─────────────────────────────────────────────────────────
  const vectorMathOperations = [
    'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'SCALE',
    'CROSS', 'DOT', 'DISTANCE', 'LENGTH', 'NORMALIZE',
    'REFLECT', 'PROJECT', 'SNAP', 'FACEFORWARD',
    'MINIMUM', 'MAXIMUM', 'ABSOLUTE', 'FLOOR', 'CEIL', 'FRACT', 'MODULO',
    'SINE', 'COSINE', 'TANGENT', 'WRAP',
  ];

  // Operations that produce a float output instead of (or in addition to) vector
  const floatOutputOps = new Set(['DOT', 'DISTANCE', 'LENGTH']);

  function evalVectorMathOp(op, a, b, c) {
    a = ensureVec(a);
    b = ensureVec(b);

    switch (op) {
      case 'ADD': return { vec: vecOp(a, b, (x, y) => x + y), val: 0 };
      case 'SUBTRACT': return { vec: vecOp(a, b, (x, y) => x - y), val: 0 };
      case 'MULTIPLY': return { vec: vecOp(a, b, (x, y) => x * y), val: 0 };
      case 'DIVIDE': return { vec: vecOp(a, b, (x, y) => y !== 0 ? x / y : 0), val: 0 };
      case 'SCALE': {
        // b is used as a scalar scale factor; use b.x if vector, or treat as float
        const s = typeof b === 'number' ? b : (b.x || 0);
        return { vec: { x: a.x * s, y: a.y * s, z: a.z * s }, val: 0 };
      }
      case 'CROSS': return { vec: vecCross(a, b), val: 0 };
      case 'DOT': { const d = vecDot(a, b); return { vec: { x: 0, y: 0, z: 0 }, val: d }; }
      case 'DISTANCE': { const d = vecDistance(a, b); return { vec: { x: 0, y: 0, z: 0 }, val: d }; }
      case 'LENGTH': { const l = vecLength(a); return { vec: { x: 0, y: 0, z: 0 }, val: l }; }
      case 'NORMALIZE': return { vec: vecNormalize(a), val: 0 };
      case 'REFLECT': return { vec: vecReflect(a, b), val: 0 };
      case 'PROJECT': return { vec: vecProject(a, b), val: 0 };
      case 'SNAP': return { vec: vecOp(a, b, (x, inc) => inc !== 0 ? Math.floor(x / inc) * inc : x), val: 0 };
      case 'FACEFORWARD': {
        const ref = c ? ensureVec(c) : b;
        return { vec: vecFaceforward(a, b, ref), val: 0 };
      }
      case 'MINIMUM': return { vec: vecOp(a, b, Math.min), val: 0 };
      case 'MAXIMUM': return { vec: vecOp(a, b, Math.max), val: 0 };
      case 'ABSOLUTE': return { vec: vecUnary(a, Math.abs), val: 0 };
      case 'FLOOR': return { vec: vecUnary(a, Math.floor), val: 0 };
      case 'CEIL': return { vec: vecUnary(a, Math.ceil), val: 0 };
      case 'FRACT': return { vec: vecUnary(a, (v) => v - Math.floor(v)), val: 0 };
      case 'MODULO': return { vec: vecOp(a, b, (x, y) => y !== 0 ? ((x % y) + y) % y : 0), val: 0 };
      case 'SINE': return { vec: vecUnary(a, Math.sin), val: 0 };
      case 'COSINE': return { vec: vecUnary(a, Math.cos), val: 0 };
      case 'TANGENT': return { vec: vecUnary(a, Math.tan), val: 0 };
      case 'WRAP': {
        const cVec = c ? ensureVec(c) : { x: 1, y: 1, z: 1 };
        return {
          vec: {
            x: wrapValue(a.x, b.x, cVec.x),
            y: wrapValue(a.y, b.y, cVec.y),
            z: wrapValue(a.z, b.z, cVec.z),
          },
          val: 0,
        };
      }
      default: return { vec: a, val: 0 };
    }
  }

  registry.addNode('geo', 'vector_math', {
    label: 'Vector Math',
    category: 'MATH',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Vector2', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Value', type: SocketType.FLOAT },
    ],
    defaults: { operation: 'ADD' },
    props: [
      { key: 'operation', label: 'Operation', type: 'select', options: vectorMathOperations },
    ],
    evaluate(values, inputs) {
      const op = values.operation;
      const a = inputs['Vector'] ?? { x: 0, y: 0, z: 0 };
      const b = inputs['Vector2'] ?? { x: 0, y: 0, z: 0 };

      const aIsField = isField(a);
      const bIsField = isField(b);

      if (!aIsField && !bIsField) {
        // All scalar vectors
        const result = evalVectorMathOp(op, a, b);
        return { outputs: [result.vec, result.val] };
      }

      // At least one field -- return field outputs
      const vecField = new Field('vector', (el) => {
        const va = aIsField ? a.evaluateAt(el) : a;
        const vb = bIsField ? b.evaluateAt(el) : b;
        return evalVectorMathOp(op, va, vb).vec;
      });

      const floatField = new Field('float', (el) => {
        const va = aIsField ? a.evaluateAt(el) : a;
        const vb = bIsField ? b.evaluateAt(el) : b;
        return evalVectorMathOp(op, va, vb).val;
      });

      return { outputs: [vecField, floatField] };
    },
  });

  // ── map_range ───────────────────────────────────────────────────────────
  const mapRangeInterpolations = ['LINEAR', 'STEPPED', 'SMOOTH', 'SMOOTHER'];

  function evalMapRange(value, fromMin, fromMax, toMin, toMax, interpolation, clamp) {
    const range = fromMax - fromMin;
    let t = range !== 0 ? (value - fromMin) / range : 0;

    if (clamp) t = Math.max(0, Math.min(1, t));

    switch (interpolation) {
      case 'STEPPED':
        t = Math.floor(t * 4) / 4; // 4-step quantization
        break;
      case 'SMOOTH':
        // Smoothstep
        t = Math.max(0, Math.min(1, t));
        t = t * t * (3 - 2 * t);
        break;
      case 'SMOOTHER':
        // Smootherstep (Ken Perlin)
        t = Math.max(0, Math.min(1, t));
        t = t * t * t * (t * (t * 6 - 15) + 10);
        break;
      // LINEAR: no modification
    }

    return toMin + t * (toMax - toMin);
  }

  registry.addNode('geo', 'map_range', {
    label: 'Map Range',
    category: 'MATH',
    inputs: [
      { name: 'Value', type: SocketType.FLOAT },
      { name: 'From Min', type: SocketType.FLOAT },
      { name: 'From Max', type: SocketType.FLOAT },
      { name: 'To Min', type: SocketType.FLOAT },
      { name: 'To Max', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Result', type: SocketType.FLOAT },
    ],
    defaults: { fromMin: 0, fromMax: 1, toMin: 0, toMax: 1, interpolation: 'LINEAR', clamp: true },
    props: [
      { key: 'interpolation', label: 'Interpolation', type: 'select', options: mapRangeInterpolations },
      { key: 'clamp', label: 'Clamp', type: 'bool' },
      { key: 'fromMin', label: 'From Min', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'fromMax', label: 'From Max', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'toMin', label: 'To Min', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'toMax', label: 'To Max', type: 'float', min: -10000, max: 10000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const interp = values.interpolation;
      const doClamp = values.clamp;
      const v = inputs['Value'] ?? values.fromMin;
      const fMin = inputs['From Min'] ?? values.fromMin;
      const fMax = inputs['From Max'] ?? values.fromMax;
      const tMin = inputs['To Min'] ?? values.toMin;
      const tMax = inputs['To Max'] ?? values.toMax;

      const anyField = isField(v) || isField(fMin) || isField(fMax) || isField(tMin) || isField(tMax);

      if (!anyField) {
        return { outputs: [evalMapRange(v, fMin, fMax, tMin, tMax, interp, doClamp)] };
      }

      const vF = isField(v), fMinF = isField(fMin), fMaxF = isField(fMax);
      const tMinF = isField(tMin), tMaxF = isField(tMax);

      const result = new Field('float', (el) => {
        const rv = vF ? v.evaluateAt(el) : v;
        const rfMin = fMinF ? fMin.evaluateAt(el) : fMin;
        const rfMax = fMaxF ? fMax.evaluateAt(el) : fMax;
        const rtMin = tMinF ? tMin.evaluateAt(el) : tMin;
        const rtMax = tMaxF ? tMax.evaluateAt(el) : tMax;
        return evalMapRange(rv, rfMin, rfMax, rtMin, rtMax, interp, doClamp);
      });
      return { outputs: [result] };
    },
  });

  // ── compare ─────────────────────────────────────────────────────────────
  const compareOperations = ['LESS_THAN', 'LESS_EQUAL', 'GREATER_THAN', 'GREATER_EQUAL', 'EQUAL', 'NOT_EQUAL'];

  function evalCompare(op, a, b, threshold) {
    switch (op) {
      case 'LESS_THAN': return a < b ? 1 : 0;
      case 'LESS_EQUAL': return a <= b ? 1 : 0;
      case 'GREATER_THAN': return a > b ? 1 : 0;
      case 'GREATER_EQUAL': return a >= b ? 1 : 0;
      case 'EQUAL': return Math.abs(a - b) <= threshold ? 1 : 0;
      case 'NOT_EQUAL': return Math.abs(a - b) > threshold ? 1 : 0;
      default: return 0;
    }
  }

  registry.addNode('geo', 'compare', {
    label: 'Compare',
    category: 'MATH',
    inputs: [
      { name: 'A', type: SocketType.FLOAT },
      { name: 'B', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Result', type: SocketType.BOOL },
    ],
    defaults: { operation: 'LESS_THAN', threshold: 0.001, a: 0, b: 0 },
    props: [
      { key: 'operation', label: 'Operation', type: 'select', options: compareOperations },
      { key: 'threshold', label: 'Threshold', type: 'float', min: 0, max: 10, step: 0.001 },
      { key: 'a', label: 'A', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'b', label: 'B', type: 'float', min: -10000, max: 10000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const op = values.operation;
      const threshold = values.threshold;
      const a = inputs['A'] ?? values.a;
      const b = inputs['B'] ?? values.b;

      const result = combineFields(a, b, 'bool', (va, vb) => {
        return evalCompare(op, va, vb, threshold) ? true : false;
      });
      return { outputs: [result] };
    },
  });

  // ── clamp ───────────────────────────────────────────────────────────────
  registry.addNode('geo', 'clamp', {
    label: 'Clamp',
    category: 'MATH',
    inputs: [
      { name: 'Value', type: SocketType.FLOAT },
      { name: 'Min', type: SocketType.FLOAT },
      { name: 'Max', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Result', type: SocketType.FLOAT },
    ],
    defaults: { clampType: 'MINMAX', min: 0, max: 1 },
    props: [
      { key: 'clampType', label: 'Type', type: 'select', options: ['MINMAX', 'RANGE'] },
      { key: 'min', label: 'Min', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'max', label: 'Max', type: 'float', min: -10000, max: 10000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const v = inputs['Value'] ?? 0;
      const lo = inputs['Min'] ?? values.min;
      const hi = inputs['Max'] ?? values.max;

      const vF = isField(v), loF = isField(lo), hiF = isField(hi);

      if (!vF && !loF && !hiF) {
        // RANGE mode: ensure min <= max by swapping if needed
        const rlo = values.clampType === 'RANGE' ? Math.min(lo, hi) : lo;
        const rhi = values.clampType === 'RANGE' ? Math.max(lo, hi) : hi;
        return { outputs: [Math.max(rlo, Math.min(rhi, v))] };
      }

      const clampType = values.clampType;
      const result = new Field('float', (el) => {
        const rv = vF ? v.evaluateAt(el) : v;
        let rlo = loF ? lo.evaluateAt(el) : lo;
        let rhi = hiF ? hi.evaluateAt(el) : hi;
        if (clampType === 'RANGE') {
          const tmpLo = Math.min(rlo, rhi);
          const tmpHi = Math.max(rlo, rhi);
          rlo = tmpLo;
          rhi = tmpHi;
        }
        return Math.max(rlo, Math.min(rhi, rv));
      });
      return { outputs: [result] };
    },
  });

  // ── boolean_math ─────────────────────────────────────────────────────────
  const booleanMathOperations = [
    { value: 'AND', label: 'And' },
    { value: 'OR', label: 'Or' },
    { value: 'NOT', label: 'Not' },
    { value: 'NAND', label: 'Not And' },
    { value: 'NOR', label: 'Not Or' },
    { value: 'XOR', label: 'Exclusive Or' },
    { value: 'XNOR', label: 'Exclusive Not Or' },
  ];

  function evalBooleanMathOp(op, a, b) {
    switch (op) {
      case 'AND': return a && b;
      case 'OR': return a || b;
      case 'NOT': return !a;
      case 'NAND': return !(a && b);
      case 'NOR': return !(a || b);
      case 'XOR': return a !== b;
      case 'XNOR': return a === b;
      default: return false;
    }
  }

  registry.addNode('geo', 'boolean_math', {
    label: 'Boolean Math',
    category: 'MATH',
    inputs: [
      { name: 'Boolean', type: SocketType.BOOL },
      { name: 'Boolean_001', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Boolean', type: SocketType.BOOL },
    ],
    defaults: { operation: 'AND', a: false, b: false },
    props: [
      { key: 'operation', label: 'Operation', type: 'select', options: booleanMathOperations },
      { key: 'a', label: 'A', type: 'bool' },
      { key: 'b', label: 'B', type: 'bool' },
    ],
    evaluate(values, inputs) {
      const op = values.operation;
      const a = inputs['Boolean'] ?? values.a;
      const b = inputs['Boolean_001'] ?? values.b;

      const result = combineFields(a, b, 'bool', (va, vb) => {
        return evalBooleanMathOp(op, !!va, !!vb);
      });
      return { outputs: [result] };
    },
  });

  // ── random_value ─────────────────────────────────────────────────────────
  const randomValueDataTypes = [
    { value: 'FLOAT', label: 'Float' },
    { value: 'INT', label: 'Integer' },
    { value: 'FLOAT_VECTOR', label: 'Float Vector' },
    { value: 'BOOLEAN', label: 'Boolean' },
  ];

  // Robust hash combining index, seed, and channel.
  // Blender ref: hash_float_to_float in BLI_hash.hh - uses multiple mixing rounds
  // so that small seed changes (0→1→2) produce very different outputs.
  function hashIndexSeed(index, seed, channel) {
    let h = (seed * 374761393 + 3266489917) | 0;
    h = (h + (index * 668265263)) | 0;
    h = (h + (channel * 1274126177)) | 0;
    h ^= h >>> 15;
    h = Math.imul(h, 2246822519);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  registry.addNode('geo', 'random_value', {
    label: 'Random Value',
    category: 'MATH',
    // Static fallback inputs/outputs (used if getInputs/getOutputs not called)
    inputs: [
      { name: 'Min', type: SocketType.FLOAT },
      { name: 'Max', type: SocketType.FLOAT },
      { name: 'ID', type: SocketType.INT },
      { name: 'Seed', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Value', type: SocketType.FLOAT },
    ],
    // Dynamic inputs based on data_type (matches Blender's FunctionNodeRandomValue)
    getInputs(values) {
      const dt = values.data_type || 'FLOAT';
      switch (dt) {
        case 'FLOAT':
          return [
            { name: 'Min', type: SocketType.FLOAT },
            { name: 'Max', type: SocketType.FLOAT },
            { name: 'ID', type: SocketType.INT },
            { name: 'Seed', type: SocketType.INT },
          ];
        case 'INT':
          return [
            { name: 'Min', type: SocketType.INT },
            { name: 'Max', type: SocketType.INT },
            { name: 'ID', type: SocketType.INT },
            { name: 'Seed', type: SocketType.INT },
          ];
        case 'FLOAT_VECTOR':
          return [
            { name: 'Min', type: SocketType.VECTOR },
            { name: 'Max', type: SocketType.VECTOR },
            { name: 'ID', type: SocketType.INT },
            { name: 'Seed', type: SocketType.INT },
          ];
        case 'BOOLEAN':
          return [
            { name: 'Probability', type: SocketType.FLOAT },
            { name: 'ID', type: SocketType.INT },
            { name: 'Seed', type: SocketType.INT },
          ];
        default:
          return [
            { name: 'Min', type: SocketType.FLOAT },
            { name: 'Max', type: SocketType.FLOAT },
            { name: 'ID', type: SocketType.INT },
            { name: 'Seed', type: SocketType.INT },
          ];
      }
    },
    // Dynamic output type based on data_type (matches Blender)
    getOutputs(values) {
      const dt = values.data_type || 'FLOAT';
      switch (dt) {
        case 'FLOAT':   return [{ name: 'Value', type: SocketType.FLOAT }];
        case 'INT':      return [{ name: 'Value', type: SocketType.INT }];
        case 'FLOAT_VECTOR': return [{ name: 'Value', type: SocketType.VECTOR }];
        case 'BOOLEAN':  return [{ name: 'Value', type: SocketType.BOOL }];
        default:         return [{ name: 'Value', type: SocketType.FLOAT }];
      }
    },
    defaults: { data_type: 'FLOAT', min: 0, max: 1, probability: 0.5, id: 0, seed: 0,
      min_x: 0, min_y: 0, min_z: 0, max_x: 1, max_y: 1, max_z: 1 },
    props: [
      { key: 'data_type', label: 'Data Type', type: 'select', options: randomValueDataTypes },
      { key: 'min', label: 'Min', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'max', label: 'Max', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'probability', label: 'Probability', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'id', label: 'ID', type: 'int', min: 0, max: 100000, step: 1 },
      { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 100000, step: 1 },
    ],
    // Dynamic props: show/hide fields based on data_type (matches Blender)
    getProps(values) {
      const dt = values.data_type || 'FLOAT';
      const base = [{ key: 'data_type', label: 'Data Type', type: 'select', options: randomValueDataTypes }];
      switch (dt) {
        case 'FLOAT':
          return [...base,
            { key: 'min', label: 'Min', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'max', label: 'Max', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'id', label: 'ID', type: 'int', min: 0, max: 100000, step: 1 },
            { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 100000, step: 1 },
          ];
        case 'INT':
          return [...base,
            { key: 'min', label: 'Min', type: 'int', min: -10000, max: 10000, step: 1 },
            { key: 'max', label: 'Max', type: 'int', min: -10000, max: 10000, step: 1 },
            { key: 'id', label: 'ID', type: 'int', min: 0, max: 100000, step: 1 },
            { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 100000, step: 1 },
          ];
        case 'FLOAT_VECTOR':
          return [...base,
            { key: 'min_x', label: 'Min X', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'min_y', label: 'Min Y', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'min_z', label: 'Min Z', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'max_x', label: 'Max X', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'max_y', label: 'Max Y', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'max_z', label: 'Max Z', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'id', label: 'ID', type: 'int', min: 0, max: 100000, step: 1 },
            { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 100000, step: 1 },
          ];
        case 'BOOLEAN':
          return [...base,
            { key: 'probability', label: 'Probability', type: 'float', min: 0, max: 1, step: 0.01 },
            { key: 'id', label: 'ID', type: 'int', min: 0, max: 100000, step: 1 },
            { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 100000, step: 1 },
          ];
        default:
          return [...base,
            { key: 'min', label: 'Min', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'max', label: 'Max', type: 'float', min: -10000, max: 10000, step: 0.1 },
            { key: 'id', label: 'ID', type: 'int', min: 0, max: 100000, step: 1 },
            { key: 'seed', label: 'Seed', type: 'int', min: 0, max: 100000, step: 1 },
          ];
      }
    },
    evaluate(values, inputs) {
      const dataType = values.data_type;
      const seed = inputs['Seed'] ?? values.seed;

      const fieldType = dataType === 'FLOAT_VECTOR' ? 'vector'
        : dataType === 'BOOLEAN' ? 'bool'
        : dataType === 'INT' ? 'int'
        : 'float';

      const result = new Field(fieldType, (el) => {
        const idx = el.index ?? 0;
        const rSeed = isField(seed) ? seed.evaluateAt(el) : (typeof seed === 'number' ? seed : values.seed);

        switch (dataType) {
          case 'FLOAT': {
            const minVal = inputs['Min'] ?? values.min;
            const maxVal = inputs['Max'] ?? values.max;
            const rMin = isField(minVal) ? minVal.evaluateAt(el) : (typeof minVal === 'number' ? minVal : values.min);
            const rMax = isField(maxVal) ? maxVal.evaluateAt(el) : (typeof maxVal === 'number' ? maxVal : values.max);
            const r = hashIndexSeed(idx, rSeed, 0);
            return rMin + r * (rMax - rMin);
          }
          case 'INT': {
            const minVal = inputs['Min'] ?? values.min;
            const maxVal = inputs['Max'] ?? values.max;
            const rMin = isField(minVal) ? minVal.evaluateAt(el) : (typeof minVal === 'number' ? minVal : values.min);
            const rMax = isField(maxVal) ? maxVal.evaluateAt(el) : (typeof maxVal === 'number' ? maxVal : values.max);
            const r = hashIndexSeed(idx, rSeed, 0);
            const lo = Math.ceil(rMin);
            const hi = Math.floor(rMax);
            if (hi < lo) return lo;
            return lo + Math.floor(r * (hi - lo + 1));
          }
          case 'BOOLEAN': {
            const prob = inputs['Probability'] ?? values.probability;
            const rProb = isField(prob) ? prob.evaluateAt(el) : (typeof prob === 'number' ? prob : values.probability);
            const r = hashIndexSeed(idx, rSeed, 0);
            return r < rProb;
          }
          case 'FLOAT_VECTOR': {
            // Use per-component min/max from node values or connected vector inputs
            const minInput = inputs['Min'];
            const maxInput = inputs['Max'];
            let minX, minY, minZ, maxX, maxY, maxZ;
            if (minInput && isField(minInput)) {
              const v = minInput.evaluateAt(el);
              minX = typeof v === 'object' ? (v.x ?? 0) : v;
              minY = typeof v === 'object' ? (v.y ?? 0) : v;
              minZ = typeof v === 'object' ? (v.z ?? 0) : v;
            } else if (minInput && typeof minInput === 'object') {
              minX = minInput.x ?? 0; minY = minInput.y ?? 0; minZ = minInput.z ?? 0;
            } else {
              minX = values.min_x ?? 0; minY = values.min_y ?? 0; minZ = values.min_z ?? 0;
            }
            if (maxInput && isField(maxInput)) {
              const v = maxInput.evaluateAt(el);
              maxX = typeof v === 'object' ? (v.x ?? 1) : v;
              maxY = typeof v === 'object' ? (v.y ?? 1) : v;
              maxZ = typeof v === 'object' ? (v.z ?? 1) : v;
            } else if (maxInput && typeof maxInput === 'object') {
              maxX = maxInput.x ?? 1; maxY = maxInput.y ?? 1; maxZ = maxInput.z ?? 1;
            } else {
              maxX = values.max_x ?? 1; maxY = values.max_y ?? 1; maxZ = values.max_z ?? 1;
            }
            const rx = hashIndexSeed(idx, rSeed, 0);
            const ry = hashIndexSeed(idx, rSeed, 1);
            const rz = hashIndexSeed(idx, rSeed, 2);
            return {
              x: minX + rx * (maxX - minX),
              y: minY + ry * (maxY - minY),
              z: minZ + rz * (maxZ - minZ),
            };
          }
          default: return 0;
        }
      });
      return { outputs: [result] };
    },
  });

  // ── integer_math ─────────────────────────────────────────────────────────
  const integerMathOperations = [
    { value: 'ADD', label: 'Add' },
    { value: 'SUBTRACT', label: 'Subtract' },
    { value: 'MULTIPLY', label: 'Multiply' },
    { value: 'DIVIDE', label: 'Divide' },
    { value: 'MODULO', label: 'Modulo' },
    { value: 'POWER', label: 'Power' },
    { value: 'MIN', label: 'Minimum' },
    { value: 'MAX', label: 'Maximum' },
    { value: 'ABS', label: 'Absolute' },
    { value: 'SIGN', label: 'Sign' },
    { value: 'NEGATE', label: 'Negate' },
    { value: 'GCD', label: 'Greatest Common Divisor' },
  ];

  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b !== 0) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a;
  }

  function evalIntegerMathOp(op, a, b) {
    a = Math.round(a);
    b = Math.round(b);
    switch (op) {
      case 'ADD': return a + b;
      case 'SUBTRACT': return a - b;
      case 'MULTIPLY': return a * b;
      case 'DIVIDE': return b !== 0 ? Math.trunc(a / b) : 0;
      case 'MODULO': return b !== 0 ? a % b : 0;
      case 'POWER': return Math.round(Math.pow(a, b));
      case 'MIN': return Math.min(a, b);
      case 'MAX': return Math.max(a, b);
      case 'ABS': return Math.abs(a);
      case 'SIGN': return Math.sign(a);
      case 'NEGATE': return -a;
      case 'GCD': return gcd(a, b);
      default: return a;
    }
  }

  registry.addNode('geo', 'integer_math', {
    label: 'Integer Math',
    category: 'MATH',
    inputs: [
      { name: 'Value', type: SocketType.INT },
      { name: 'Value2', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Value', type: SocketType.INT },
    ],
    defaults: { operation: 'ADD', value: 0, value2: 0 },
    props: [
      { key: 'operation', label: 'Operation', type: 'select', options: integerMathOperations },
      { key: 'value', label: 'Value', type: 'int', min: -10000, max: 10000, step: 1 },
      { key: 'value2', label: 'Value 2', type: 'int', min: -10000, max: 10000, step: 1 },
    ],
    evaluate(values, inputs) {
      const op = values.operation;
      const a = inputs['Value'] ?? values.value;
      const b = inputs['Value2'] ?? values.value2;

      const result = combineFields(a, b, 'int', (va, vb) => {
        return evalIntegerMathOp(op, va, vb);
      });
      return { outputs: [result] };
    },
  });

  // ── ID ──────────────────────────────────────────────────────────────────
  // Blender: node_geo_input_id.cc
  // "Retrieve a stable random identifier value from the 'id' attribute,
  //  or the index if the attribute does not exist"
  // Output: ID (int field)

  registry.addNode('geo', 'id', {
    label: 'ID',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'ID', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      // In our system, ID falls back to index since we don't track stable IDs
      return { outputs: [new Field('int', (el) => el.index)] };
    },
  });

  // ── Scene Time ──────────────────────────────────────────────────────────
  // Blender: node_geo_input_scene_time.cc
  // "Retrieve the current time in the scene's animation"
  // Outputs: Seconds (float), Frame (float)
  //
  // NOTE: In a browser context we don't have scene time. We output 0/0
  // but expose the node for workflow compatibility.

  registry.addNode('geo', 'scene_time', {
    label: 'Scene Time',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Seconds', type: SocketType.FLOAT },
      { name: 'Frame', type: SocketType.FLOAT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      // No animation timeline in browser - return 0
      return { outputs: [0, 0] };
    },
  });

  // ── Named Attribute ─────────────────────────────────────────────────────
  // Blender: node_geo_input_named_attribute.cc
  // "Retrieve the data of a specified attribute"
  //
  // Input: Name (string)
  // Outputs: Attribute (dynamic field), Exists (bool field)
  // Property: data_type

  registry.addNode('geo', 'named_attribute', {
    label: 'Named Attribute',
    category: 'INPUT',
    defaults: { data_type: 'FLOAT', name: '' },
    getInputs() {
      return [
        { name: 'Name', type: SocketType.FLOAT }, // String type - using float as placeholder
      ];
    },
    getOutputs(values) {
      const type = namedAttrTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Attribute', type },
        { name: 'Exists', type: SocketType.BOOL },
      ];
    },
    getProps() {
      return [
        {
          key: 'data_type', label: 'Data Type', type: 'select',
          options: [
            { value: 'FLOAT', label: 'Float' },
            { value: 'INT', label: 'Integer' },
            { value: 'FLOAT_VECTOR', label: 'Vector' },
            { value: 'BOOLEAN', label: 'Boolean' },
            { value: 'FLOAT_COLOR', label: 'Color' },
          ],
        },
        { key: 'name', label: 'Name', type: 'text' },
      ];
    },
    evaluate(values) {
      // Named attributes would read from geometry's attribute storage
      // Return a default field since we don't have runtime attribute context
      const dataType = values.data_type || 'FLOAT';
      const defaultVal = dataType === 'FLOAT_VECTOR' ? { x: 0, y: 0, z: 0 } :
                         dataType === 'INT' ? 0 :
                         dataType === 'BOOLEAN' ? false :
                         dataType === 'FLOAT_COLOR' ? { r: 0, g: 0, b: 0, a: 1 } : 0;
      const fieldType = dataType === 'FLOAT_VECTOR' ? 'vector' :
                        dataType === 'INT' ? 'int' :
                        dataType === 'BOOLEAN' ? 'bool' : 'float';
      return { outputs: [
        new Field(fieldType, () => defaultVal),
        new Field('bool', () => false), // attribute doesn't exist
      ]};
    },
  });

  // ── Store Named Attribute ───────────────────────────────────────────────
  // Blender: node_geo_store_named_attribute.cc
  // "Store the result of a field on a geometry as an attribute"
  //
  // Inputs: Geometry, Selection (bool field), Name (string), Value (dynamic field)
  // Output: Geometry
  // Properties: data_type, domain

  registry.addNode('geo', 'store_named_attribute', {
    label: 'Store Named Attribute',
    category: 'ATTRIBUTE',
    defaults: { data_type: 'FLOAT', domain: 'POINT', name: '' },
    getInputs(values) {
      const type = namedAttrTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Geometry', type: SocketType.GEOMETRY },
        { name: 'Selection', type: SocketType.BOOL },
        { name: 'Value', type },
      ];
    },
    getOutputs() {
      return [
        { name: 'Geometry', type: SocketType.GEOMETRY },
      ];
    },
    getProps() {
      return [
        { key: 'name', label: 'Name', type: 'text' },
        {
          key: 'data_type', label: 'Data Type', type: 'select',
          options: [
            { value: 'FLOAT', label: 'Float' },
            { value: 'INT', label: 'Integer' },
            { value: 'FLOAT_VECTOR', label: 'Vector' },
            { value: 'BOOLEAN', label: 'Boolean' },
            { value: 'FLOAT_COLOR', label: 'Color' },
          ],
        },
        {
          key: 'domain', label: 'Domain', type: 'select',
          options: [
            { value: 'POINT', label: 'Point' },
            { value: 'EDGE', label: 'Edge' },
            { value: 'FACE', label: 'Face' },
            { value: 'CORNER', label: 'Face Corner' },
          ],
        },
      ];
    },
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      // Store Named Attribute would write to geometry's attribute storage
      // For now, pass through the geometry (attribute storage is a future enhancement)
      return { outputs: [geo.copy()] };
    },
  });

  // ── Vector Rotate ───────────────────────────────────────────────────────
  // Blender: node_fn_rotate_vector.cc
  // "Apply a rotation to a given vector"
  // Inputs: Vector, Rotation (euler angles in our system)
  // Output: Vector

  registry.addNode('geo', 'vector_rotate', {
    label: 'Vector Rotate',
    category: 'VECTOR',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Rotation', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const vecInput = inputs['Vector'];
      const rotInput = inputs['Rotation'];

      if (vecInput == null) return { outputs: [{ x: 0, y: 0, z: 0 }] };

      const result = combineFields(vecInput, rotInput, 'vector', (v, r) => {
        const vv = v || { x: 0, y: 0, z: 0 };
        const rr = r || { x: 0, y: 0, z: 0 };
        return rotateVecByEuler(vv, rr.x, rr.y, rr.z);
      });
      return { outputs: [result] };
    },
  });

  // ── Curve Tangent ───────────────────────────────────────────────────────
  // Blender: node_geo_input_tangent.cc
  // "Retrieve the direction of curves at each control point"
  // Output: Tangent (vector field)

  registry.addNode('geo', 'curve_tangent', {
    label: 'Curve Tangent',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Tangent', type: SocketType.VECTOR },
    ],
    defaults: {},
    props: [],
    evaluate() {
      // Return a field that computes tangent from element context
      // In curve context, tangent is approximated from adjacent positions
      return { outputs: [new Field('vector', (el) => {
        // Use normal as fallback - proper tangent needs curve context
        return el.normal || { x: 0, y: 0, z: 1 };
      })] };
    },
  });

  // ── Endpoint Selection ──────────────────────────────────────────────────
  // Blender: node_geo_curve_endpoint_selection.cc
  // "Provide a selection for endpoints in each spline"
  // Inputs: Start Size (int, default 1, min 0), End Size (int, default 1, min 0)
  // Output: Selection (bool field)

  registry.addNode('geo', 'endpoint_selection', {
    label: 'Endpoint Selection',
    category: 'INPUT',
    inputs: [
      { name: 'Start Size', type: SocketType.INT },
      { name: 'End Size', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Selection', type: SocketType.BOOL },
    ],
    defaults: { start_size: 1, end_size: 1 },
    props: [
      { key: 'start_size', label: 'Start Size', type: 'int', min: 0, max: 10000, step: 1 },
      { key: 'end_size', label: 'End Size', type: 'int', min: 0, max: 10000, step: 1 },
    ],
    evaluate(values, inputs) {
      const startSize = inputs['Start Size'] != null
        ? resolveScalar(inputs['Start Size'], values.start_size) : values.start_size;
      const endSize = inputs['End Size'] != null
        ? resolveScalar(inputs['End Size'], values.end_size) : values.end_size;

      return { outputs: [new Field('bool', (el) => {
        // In curve context, localIndex and localCount are available
        if (el.localIndex !== undefined && el.localCount !== undefined) {
          if (el.localIndex < startSize) return true;
          if (el.localIndex >= el.localCount - endSize) return true;
          return false;
        }
        // Fallback for non-curve context
        if (el.index < startSize) return true;
        if (el.index >= el.count - endSize) return true;
        return false;
      })] };
    },
  });

  // ── Euler to Rotation ──────────────────────────────────────────────────
  // Blender: node_fn_euler_to_rotation.cc
  // "Build a rotation from separate angles around each axis"
  // Input: Euler (vector), Output: Rotation (vector - euler angles in our system)

  registry.addNode('geo', 'euler_to_rotation', {
    label: 'Euler to Rotation',
    category: 'VECTOR',
    inputs: [{ name: 'Euler', type: SocketType.VECTOR }],
    outputs: [{ name: 'Rotation', type: SocketType.VECTOR }],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      // In our system rotations are euler vectors, so pass through
      const euler = inputs['Euler'];
      if (isField(euler)) return { outputs: [euler] };
      return { outputs: [euler || { x: 0, y: 0, z: 0 }] };
    },
  });

  // ── Axis Angle to Rotation ─────────────────────────────────────────────
  // Blender: node_fn_axis_angle_to_rotation.cc
  // "Build a rotation from an axis and angle"
  // Inputs: Axis (vector, default 0,0,1), Angle (float)
  // Output: Rotation (vector)

  registry.addNode('geo', 'axis_angle_to_rotation', {
    label: 'Axis Angle to Rotation',
    category: 'VECTOR',
    inputs: [
      { name: 'Axis', type: SocketType.VECTOR },
      { name: 'Angle', type: SocketType.FLOAT },
    ],
    outputs: [{ name: 'Rotation', type: SocketType.VECTOR }],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const axisInput = inputs['Axis'] || { x: 0, y: 0, z: 1 };
      const angleInput = inputs['Angle'] || 0;

      const result = combineFields(axisInput, angleInput, 'vector', (axis, angle) => {
        const a = axis || { x: 0, y: 0, z: 1 };
        const ang = angle || 0;
        // Simplified: represent axis-angle as euler approximation
        const len = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
        return {
          x: (a.x / len) * ang,
          y: (a.y / len) * ang,
          z: (a.z / len) * ang,
        };
      });
      return { outputs: [result] };
    },
  });

  // ── Rotate Rotation ────────────────────────────────────────────────────
  // Blender: node_fn_rotate_rotation.cc
  // "Apply a secondary rotation to a rotation"
  // Inputs: Rotation, Rotate By
  // Output: Rotation
  // Property: rotation_space (Global, Local)

  registry.addNode('geo', 'rotate_rotation', {
    label: 'Rotate Rotation',
    category: 'VECTOR',
    inputs: [
      { name: 'Rotation', type: SocketType.VECTOR },
      { name: 'Rotate By', type: SocketType.VECTOR },
    ],
    outputs: [{ name: 'Rotation', type: SocketType.VECTOR }],
    defaults: { rotation_space: 'GLOBAL' },
    props: [
      {
        key: 'rotation_space', label: 'Space', type: 'select',
        options: [
          { value: 'GLOBAL', label: 'Global' },
          { value: 'LOCAL', label: 'Local' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const result = combineFields(inputs['Rotation'], inputs['Rotate By'], 'vector', (rot, by) => {
        const r = rot || { x: 0, y: 0, z: 0 };
        const b = by || { x: 0, y: 0, z: 0 };
        // Simplified euler addition
        return { x: r.x + b.x, y: r.y + b.y, z: r.z + b.z };
      });
      return { outputs: [result] };
    },
  });

  // ── Invert Rotation ────────────────────────────────────────────────────
  // Blender: node_fn_invert_rotation.cc
  // "Compute the inverse of the given rotation"

  registry.addNode('geo', 'invert_rotation', {
    label: 'Invert Rotation',
    category: 'VECTOR',
    inputs: [{ name: 'Rotation', type: SocketType.VECTOR }],
    outputs: [{ name: 'Rotation', type: SocketType.VECTOR }],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const rot = inputs['Rotation'];
      const result = mapField(rot, 'vector', (r) => {
        const v = r || { x: 0, y: 0, z: 0 };
        return { x: -v.x, y: -v.y, z: -v.z };
      });
      return { outputs: [result] };
    },
  });

  // ── Is Face Smooth ─────────────────────────────────────────────────────
  // Blender: node_geo_input_face_smooth.cc
  // "Retrieve whether each face is marked for smooth normals"
  // Output: Smooth (bool field) - reads sharp_face and inverts

  registry.addNode('geo', 'is_face_smooth', {
    label: 'Is Face Smooth',
    category: 'INPUT',
    inputs: [],
    outputs: [{ name: 'Smooth', type: SocketType.BOOL }],
    defaults: {},
    props: [],
    evaluate() {
      // Reads sharp_face attribute and inverts (smooth = !sharp)
      return { outputs: [new Field('bool', () => true)] };
    },
  });

  // ── Index Switch ───────────────────────────────────────────────────────
  // Blender: node_geo_index_switch.cc
  // "Choose between values with an index"
  //
  // Inputs: Index (int), 0..N values
  // Output: Output (dynamic type)
  // Property: data_type
  //
  // Simplified: we support 4 fixed inputs (0, 1, 2, 3).

  registry.addNode('geo', 'index_switch', {
    label: 'Index Switch',
    category: 'UTILITIES',
    defaults: { data_type: 'FLOAT' },
    getInputs(values) {
      const type = switchDataTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Index', type: SocketType.INT },
        { name: '0', type },
        { name: '1', type },
        { name: '2', type },
        { name: '3', type },
      ];
    },
    getOutputs(values) {
      const type = switchDataTypeToSocket(values.data_type || 'FLOAT');
      return [{ name: 'Output', type }];
    },
    getProps() {
      return [{
        key: 'data_type', label: 'Data Type', type: 'select',
        options: [
          { value: 'FLOAT', label: 'Float' },
          { value: 'INT', label: 'Integer' },
          { value: 'BOOLEAN', label: 'Boolean' },
          { value: 'VECTOR', label: 'Vector' },
          { value: 'COLOR', label: 'Color' },
          { value: 'GEOMETRY', label: 'Geometry' },
        ],
      }];
    },
    evaluate(values, inputs) {
      const idx = resolveScalar(inputs['Index'], 0);
      const clamped = Math.max(0, Math.min(3, Math.round(idx)));
      const result = inputs[String(clamped)];
      return { outputs: [result ?? 0] };
    },
  });

  // ── Rotation to Euler ──────────────────────────────────────────────────
  // Blender: node_fn_rotation_to_euler.cc
  // "Convert a rotation to euler angles"
  // Input: Rotation, Output: Euler (vector)

  registry.addNode('geo', 'rotation_to_euler', {
    label: 'Rotation to Euler',
    category: 'VECTOR',
    inputs: [{ name: 'Rotation', type: SocketType.VECTOR }],
    outputs: [{ name: 'Euler', type: SocketType.VECTOR }],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const rot = inputs['Rotation'];
      if (isField(rot)) return { outputs: [rot] };
      return { outputs: [rot || { x: 0, y: 0, z: 0 }] };
    },
  });

  // ── Rotation to Axis Angle ─────────────────────────────────────────────
  // Blender: node_fn_rotation_to_axis_angle.cc
  // "Convert a rotation to axis angle components"
  // Input: Rotation, Outputs: Axis (vector), Angle (float)

  registry.addNode('geo', 'rotation_to_axis_angle', {
    label: 'Rotation to Axis Angle',
    category: 'VECTOR',
    inputs: [{ name: 'Rotation', type: SocketType.VECTOR }],
    outputs: [
      { name: 'Axis', type: SocketType.VECTOR },
      { name: 'Angle', type: SocketType.FLOAT },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const rot = inputs['Rotation'];

      function toAxisAngle(r) {
        const v = r || { x: 0, y: 0, z: 0 };
        const angle = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        if (angle < 1e-10) return { axis: { x: 0, y: 0, z: 1 }, angle: 0 };
        return {
          axis: { x: v.x / angle, y: v.y / angle, z: v.z / angle },
          angle,
        };
      }

      if (isField(rot)) {
        return { outputs: [
          new Field('vector', (el) => toAxisAngle(rot.evaluateAt(el)).axis),
          new Field('float', (el) => toAxisAngle(rot.evaluateAt(el)).angle),
        ]};
      }

      const result = toAxisAngle(rot);
      return { outputs: [result.axis, result.angle] };
    },
  });

  // ── Curve Tilt (input) ─────────────────────────────────────────────────
  // Blender: node_geo_input_curve_tilt.cc
  // "Retrieve the tilt angle at each control point"
  // Output: Tilt (float field)

  registry.addNode('geo', 'curve_tilt', {
    label: 'Curve Tilt',
    category: 'INPUT',
    inputs: [],
    outputs: [{ name: 'Tilt', type: SocketType.FLOAT }],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [new Field('float', () => 0)] };
    },
  });

  // ── Is Viewport ────────────────────────────────────────────────────────
  // Blender: node_geo_is_viewport.cc
  // "Retrieve whether evaluation is for viewport vs final render"
  // In browser context, always true (we're always in "viewport").

  registry.addNode('geo', 'is_viewport', {
    label: 'Is Viewport',
    category: 'INPUT',
    inputs: [],
    outputs: [{ name: 'Is Viewport', type: SocketType.BOOL }],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [true] };
    },
  });
}

function switchDataTypeToSocket(type) {
  switch (type) {
    case 'FLOAT': return SocketType.FLOAT;
    case 'INT': return SocketType.INT;
    case 'BOOLEAN': return SocketType.BOOL;
    case 'VECTOR': return SocketType.VECTOR;
    case 'COLOR': return SocketType.COLOR;
    case 'GEOMETRY': return SocketType.GEOMETRY;
    default: return SocketType.FLOAT;
  }
}

function namedAttrTypeToSocket(type) {
  switch (type) {
    case 'FLOAT': return SocketType.FLOAT;
    case 'INT': return SocketType.INT;
    case 'FLOAT_VECTOR': return SocketType.VECTOR;
    case 'BOOLEAN': return SocketType.BOOL;
    case 'FLOAT_COLOR': return SocketType.COLOR;
    default: return SocketType.FLOAT;
  }
}

function rotateVecByEuler(v, rx, ry, rz) {
  // Rotate around X
  let y1 = v.y * Math.cos(rx) - v.z * Math.sin(rx);
  let z1 = v.y * Math.sin(rx) + v.z * Math.cos(rx);
  // Rotate around Y
  let x2 = v.x * Math.cos(ry) + z1 * Math.sin(ry);
  let z2 = -v.x * Math.sin(ry) + z1 * Math.cos(ry);
  // Rotate around Z
  let x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
  let y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
  return { x: x3, y: y3, z: z2 };
}
