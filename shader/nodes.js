/**
 * shader/nodes.js - Shader node type definitions.
 *
 * Registers all shader-specific node types with the shared registry.
 * Each node has inputs, outputs, defaults, optional props, and an
 * evaluate function that produces shader descriptor objects.
 */

import { registry, SocketType } from '../core/registry.js';

// ── Shader categories ──────────────────────────────────────────────
registry.addCategory('shader', 'SHADER_INPUT',    { name: 'Input',    color: '#c62828', icon: '\u2192' });
registry.addCategory('shader', 'SHADER_COLOR',    { name: 'Color',    color: '#fbc02d', icon: '\u25d0' });
registry.addCategory('shader', 'SHADER_TEXTURE',  { name: 'Texture',  color: '#bf360c', icon: '\u25a4' });
registry.addCategory('shader', 'SHADER_VECTOR',   { name: 'Vector',   color: '#7c4dff', icon: '\u2197' });
registry.addCategory('shader', 'SHADER_MATERIAL', { name: 'Material', color: '#2e7d32', icon: '\u25c9' });
registry.addCategory('shader', 'SHADER_OUTPUT',   { name: 'Output',   color: '#e65100', icon: '\u25ce' });
registry.addCategory('shader', 'SHADER_MATH',     { name: 'Math',     color: '#6a1b9a', icon: '\u0192' });
registry.addCategory('shader', 'SHADER_CONVERTER',{ name: 'Converter',color: '#5c6bc0', icon: '\u21c4' });

// ── Helpers ────────────────────────────────────────────────────────

/** Parse a hex colour string to {r,g,b} in 0-1 range. */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

/** Linearly interpolate two {r,g,b} colours. */
function lerpColor(c1, c2, t) {
  return {
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t,
  };
}

/** Clamp a number to [0, 1]. */
function clamp01(v) { return Math.min(Math.max(v, 0), 1); }

/** Safe divide (returns 0 for zero divisor). */
function safeDivide(a, b) { return b === 0 ? 0 : a / b; }

// ── Math operation evaluator (shared by shader_math) ───────────────
function evalMathOp(op, a, b) {
  switch (op) {
    case 'add':        return a + b;
    case 'subtract':   return a - b;
    case 'multiply':   return a * b;
    case 'divide':     return safeDivide(a, b);
    case 'power':      return Math.pow(a, b);
    case 'sqrt':       return Math.sqrt(Math.abs(a));
    case 'log':        return a > 0 ? Math.log(a) : 0;
    case 'modulo':     return b !== 0 ? ((a % b) + b) % b : 0;
    case 'min':        return Math.min(a, b);
    case 'max':        return Math.max(a, b);
    case 'abs':        return Math.abs(a);
    case 'floor':      return Math.floor(a);
    case 'ceil':       return Math.ceil(a);
    case 'round':      return Math.round(a);
    case 'sin':        return Math.sin(a);
    case 'cos':        return Math.cos(a);
    case 'tan':        return Math.tan(a);
    case 'asin':       return Math.asin(clamp01(a));
    case 'acos':       return Math.acos(clamp01(a));
    case 'atan':       return Math.atan(a);
    case 'atan2':      return Math.atan2(a, b);
    case 'sign':       return Math.sign(a);
    case 'fract':      return a - Math.floor(a);
    case 'snap':       return b !== 0 ? Math.floor(a / b) * b : a;
    case 'pingpong':   return b !== 0 ? Math.abs(((a % (2 * b)) + 2 * b) % (2 * b) - b) : 0;
    case 'wrap': {
      const range = b - 0; // wrap around b with 0 as min
      return range !== 0 ? a - range * Math.floor(a / range) : 0;
    }
    case 'smooth_min': {
      const k = 0.1;
      const h = clamp01(0.5 + 0.5 * (b - a) / k);
      return a * h + b * (1 - h) - k * h * (1 - h);
    }
    case 'smooth_max': {
      const k = 0.1;
      const h = clamp01(0.5 + 0.5 * (a - b) / k);
      return a * h + b * (1 - h) + k * h * (1 - h);
    }
    default: return a + b;
  }
}

// ── Vector math operation evaluator (shared by shader_vector_math) ─
function evalVectorMathOp(op, a, b) {
  const ax = a?.x ?? 0, ay = a?.y ?? 0, az = a?.z ?? 0;
  const bx = b?.x ?? 0, by = b?.y ?? 0, bz = b?.z ?? 0;

  const vecLen = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const normalize = (v) => {
    const l = vecLen(v) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };

  switch (op) {
    case 'add':       return { vec: { x: ax + bx, y: ay + by, z: az + bz }, val: 0 };
    case 'subtract':  return { vec: { x: ax - bx, y: ay - by, z: az - bz }, val: 0 };
    case 'multiply':  return { vec: { x: ax * bx, y: ay * by, z: az * bz }, val: 0 };
    case 'divide':    return { vec: { x: safeDivide(ax, bx), y: safeDivide(ay, by), z: safeDivide(az, bz) }, val: 0 };
    case 'cross':     return { vec: { x: ay * bz - az * by, y: az * bx - ax * bz, z: ax * by - ay * bx }, val: 0 };
    case 'dot':       return { vec: { x: 0, y: 0, z: 0 }, val: ax * bx + ay * by + az * bz };
    case 'distance': {
      const dx = ax - bx, dy = ay - by, dz = az - bz;
      return { vec: { x: 0, y: 0, z: 0 }, val: Math.sqrt(dx * dx + dy * dy + dz * dz) };
    }
    case 'normalize': return { vec: normalize({ x: ax, y: ay, z: az }), val: vecLen({ x: ax, y: ay, z: az }) };
    case 'length':    return { vec: { x: 0, y: 0, z: 0 }, val: vecLen({ x: ax, y: ay, z: az }) };
    case 'scale':     return { vec: { x: ax * bx, y: ay * bx, z: az * bx }, val: 0 };
    case 'reflect': {
      const d = 2 * (ax * bx + ay * by + az * bz);
      return { vec: { x: ax - d * bx, y: ay - d * by, z: az - d * bz }, val: 0 };
    }
    case 'project': {
      const denom = bx * bx + by * by + bz * bz;
      if (denom === 0) return { vec: { x: 0, y: 0, z: 0 }, val: 0 };
      const s = (ax * bx + ay * by + az * bz) / denom;
      return { vec: { x: bx * s, y: by * s, z: bz * s }, val: 0 };
    }
    case 'faceforward': {
      const dot = ax * bx + ay * by + az * bz;
      const sign = dot < 0 ? 1 : -1;
      return { vec: { x: ax * sign, y: ay * sign, z: az * sign }, val: 0 };
    }
    case 'snap': {
      const sx = bx !== 0 ? Math.floor(ax / bx) * bx : ax;
      const sy = by !== 0 ? Math.floor(ay / by) * by : ay;
      const sz = bz !== 0 ? Math.floor(az / bz) * bz : az;
      return { vec: { x: sx, y: sy, z: sz }, val: 0 };
    }
    case 'floor':   return { vec: { x: Math.floor(ax), y: Math.floor(ay), z: Math.floor(az) }, val: 0 };
    case 'ceil':    return { vec: { x: Math.ceil(ax), y: Math.ceil(ay), z: Math.ceil(az) }, val: 0 };
    case 'abs':     return { vec: { x: Math.abs(ax), y: Math.abs(ay), z: Math.abs(az) }, val: 0 };
    case 'min':     return { vec: { x: Math.min(ax, bx), y: Math.min(ay, by), z: Math.min(az, bz) }, val: 0 };
    case 'max':     return { vec: { x: Math.max(ax, bx), y: Math.max(ay, by), z: Math.max(az, bz) }, val: 0 };
    case 'sine':    return { vec: { x: Math.sin(ax), y: Math.sin(ay), z: Math.sin(az) }, val: 0 };
    case 'cosine':  return { vec: { x: Math.cos(ax), y: Math.cos(ay), z: Math.cos(az) }, val: 0 };
    case 'tangent': return { vec: { x: Math.tan(ax), y: Math.tan(ay), z: Math.tan(az) }, val: 0 };
    default:        return { vec: { x: ax + bx, y: ay + by, z: az + bz }, val: 0 };
  }
}

// ── Color blend modes ──────────────────────────────────────────────
function blendColors(mode, c1, c2, fac) {
  const f = clamp01(fac);
  const r1 = c1?.r ?? 0, g1 = c1?.g ?? 0, b1 = c1?.b ?? 0;
  const r2 = c2?.r ?? 0, g2 = c2?.g ?? 0, b2 = c2?.b ?? 0;

  let rr, gg, bb;
  switch (mode) {
    case 'multiply':
      rr = r1 * r2; gg = g1 * g2; bb = b1 * b2;
      break;
    case 'screen':
      rr = 1 - (1 - r1) * (1 - r2);
      gg = 1 - (1 - g1) * (1 - g2);
      bb = 1 - (1 - b1) * (1 - b2);
      break;
    case 'overlay':
      rr = r1 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
      gg = g1 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
      bb = b1 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
      break;
    case 'add':
      rr = Math.min(r1 + r2, 1); gg = Math.min(g1 + g2, 1); bb = Math.min(b1 + b2, 1);
      break;
    case 'subtract':
      rr = Math.max(r1 - r2, 0); gg = Math.max(g1 - g2, 0); bb = Math.max(b1 - b2, 0);
      break;
    default: // 'mix'
      rr = r2; gg = g2; bb = b2;
      break;
  }

  // Lerp between original c1 and blended result by factor
  return {
    r: r1 + (rr - r1) * f,
    g: g1 + (gg - g1) * f,
    b: b1 + (bb - b1) * f,
  };
}

// ══════════════════════════════════════════════════════════════════
//  NODE TYPE DEFINITIONS
// ══════════════════════════════════════════════════════════════════

registry.addNodes('shader', {

  // ─── Output ──────────────────────────────────────────────────────
  shader_output: {
    label: 'Shader Output',
    category: 'SHADER_OUTPUT',
    singular: true,
    inputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    outputs: [],
    defaults: {},
    evaluate(values, inputs) {
      return { outputs: [], shaderResult: inputs['Shader'] || null };
    },
  },

  // ─── Material / Shader ──────────────────────────────────────────
  principled_bsdf: {
    label: 'Principled BSDF',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Base Color', type: SocketType.COLOR },
      { name: 'Metallic',   type: SocketType.FLOAT },
      { name: 'Roughness',  type: SocketType.FLOAT },
      { name: 'IOR',        type: SocketType.FLOAT },
      { name: 'Alpha',      type: SocketType.FLOAT },
      { name: 'Normal',     type: SocketType.VECTOR },
      { name: 'Subsurface Weight',  type: SocketType.FLOAT },
      { name: 'Subsurface Radius',  type: SocketType.VECTOR },
      { name: 'Specular IOR Level', type: SocketType.FLOAT },
      { name: 'Specular Tint',      type: SocketType.COLOR },
      { name: 'Anisotropic',          type: SocketType.FLOAT },
      { name: 'Anisotropic Rotation', type: SocketType.FLOAT },
      { name: 'Transmission Weight',  type: SocketType.FLOAT },
      { name: 'Coat Weight',    type: SocketType.FLOAT },
      { name: 'Coat Roughness', type: SocketType.FLOAT },
      { name: 'Coat Normal',    type: SocketType.VECTOR },
      { name: 'Sheen Weight',    type: SocketType.FLOAT },
      { name: 'Sheen Roughness', type: SocketType.FLOAT },
      { name: 'Emission Color',    type: SocketType.COLOR },
      { name: 'Emission Strength', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'BSDF', type: SocketType.SHADER },
    ],
    defaults: { baseColor: '#6688cc', metallic: 0.0, roughness: 0.5, ior: 1.5, alpha: 1.0 },
    props: [
      { key: 'baseColor', label: 'Base Color', type: 'color' },
      { key: 'metallic',  label: 'Metallic',  type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'roughness', label: 'Roughness', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'ior',       label: 'IOR',       type: 'float', min: 0, max: 4, step: 0.01 },
      { key: 'alpha',     label: 'Alpha',     type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const defaultColor = hexToRgb(values.baseColor || '#6688cc');
      const baseColor = inputs['Base Color'] || defaultColor;
      const metallic  = inputs['Metallic']  ?? values.metallic ?? 0.0;
      const roughness = inputs['Roughness'] ?? values.roughness ?? 0.5;
      const normal    = inputs['Normal'] || inputs['Coat Normal'] || null;
      const emissionColor = inputs['Emission Color'] || null;
      const emissionStrength = inputs['Emission Strength'] ?? 0;
      return {
        outputs: [{
          type: 'principled',
          baseColor,
          metallic,
          roughness,
          normal,
          emission: emissionColor,
          emissionStrength,
          alpha: inputs['Alpha'] ?? values.alpha ?? 1.0,
          ior: inputs['IOR'] ?? values.ior ?? 1.5,
        }],
      };
    },
  },

  emission: {
    label: 'Emission',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Color',    type: SocketType.COLOR },
      { name: 'Strength', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    defaults: { color: '#ffffff', strength: 1.0 },
    props: [
      { key: 'color',    label: 'Color',    type: 'color' },
      { key: 'strength', label: 'Strength', type: 'float', min: 0, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const defaultColor = hexToRgb(values.color || '#ffffff');
      const color    = inputs['Color'] || defaultColor;
      const strength = inputs['Strength'] ?? values.strength ?? 1.0;
      return {
        outputs: [{
          type: 'emission',
          emission: color,
          emissionStrength: strength,
          baseColor: { r: 0, g: 0, b: 0 },
          metallic: 0,
          roughness: 1,
          normal: null,
        }],
      };
    },
  },

  mix_shader: {
    label: 'Mix Shader',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Fac',     type: SocketType.FLOAT },
      { name: 'Shader1', type: SocketType.SHADER },
      { name: 'Shader2', type: SocketType.SHADER },
    ],
    outputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    defaults: { fac: 0.5 },
    props: [
      { key: 'fac', label: 'Factor', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const fac = clamp01(inputs['Fac'] ?? values.fac ?? 0.5);
      const s1  = inputs['Shader1'];
      const s2  = inputs['Shader2'];

      if (!s1 && !s2) return { outputs: [null] };
      if (!s1) return { outputs: [s2] };
      if (!s2) return { outputs: [s1] };

      // Blend material properties
      const bc1 = s1.baseColor || { r: 0, g: 0, b: 0 };
      const bc2 = s2.baseColor || { r: 0, g: 0, b: 0 };
      const em1 = s1.emission  || { r: 0, g: 0, b: 0 };
      const em2 = s2.emission  || { r: 0, g: 0, b: 0 };

      return {
        outputs: [{
          type: 'mix',
          baseColor: lerpColor(bc1, bc2, fac),
          metallic:  (s1.metallic ?? 0) * (1 - fac) + (s2.metallic ?? 0) * fac,
          roughness: (s1.roughness ?? 0.5) * (1 - fac) + (s2.roughness ?? 0.5) * fac,
          emission:  lerpColor(em1, em2, fac),
          emissionStrength: (s1.emissionStrength ?? 0) * (1 - fac) + (s2.emissionStrength ?? 0) * fac,
          normal: s2.normal || s1.normal || null,
        }],
      };
    },
  },

  // ─── Color ──────────────────────────────────────────────────────
  color_value: {
    label: 'Color',
    category: 'SHADER_INPUT',
    inputs: [],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { r: 0.4, g: 0.53, b: 0.8 },
    props: [
      { key: 'r', label: 'R', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'g', label: 'G', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'b', label: 'B', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values) {
      return {
        outputs: [{
          r: clamp01(values.r ?? 0.4),
          g: clamp01(values.g ?? 0.53),
          b: clamp01(values.b ?? 0.8),
        }],
      };
    },
  },

  mix_color: {
    label: 'Mix Color',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Fac',    type: SocketType.FLOAT },
      { name: 'Color1', type: SocketType.COLOR },
      { name: 'Color2', type: SocketType.COLOR },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { fac: 0.5, mode: 'mix' },
    props: [
      { key: 'fac',  label: 'Factor', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'mode', label: 'Mode', type: 'select', options: [
        { value: 'mix',      label: 'Mix' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen',   label: 'Screen' },
        { value: 'overlay',  label: 'Overlay' },
        { value: 'add',      label: 'Add' },
        { value: 'subtract', label: 'Subtract' },
      ]},
    ],
    evaluate(values, inputs) {
      const fac  = inputs['Fac'] ?? values.fac ?? 0.5;
      const c1   = inputs['Color1'] || { r: 0, g: 0, b: 0 };
      const c2   = inputs['Color2'] || { r: 1, g: 1, b: 1 };
      const mode = values.mode || 'mix';
      return { outputs: [blendColors(mode, c1, c2, fac)] };
    },
  },

  fresnel: {
    label: 'Fresnel',
    category: 'SHADER_INPUT',
    inputs: [
      { name: 'IOR',    type: SocketType.FLOAT },
      { name: 'Normal', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Fac', type: SocketType.FLOAT },
    ],
    defaults: { ior: 1.45 },
    props: [
      { key: 'ior', label: 'IOR', type: 'float', min: 1.0, max: 3.0, step: 0.01 },
    ],
    evaluate(values, inputs) {
      // Approximate Fresnel using Schlick's approximation with default view angle
      const ior = inputs['IOR'] ?? values.ior ?? 1.45;
      const r0  = Math.pow((1 - ior) / (1 + ior), 2);
      // Default viewing angle ~45 degrees for preview purposes
      const cosTheta = 0.707;
      const fresnel  = r0 + (1 - r0) * Math.pow(1 - cosTheta, 5);
      return { outputs: [clamp01(fresnel)] };
    },
  },

  // ─── Vector ─────────────────────────────────────────────────────
  texture_coord: {
    label: 'Texture Coordinate',
    category: 'SHADER_VECTOR',
    inputs: [],
    outputs: [
      { name: 'Generated',  type: SocketType.VECTOR },
      { name: 'Normal',     type: SocketType.VECTOR },
      { name: 'UV',         type: SocketType.VECTOR },
      { name: 'Object',     type: SocketType.VECTOR },
      { name: 'Camera',     type: SocketType.VECTOR },
      { name: 'Window',     type: SocketType.VECTOR },
      { name: 'Reflection', type: SocketType.VECTOR },
    ],
    defaults: {},
    evaluate() {
      // These are symbolic placeholders; the compiler resolves them to GLSL varyings
      return {
        outputs: [
          { x: 0, y: 0, z: 0, _source: 'generated' },
          { x: 0, y: 0, z: 0, _source: 'normal' },
          { x: 0, y: 0, z: 0, _source: 'uv' },
          { x: 0, y: 0, z: 0, _source: 'object' },
          { x: 0, y: 0, z: 0, _source: 'camera' },
          { x: 0, y: 0, z: 0, _source: 'window' },
          { x: 0, y: 0, z: 0, _source: 'reflection' },
        ],
      };
    },
  },

  mapping: {
    label: 'Mapping',
    category: 'SHADER_VECTOR',
    inputs: [
      { name: 'Vector',   type: SocketType.VECTOR },
      { name: 'Location', type: SocketType.VECTOR },
      { name: 'Rotation', type: SocketType.VECTOR },
      { name: 'Scale',    type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    defaults: {
      tx: 0, ty: 0, tz: 0,
      rx: 0, ry: 0, rz: 0,
      sx: 1, sy: 1, sz: 1,
      mappingType: 'point',
    },
    props: [
      { key: 'mappingType', label: 'Type', type: 'select', options: [
        { value: 'point', label: 'Point' },
        { value: 'texture', label: 'Texture' },
        { value: 'vector', label: 'Vector' },
        { value: 'normal', label: 'Normal' },
      ]},
      { key: 'tx', label: 'Location X', type: 'float', min: -100, max: 100, step: 0.1 },
      { key: 'ty', label: 'Location Y', type: 'float', min: -100, max: 100, step: 0.1 },
      { key: 'tz', label: 'Location Z', type: 'float', min: -100, max: 100, step: 0.1 },
      { key: 'rx', label: 'Rotation X (deg)', type: 'float', min: -360, max: 360, step: 1 },
      { key: 'ry', label: 'Rotation Y (deg)', type: 'float', min: -360, max: 360, step: 1 },
      { key: 'rz', label: 'Rotation Z (deg)', type: 'float', min: -360, max: 360, step: 1 },
      { key: 'sx', label: 'Scale X', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'sy', label: 'Scale Y', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'sz', label: 'Scale Z', type: 'float', min: 0.01, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const v = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const loc = inputs['Location'] || { x: values.tx ?? 0, y: values.ty ?? 0, z: values.tz ?? 0 };
      const rot = inputs['Rotation'] || { x: values.rx ?? 0, y: values.ry ?? 0, z: values.rz ?? 0 };
      const sc = inputs['Scale'] || { x: values.sx ?? 1, y: values.sy ?? 1, z: values.sz ?? 1 };
      // Apply scale
      let x = (v.x ?? 0) * (sc.x ?? values.sx ?? 1);
      let y = (v.y ?? 0) * (sc.y ?? values.sy ?? 1);
      let z = (v.z ?? 0) * (sc.z ?? values.sz ?? 1);
      // Apply rotation (simple Euler, degrees to radians)
      const toRad = Math.PI / 180;
      const rxr = (rot.x ?? values.rx ?? 0) * toRad;
      const ryr = (rot.y ?? values.ry ?? 0) * toRad;
      const rzr = (rot.z ?? values.rz ?? 0) * toRad;
      // Rotate Z
      let x1 = x * Math.cos(rzr) - y * Math.sin(rzr);
      let y1 = x * Math.sin(rzr) + y * Math.cos(rzr);
      x = x1; y = y1;
      // Rotate Y
      let x2 = x * Math.cos(ryr) + z * Math.sin(ryr);
      let z2 = -x * Math.sin(ryr) + z * Math.cos(ryr);
      x = x2; z = z2;
      // Rotate X
      let y3 = y * Math.cos(rxr) - z * Math.sin(rxr);
      let z3 = y * Math.sin(rxr) + z * Math.cos(rxr);
      y = y3; z = z3;
      // Apply translation
      x += loc.x ?? values.tx ?? 0;
      y += loc.y ?? values.ty ?? 0;
      z += loc.z ?? values.tz ?? 0;
      return { outputs: [{ x, y, z }] };
    },
  },

  // ─── Texture ────────────────────────────────────────────────────
  noise_texture_shader: {
    label: 'Noise Texture',
    category: 'SHADER_TEXTURE',
    inputs: [
      { name: 'Vector',     type: SocketType.VECTOR },
      { name: 'W',          type: SocketType.FLOAT },
      { name: 'Scale',      type: SocketType.FLOAT },
      { name: 'Detail',     type: SocketType.FLOAT },
      { name: 'Roughness',  type: SocketType.FLOAT },
      { name: 'Lacunarity', type: SocketType.FLOAT },
      { name: 'Distortion', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Fac',   type: SocketType.FLOAT },
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { scale: 5, detail: 2, roughness: 0.5, lacunarity: 2, distortion: 0, dimensions: '3D' },
    props: [
      { key: 'dimensions', label: 'Dimensions', type: 'select', options: [
        { value: '1D', label: '1D' }, { value: '2D', label: '2D' },
        { value: '3D', label: '3D' }, { value: '4D', label: '4D' },
      ]},
      { key: 'scale',  label: 'Scale',  type: 'float', min: 0.01, max: 100, step: 0.5 },
      { key: 'detail', label: 'Detail', type: 'float', min: 0, max: 15, step: 0.5 },
      { key: 'roughness', label: 'Roughness', type: 'float', min: 0, max: 1, step: 0.05 },
      { key: 'lacunarity', label: 'Lacunarity', type: 'float', min: 0, max: 10, step: 0.1 },
      { key: 'distortion', label: 'Distortion', type: 'float', min: 0, max: 10, step: 0.1 },
    ],
    evaluate(values, inputs) {
      // Simple procedural evaluation for preview; the compiler generates GLSL
      const v = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const scale  = inputs['Scale'] ?? values.scale ?? 5;
      const detail = values.detail ?? 2;
      const sx = (v.x ?? 0) * scale;
      const sy = (v.y ?? 0) * scale;
      const sz = (v.z ?? 0) * scale;
      // Simple hash-based pseudo-noise
      const hash = (a, b, c) => {
        let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) >>> 0) / 4294967296;
      };
      const ix = Math.floor(sx), iy = Math.floor(sy), iz = Math.floor(sz);
      const fac = hash(ix * 100 + detail, iy * 100, iz * 100);
      return {
        outputs: [
          fac,
          { r: fac, g: hash(ix, iy + 73, iz), b: hash(ix + 31, iy, iz + 97) },
        ],
      };
    },
  },

  voronoi_texture_shader: {
    label: 'Voronoi Texture',
    category: 'SHADER_TEXTURE',
    inputs: [
      { name: 'Vector',     type: SocketType.VECTOR },
      { name: 'W',          type: SocketType.FLOAT },
      { name: 'Scale',      type: SocketType.FLOAT },
      { name: 'Smoothness', type: SocketType.FLOAT },
      { name: 'Exponent',   type: SocketType.FLOAT },
      { name: 'Randomness', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Distance', type: SocketType.FLOAT },
      { name: 'Color',    type: SocketType.COLOR },
      { name: 'Position', type: SocketType.VECTOR },
      { name: 'W',        type: SocketType.FLOAT },
    ],
    defaults: { scale: 5, feature: 'f1', randomness: 1, dimensions: '3D', distMetric: 'euclidean' },
    props: [
      { key: 'dimensions', label: 'Dimensions', type: 'select', options: [
        { value: '1D', label: '1D' }, { value: '2D', label: '2D' },
        { value: '3D', label: '3D' }, { value: '4D', label: '4D' },
      ]},
      { key: 'feature', label: 'Feature', type: 'select', options: [
        { value: 'f1', label: 'F1' }, { value: 'f2', label: 'F2' },
        { value: 'smooth_f1', label: 'Smooth F1' },
        { value: 'distance_to_edge', label: 'Distance to Edge' },
        { value: 'n_sphere_radius', label: 'N-Sphere Radius' },
      ]},
      { key: 'distMetric', label: 'Distance', type: 'select', options: [
        { value: 'euclidean', label: 'Euclidean' }, { value: 'manhattan', label: 'Manhattan' },
        { value: 'chebychev', label: 'Chebychev' }, { value: 'minkowski', label: 'Minkowski' },
      ]},
      { key: 'scale', label: 'Scale', type: 'float', min: 0.01, max: 100, step: 0.5 },
      { key: 'randomness', label: 'Randomness', type: 'float', min: 0, max: 1, step: 0.05 },
    ],
    evaluate(values, inputs) {
      const v = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const scale = inputs['Scale'] ?? values.scale ?? 5;
      const sx = (v.x ?? 0) * scale;
      const sy = (v.y ?? 0) * scale;
      const sz = (v.z ?? 0) * scale;
      const hash = (a, b, c) => {
        let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) >>> 0) / 4294967296;
      };
      const ix = Math.floor(sx), iy = Math.floor(sy), iz = Math.floor(sz);
      let minDist = 999;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cx = ix + dx, cy = iy + dy, cz = iz + dz;
            const px = cx + hash(cx, cy, cz);
            const py = cy + hash(cx + 73, cy + 157, cz + 31);
            const pz = cz + hash(cx + 139, cy + 29, cz + 97);
            const ddx = sx - px, ddy = sy - py, ddz = sz - pz;
            const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            if (d < minDist) minDist = d;
          }
        }
      }
      const dist = clamp01(minDist);
      return {
        outputs: [
          dist,
          { r: dist, g: 1 - dist, b: dist * 0.5 },
          { x: sx, y: sy, z: sz },
          0,
        ],
      };
    },
  },

  color_ramp: {
    label: 'Color Ramp',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Fac', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Alpha', type: SocketType.FLOAT },
    ],
    defaults: { color1: '#000000', color2: '#ffffff', pos1: 0, pos2: 1 },
    props: [
      { key: 'color1', label: 'Color 1', type: 'color' },
      { key: 'color2', label: 'Color 2', type: 'color' },
      { key: 'pos1',   label: 'Pos 1', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'pos2',   label: 'Pos 2', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const fac = clamp01(inputs['Fac'] ?? 0.5);
      const c1  = hexToRgb(values.color1 || '#000000');
      const c2  = hexToRgb(values.color2 || '#ffffff');
      const p1  = values.pos1 ?? 0;
      const p2  = values.pos2 ?? 1;
      const range = p2 - p1;
      const t = range > 0 ? clamp01((fac - p1) / range) : (fac >= p1 ? 1 : 0);
      const color = lerpColor(c1, c2, t);
      return { outputs: [color, t] };
    },
  },

  // ─── Color utilities ────────────────────────────────────────────
  separate_color: {
    label: 'Separate Color',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    outputs: [
      { name: 'Red',   type: SocketType.FLOAT },
      { name: 'Green', type: SocketType.FLOAT },
      { name: 'Blue',  type: SocketType.FLOAT },
    ],
    defaults: { mode: 'rgb' },
    props: [
      { key: 'mode', label: 'Mode', type: 'select', options: [
        { value: 'rgb', label: 'RGB' },
        { value: 'hsv', label: 'HSV' },
        { value: 'hsl', label: 'HSL' },
      ]},
    ],
    evaluate(values, inputs) {
      const c = inputs['Color'] || { r: 0, g: 0, b: 0 };
      if (values.mode === 'hsv') {
        const r = c.r ?? 0, g = c.g ?? 0, b = c.b ?? 0;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0; const s = mx === 0 ? 0 : d / mx; const v = mx;
        if (d !== 0) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; }
        return { outputs: [h, s, v] };
      }
      return { outputs: [c.r ?? 0, c.g ?? 0, c.b ?? 0] };
    },
  },

  combine_color: {
    label: 'Combine Color',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Red',   type: SocketType.FLOAT },
      { name: 'Green', type: SocketType.FLOAT },
      { name: 'Blue',  type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { r: 0, g: 0, b: 0, mode: 'rgb' },
    props: [
      { key: 'mode', label: 'Mode', type: 'select', options: [
        { value: 'rgb', label: 'RGB' },
        { value: 'hsv', label: 'HSV' },
        { value: 'hsl', label: 'HSL' },
      ]},
      { key: 'r', label: 'Red / H',   type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'g', label: 'Green / S', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'b', label: 'Blue / V',  type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const c1 = clamp01(inputs['Red'] ?? values.r ?? 0);
      const c2 = clamp01(inputs['Green'] ?? values.g ?? 0);
      const c3 = clamp01(inputs['Blue'] ?? values.b ?? 0);
      if (values.mode === 'hsv') {
        const h = c1, s = c2, v = c3;
        const hi = Math.floor(h * 6), f = h * 6 - hi;
        const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        let r, g, b;
        switch (hi % 6) {
          case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break;
          case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break;
          case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break;
          default: r = v; g = t; b = p;
        }
        return { outputs: [{ r, g, b }] };
      }
      return { outputs: [{ r: c1, g: c2, b: c3 }] };
    },
  },

  // ─── Math ───────────────────────────────────────────────────────
  shader_math: {
    label: 'Math',
    category: 'SHADER_MATH',
    inputs: [
      { name: 'A', type: SocketType.FLOAT },
      { name: 'B', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Result', type: SocketType.FLOAT },
    ],
    defaults: { operation: 'add', a: 0, b: 0 },
    props: [
      { key: 'operation', label: 'Operation', type: 'select', options: [
        { value: 'add',        label: 'Add' },
        { value: 'subtract',   label: 'Subtract' },
        { value: 'multiply',   label: 'Multiply' },
        { value: 'divide',     label: 'Divide' },
        { value: 'power',      label: 'Power' },
        { value: 'sqrt',       label: 'Square Root' },
        { value: 'log',        label: 'Logarithm' },
        { value: 'modulo',     label: 'Modulo' },
        { value: 'min',        label: 'Min' },
        { value: 'max',        label: 'Max' },
        { value: 'abs',        label: 'Absolute' },
        { value: 'floor',      label: 'Floor' },
        { value: 'ceil',       label: 'Ceil' },
        { value: 'round',      label: 'Round' },
        { value: 'sin',        label: 'Sine' },
        { value: 'cos',        label: 'Cosine' },
        { value: 'tan',        label: 'Tangent' },
        { value: 'asin',       label: 'Arcsine' },
        { value: 'acos',       label: 'Arccosine' },
        { value: 'atan',       label: 'Arctangent' },
        { value: 'atan2',      label: 'Arctan2' },
        { value: 'sign',       label: 'Sign' },
        { value: 'fract',      label: 'Fraction' },
        { value: 'snap',       label: 'Snap' },
        { value: 'pingpong',   label: 'Ping Pong' },
        { value: 'wrap',       label: 'Wrap' },
        { value: 'smooth_min', label: 'Smooth Min' },
        { value: 'smooth_max', label: 'Smooth Max' },
      ]},
      { key: 'a', label: 'A', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'b', label: 'B', type: 'float', min: -1000, max: 1000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const op = values.operation || 'add';
      const a  = inputs['A'] ?? values.a ?? 0;
      const b  = inputs['B'] ?? values.b ?? 0;
      return { outputs: [evalMathOp(op, a, b)] };
    },
  },

  shader_vector_math: {
    label: 'Vector Math',
    category: 'SHADER_MATH',
    inputs: [
      { name: 'A', type: SocketType.VECTOR },
      { name: 'B', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Value',  type: SocketType.FLOAT },
    ],
    defaults: { operation: 'add' },
    props: [
      { key: 'operation', label: 'Operation', type: 'select', options: [
        { value: 'add',         label: 'Add' },
        { value: 'subtract',    label: 'Subtract' },
        { value: 'multiply',    label: 'Multiply' },
        { value: 'divide',      label: 'Divide' },
        { value: 'cross',       label: 'Cross Product' },
        { value: 'dot',         label: 'Dot Product' },
        { value: 'distance',    label: 'Distance' },
        { value: 'normalize',   label: 'Normalize' },
        { value: 'length',      label: 'Length' },
        { value: 'scale',       label: 'Scale' },
        { value: 'reflect',     label: 'Reflect' },
        { value: 'project',     label: 'Project' },
        { value: 'faceforward', label: 'Faceforward' },
        { value: 'snap',        label: 'Snap' },
        { value: 'floor',       label: 'Floor' },
        { value: 'ceil',        label: 'Ceil' },
        { value: 'abs',         label: 'Absolute' },
        { value: 'min',         label: 'Min' },
        { value: 'max',         label: 'Max' },
        { value: 'sine',        label: 'Sine' },
        { value: 'cosine',      label: 'Cosine' },
        { value: 'tangent',     label: 'Tangent' },
      ]},
    ],
    evaluate(values, inputs) {
      const op = values.operation || 'add';
      const a  = inputs['A'] || { x: 0, y: 0, z: 0 };
      const b  = inputs['B'] || { x: 0, y: 0, z: 0 };
      const result = evalVectorMathOp(op, a, b);
      return { outputs: [result.vec, result.val] };
    },
  },

  // ─── BSDFs & Materials (new) ──────────────────────────────────────

  diffuse_bsdf: {
    label: 'Diffuse BSDF',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Color',     type: SocketType.COLOR },
      { name: 'Roughness', type: SocketType.FLOAT },
      { name: 'Normal',    type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    defaults: { color: '#cccccc', roughness: 0.0 },
    props: [
      { key: 'color',     label: 'Color',     type: 'color' },
      { key: 'roughness', label: 'Roughness', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const defaultColor = hexToRgb(values.color || '#cccccc');
      const color     = inputs['Color'] || defaultColor;
      const roughness = inputs['Roughness'] ?? values.roughness ?? 0.0;
      const normal    = inputs['Normal'] || null;
      return {
        outputs: [{
          type: 'principled',
          baseColor: color,
          metallic: 0,
          roughness: Math.max(roughness, 0.8),
          normal,
          emission: null,
          emissionStrength: 0,
        }],
      };
    },
  },

  glossy_bsdf: {
    label: 'Glossy BSDF',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Color',     type: SocketType.COLOR },
      { name: 'Roughness', type: SocketType.FLOAT },
      { name: 'Normal',    type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'BSDF', type: SocketType.SHADER },
    ],
    defaults: { color: '#ffffff', roughness: 0.2, distribution: 'ggx' },
    props: [
      { key: 'distribution', label: 'Distribution', type: 'select', options: [
        { value: 'ggx', label: 'GGX' },
        { value: 'beckmann', label: 'Beckmann' },
        { value: 'ashikhmin_shirley', label: 'Ashikhmin-Shirley' },
        { value: 'multi_ggx', label: 'Multiscatter GGX' },
      ]},
      { key: 'color',     label: 'Color',     type: 'color' },
      { key: 'roughness', label: 'Roughness', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const defaultColor = hexToRgb(values.color || '#ffffff');
      const color     = inputs['Color'] || defaultColor;
      const roughness = inputs['Roughness'] ?? values.roughness ?? 0.2;
      const normal    = inputs['Normal'] || null;
      return {
        outputs: [{
          type: 'principled',
          baseColor: color,
          metallic: 1.0,
          roughness,
          normal,
          emission: null,
          emissionStrength: 0,
        }],
      };
    },
  },

  glass_bsdf: {
    label: 'Glass BSDF',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Color',     type: SocketType.COLOR },
      { name: 'Roughness', type: SocketType.FLOAT },
      { name: 'IOR',       type: SocketType.FLOAT },
      { name: 'Normal',    type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'BSDF', type: SocketType.SHADER },
    ],
    defaults: { color: '#ffffff', roughness: 0.0, ior: 1.45, distribution: 'ggx' },
    props: [
      { key: 'distribution', label: 'Distribution', type: 'select', options: [
        { value: 'ggx', label: 'GGX' },
        { value: 'beckmann', label: 'Beckmann' },
        { value: 'multi_ggx', label: 'Multiscatter GGX' },
      ]},
      { key: 'color',     label: 'Color',     type: 'color' },
      { key: 'roughness', label: 'Roughness', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'ior',       label: 'IOR',       type: 'float', min: 1.0, max: 3.0, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const defaultColor = hexToRgb(values.color || '#ffffff');
      const color     = inputs['Color'] || defaultColor;
      const roughness = inputs['Roughness'] ?? values.roughness ?? 0.0;
      const ior       = inputs['IOR'] ?? values.ior ?? 1.45;
      const normal    = inputs['Normal'] || null;
      // Approximate glass as low-roughness, slightly metallic with tinted color
      const r0 = Math.pow((1 - ior) / (1 + ior), 2);
      return {
        outputs: [{
          type: 'principled',
          baseColor: { r: color.r * 0.05, g: color.g * 0.05, b: color.b * 0.05 },
          metallic: r0,
          roughness,
          normal,
          emission: { r: color.r * 0.1, g: color.g * 0.1, b: color.b * 0.1 },
          emissionStrength: 0.3,
        }],
      };
    },
  },

  transparent_bsdf: {
    label: 'Transparent BSDF',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    outputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    defaults: { color: '#ffffff' },
    props: [
      { key: 'color', label: 'Color', type: 'color' },
    ],
    evaluate(values, inputs) {
      const defaultColor = hexToRgb(values.color || '#ffffff');
      const color = inputs['Color'] || defaultColor;
      return {
        outputs: [{
          type: 'principled',
          baseColor: color,
          metallic: 0,
          roughness: 0,
          normal: null,
          emission: null,
          emissionStrength: 0,
          alpha: 0.1,
        }],
      };
    },
  },

  translucent_bsdf: {
    label: 'Translucent BSDF',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Color',  type: SocketType.COLOR },
      { name: 'Normal', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    defaults: { color: '#ffffff' },
    props: [
      { key: 'color', label: 'Color', type: 'color' },
    ],
    evaluate(values, inputs) {
      const defaultColor = hexToRgb(values.color || '#ffffff');
      const color  = inputs['Color'] || defaultColor;
      const normal = inputs['Normal'] || null;
      return {
        outputs: [{
          type: 'principled',
          baseColor: color,
          metallic: 0,
          roughness: 1.0,
          normal,
          emission: { r: color.r * 0.15, g: color.g * 0.15, b: color.b * 0.15 },
          emissionStrength: 0.5,
        }],
      };
    },
  },

  add_shader: {
    label: 'Add Shader',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Shader1', type: SocketType.SHADER },
      { name: 'Shader2', type: SocketType.SHADER },
    ],
    outputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    defaults: {},
    evaluate(values, inputs) {
      const s1 = inputs['Shader1'];
      const s2 = inputs['Shader2'];
      if (!s1 && !s2) return { outputs: [null] };
      if (!s1) return { outputs: [s2] };
      if (!s2) return { outputs: [s1] };
      const bc1 = s1.baseColor || { r: 0, g: 0, b: 0 };
      const bc2 = s2.baseColor || { r: 0, g: 0, b: 0 };
      const em1 = s1.emission  || { r: 0, g: 0, b: 0 };
      const em2 = s2.emission  || { r: 0, g: 0, b: 0 };
      return {
        outputs: [{
          type: 'mix',
          baseColor: { r: Math.min(bc1.r + bc2.r, 1), g: Math.min(bc1.g + bc2.g, 1), b: Math.min(bc1.b + bc2.b, 1) },
          metallic:  Math.min((s1.metallic ?? 0) + (s2.metallic ?? 0), 1),
          roughness: ((s1.roughness ?? 0.5) + (s2.roughness ?? 0.5)) * 0.5,
          emission:  { r: Math.min(em1.r + em2.r, 1), g: Math.min(em1.g + em2.g, 1), b: Math.min(em1.b + em2.b, 1) },
          emissionStrength: (s1.emissionStrength ?? 0) + (s2.emissionStrength ?? 0),
          normal: s2.normal || s1.normal || null,
        }],
      };
    },
  },

  holdout: {
    label: 'Holdout',
    category: 'SHADER_MATERIAL',
    inputs: [],
    outputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    defaults: {},
    evaluate() {
      return {
        outputs: [{
          type: 'principled',
          baseColor: { r: 0, g: 0, b: 0 },
          metallic: 0,
          roughness: 1,
          normal: null,
          emission: null,
          emissionStrength: 0,
          alpha: 0,
        }],
      };
    },
  },

  background: {
    label: 'Background',
    category: 'SHADER_MATERIAL',
    inputs: [
      { name: 'Color',    type: SocketType.COLOR },
      { name: 'Strength', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Shader', type: SocketType.SHADER },
    ],
    defaults: { color: '#404040', strength: 1.0 },
    props: [
      { key: 'color',    label: 'Color',    type: 'color' },
      { key: 'strength', label: 'Strength', type: 'float', min: 0, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const defaultColor = hexToRgb(values.color || '#404040');
      const color    = inputs['Color'] || defaultColor;
      const strength = inputs['Strength'] ?? values.strength ?? 1.0;
      return {
        outputs: [{
          type: 'emission',
          baseColor: { r: 0, g: 0, b: 0 },
          metallic: 0,
          roughness: 1,
          normal: null,
          emission: color,
          emissionStrength: strength,
        }],
      };
    },
  },

  // ─── Input (new) ──────────────────────────────────────────────────

  shader_value: {
    label: 'Value',
    category: 'SHADER_INPUT',
    inputs: [],
    outputs: [
      { name: 'Value', type: SocketType.FLOAT },
    ],
    defaults: { value: 0.5 },
    props: [
      { key: 'value', label: 'Value', type: 'float', min: -1000, max: 1000, step: 0.01 },
    ],
    evaluate(values) {
      return { outputs: [parseFloat(values.value) || 0] };
    },
  },

  shader_geometry: {
    label: 'Geometry',
    category: 'SHADER_INPUT',
    inputs: [],
    outputs: [
      { name: 'Position',        type: SocketType.VECTOR },
      { name: 'Normal',          type: SocketType.VECTOR },
      { name: 'Tangent',         type: SocketType.VECTOR },
      { name: 'True Normal',     type: SocketType.VECTOR },
      { name: 'Incoming',        type: SocketType.VECTOR },
      { name: 'Parametric',      type: SocketType.VECTOR },
      { name: 'Backfacing',      type: SocketType.FLOAT },
      { name: 'Pointiness',      type: SocketType.FLOAT },
      { name: 'Random Per Island', type: SocketType.FLOAT },
    ],
    defaults: {},
    evaluate() {
      return {
        outputs: [
          { x: 0, y: 0, z: 0, _source: 'position' },
          { x: 0, y: 1, z: 0, _source: 'normal' },
          { x: 1, y: 0, z: 0, _source: 'tangent' },
          { x: 0, y: 1, z: 0, _source: 'true_normal' },
          { x: 0, y: 0, z: -1, _source: 'incoming' },
          { x: 0, y: 0, z: 0, _source: 'parametric' },
          0,    // backfacing
          0.5,  // pointiness
          0,    // random per island
        ],
      };
    },
  },

  light_path: {
    label: 'Light Path',
    category: 'SHADER_INPUT',
    inputs: [],
    outputs: [
      { name: 'Is Camera Ray',      type: SocketType.FLOAT },
      { name: 'Is Shadow Ray',      type: SocketType.FLOAT },
      { name: 'Is Diffuse Ray',     type: SocketType.FLOAT },
      { name: 'Is Glossy Ray',      type: SocketType.FLOAT },
      { name: 'Is Singular Ray',    type: SocketType.FLOAT },
      { name: 'Is Reflection Ray',  type: SocketType.FLOAT },
      { name: 'Is Transmission Ray', type: SocketType.FLOAT },
      { name: 'Ray Length',          type: SocketType.FLOAT },
      { name: 'Ray Depth',          type: SocketType.FLOAT },
      { name: 'Transparent Depth',  type: SocketType.FLOAT },
    ],
    defaults: {},
    evaluate() {
      // Static approximation for preview: assume camera ray
      return {
        outputs: [
          1,  // is camera ray
          0,  // is shadow ray
          0,  // is diffuse ray
          0,  // is glossy ray
          0,  // is singular ray
          0,  // is reflection ray
          0,  // is transmission ray
          1,  // ray length
          0,  // ray depth
          0,  // transparent depth
        ],
      };
    },
  },

  layer_weight: {
    label: 'Layer Weight',
    category: 'SHADER_INPUT',
    inputs: [
      { name: 'Blend',  type: SocketType.FLOAT },
      { name: 'Normal', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Fresnel', type: SocketType.FLOAT },
      { name: 'Facing',  type: SocketType.FLOAT },
    ],
    defaults: { blend: 0.5 },
    props: [
      { key: 'blend', label: 'Blend', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const blend = clamp01(inputs['Blend'] ?? values.blend ?? 0.5);
      // Approximate at 45 degree view angle
      const cosTheta = 0.707;
      const ior = (1 + blend) / Math.max(1 - blend, 0.001);
      const r0 = Math.pow((1 - ior) / (1 + ior), 2);
      const fresnelVal = clamp01(r0 + (1 - r0) * Math.pow(1 - cosTheta, 5));
      const facingVal = clamp01(1 - Math.pow(cosTheta, 1.0 / Math.max(blend, 0.001)));
      return { outputs: [fresnelVal, facingVal] };
    },
  },

  // ─── Texture (new) ────────────────────────────────────────────────

  checker_texture_shader: {
    label: 'Checker Texture',
    category: 'SHADER_TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Color1', type: SocketType.COLOR },
      { name: 'Color2', type: SocketType.COLOR },
      { name: 'Scale',  type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Fac',   type: SocketType.FLOAT },
    ],
    defaults: { scale: 5, color1: '#ffffff', color2: '#000000' },
    props: [
      { key: 'scale',  label: 'Scale',   type: 'float', min: 0.01, max: 100, step: 0.5 },
      { key: 'color1', label: 'Color 1', type: 'color' },
      { key: 'color2', label: 'Color 2', type: 'color' },
    ],
    evaluate(values, inputs) {
      const v  = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const sc = inputs['Scale'] ?? values.scale ?? 5;
      const c1 = inputs['Color1'] || hexToRgb(values.color1 || '#ffffff');
      const c2 = inputs['Color2'] || hexToRgb(values.color2 || '#000000');
      const ix = Math.floor((v.x ?? 0) * sc);
      const iy = Math.floor((v.y ?? 0) * sc);
      const iz = Math.floor((v.z ?? 0) * sc);
      const check = ((ix + iy + iz) % 2 + 2) % 2;
      const fac = check === 0 ? 1 : 0;
      const color = fac === 1 ? c1 : c2;
      return { outputs: [color, fac] };
    },
  },

  gradient_texture_shader: {
    label: 'Gradient Texture',
    category: 'SHADER_TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Fac',   type: SocketType.FLOAT },
    ],
    defaults: { type: 'linear' },
    props: [
      { key: 'type', label: 'Type', type: 'select', options: [
        { value: 'linear',      label: 'Linear' },
        { value: 'quadratic',   label: 'Quadratic' },
        { value: 'easing',      label: 'Easing' },
        { value: 'diagonal',    label: 'Diagonal' },
        { value: 'spherical',   label: 'Spherical' },
        { value: 'quadratic_sphere', label: 'Quadratic Sphere' },
        { value: 'radial',      label: 'Radial' },
      ]},
    ],
    evaluate(values, inputs) {
      const v = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const vx = v.x ?? 0, vy = v.y ?? 0, vz = v.z ?? 0;
      let fac = 0;
      switch (values.type || 'linear') {
        case 'linear':     fac = clamp01(vx); break;
        case 'quadratic':  fac = clamp01(vx * vx); break;
        case 'easing': {
          const t = clamp01(vx);
          fac = t * t * (3 - 2 * t);
          break;
        }
        case 'diagonal':   fac = clamp01((vx + vy) * 0.5); break;
        case 'spherical':  fac = clamp01(1 - Math.sqrt(vx * vx + vy * vy + vz * vz)); break;
        case 'quadratic_sphere': {
          const r = Math.sqrt(vx * vx + vy * vy + vz * vz);
          fac = clamp01(1 - r * r);
          break;
        }
        case 'radial':     fac = clamp01((Math.atan2(vy, vx) / (2 * Math.PI)) + 0.5); break;
      }
      return { outputs: [{ r: fac, g: fac, b: fac }, fac] };
    },
  },

  brick_texture_shader: {
    label: 'Brick Texture',
    category: 'SHADER_TEXTURE',
    inputs: [
      { name: 'Vector',       type: SocketType.VECTOR },
      { name: 'Color1',       type: SocketType.COLOR },
      { name: 'Color2',       type: SocketType.COLOR },
      { name: 'Mortar',       type: SocketType.COLOR },
      { name: 'Scale',        type: SocketType.FLOAT },
      { name: 'Mortar Size',  type: SocketType.FLOAT },
      { name: 'Mortar Smooth', type: SocketType.FLOAT },
      { name: 'Bias',         type: SocketType.FLOAT },
      { name: 'Brick Width',  type: SocketType.FLOAT },
      { name: 'Row Height',   type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Fac',   type: SocketType.FLOAT },
    ],
    defaults: { scale: 5, mortarSize: 0.02, color1: '#8b4513', color2: '#a0522d', mortarColor: '#cccccc' },
    props: [
      { key: 'scale',       label: 'Scale',        type: 'float', min: 0.01, max: 100, step: 0.5 },
      { key: 'mortarSize',  label: 'Mortar Size',   type: 'float', min: 0, max: 0.5, step: 0.01 },
      { key: 'color1',      label: 'Brick Color 1', type: 'color' },
      { key: 'color2',      label: 'Brick Color 2', type: 'color' },
      { key: 'mortarColor', label: 'Mortar Color',  type: 'color' },
    ],
    evaluate(values, inputs) {
      const v  = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const sc = inputs['Scale'] ?? values.scale ?? 5;
      const mortar = values.mortarSize ?? 0.02;
      const c1 = hexToRgb(values.color1 || '#8b4513');
      const c2 = hexToRgb(values.color2 || '#a0522d');
      const mc = hexToRgb(values.mortarColor || '#cccccc');
      const x = (v.x ?? 0) * sc;
      const y = (v.y ?? 0) * sc;
      const row = Math.floor(y);
      const offset = (row % 2) * 0.5;
      const bx = x + offset;
      const fx = bx - Math.floor(bx);
      const fy = y - row;
      // mortar test
      if (fx < mortar || fx > (1 - mortar) || fy < mortar || fy > (1 - mortar)) {
        return { outputs: [mc, 1] };
      }
      // alternate brick colors based on position
      const hash = ((Math.floor(bx) * 374761393 + row * 668265263) >>> 0) / 4294967296;
      const brickColor = hash > 0.5 ? c1 : c2;
      return { outputs: [brickColor, 0] };
    },
  },

  wave_texture_shader: {
    label: 'Wave Texture',
    category: 'SHADER_TEXTURE',
    inputs: [
      { name: 'Vector',          type: SocketType.VECTOR },
      { name: 'Scale',           type: SocketType.FLOAT },
      { name: 'Distortion',      type: SocketType.FLOAT },
      { name: 'Detail',          type: SocketType.FLOAT },
      { name: 'Detail Scale',    type: SocketType.FLOAT },
      { name: 'Detail Roughness', type: SocketType.FLOAT },
      { name: 'Phase Offset',    type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Fac',   type: SocketType.FLOAT },
    ],
    defaults: { scale: 5, distortion: 0, detail: 2, type: 'bands', profile: 'sine', direction: 'x' },
    props: [
      { key: 'scale',      label: 'Scale',      type: 'float', min: 0.01, max: 100, step: 0.5 },
      { key: 'distortion', label: 'Distortion', type: 'float', min: 0, max: 20, step: 0.1 },
      { key: 'detail',     label: 'Detail',     type: 'float', min: 0, max: 15, step: 0.5 },
      { key: 'type', label: 'Type', type: 'select', options: [
        { value: 'bands', label: 'Bands' },
        { value: 'rings', label: 'Rings' },
      ]},
      { key: 'profile', label: 'Profile', type: 'select', options: [
        { value: 'sine',     label: 'Sine' },
        { value: 'saw',      label: 'Saw' },
        { value: 'triangle', label: 'Triangle' },
      ]},
      { key: 'direction', label: 'Direction', type: 'select', options: [
        { value: 'x',        label: 'X' },
        { value: 'y',        label: 'Y' },
        { value: 'z',        label: 'Z' },
        { value: 'diagonal', label: 'Diagonal' },
      ]},
    ],
    evaluate(values, inputs) {
      const v  = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const sc = inputs['Scale'] ?? values.scale ?? 5;
      const vx = (v.x ?? 0) * sc, vy = (v.y ?? 0) * sc, vz = (v.z ?? 0) * sc;
      let coord;
      if (values.type === 'rings') {
        coord = Math.sqrt(vx * vx + vy * vy + vz * vz);
      } else {
        switch (values.direction || 'x') {
          case 'x': coord = vx; break;
          case 'y': coord = vy; break;
          case 'z': coord = vz; break;
          case 'diagonal': coord = (vx + vy + vz) / 1.732; break;
          default: coord = vx;
        }
      }
      const dist = values.distortion ?? 0;
      if (dist > 0) {
        const hash = (a, b, c) => {
          let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
          h = (h ^ (h >> 13)) * 1274126177;
          return ((h ^ (h >> 16)) >>> 0) / 4294967296;
        };
        coord += hash(Math.floor(vx * 10), Math.floor(vy * 10), Math.floor(vz * 10)) * dist;
      }
      let fac;
      switch (values.profile || 'sine') {
        case 'sine':     fac = (Math.sin(coord * Math.PI * 2) + 1) * 0.5; break;
        case 'saw':      fac = (coord % 1 + 1) % 1; break;
        case 'triangle': fac = Math.abs(2 * ((coord % 1 + 1) % 1) - 1); break;
        default:         fac = (Math.sin(coord * Math.PI * 2) + 1) * 0.5;
      }
      fac = clamp01(fac);
      return { outputs: [{ r: fac, g: fac, b: fac }, fac] };
    },
  },

  magic_texture_shader: {
    label: 'Magic Texture',
    category: 'SHADER_TEXTURE',
    inputs: [
      { name: 'Vector',     type: SocketType.VECTOR },
      { name: 'Scale',      type: SocketType.FLOAT },
      { name: 'Distortion', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Fac',   type: SocketType.FLOAT },
    ],
    defaults: { scale: 5, depth: 2, distortion: 1.0 },
    props: [
      { key: 'scale',      label: 'Scale',      type: 'float', min: 0.01, max: 100, step: 0.5 },
      { key: 'depth',      label: 'Depth',      type: 'int', min: 0, max: 10, step: 1 },
      { key: 'distortion', label: 'Distortion', type: 'float', min: 0, max: 10, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const v  = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const sc = inputs['Scale'] ?? values.scale ?? 5;
      const depth = values.depth ?? 2;
      const dist = values.distortion ?? 1.0;
      let x = (v.x ?? 0) * sc, y = (v.y ?? 0) * sc, z = (v.z ?? 0) * sc;
      // Iterative turbulence
      for (let i = 0; i < depth; i++) {
        const nx = Math.sin(y * dist + x);
        const ny = Math.sin(z * dist + y);
        const nz = Math.sin(x * dist + z);
        x = nx; y = ny; z = nz;
      }
      const r = clamp01((Math.sin(x) + 1) * 0.5);
      const g = clamp01((Math.sin(y) + 1) * 0.5);
      const b = clamp01((Math.sin(z) + 1) * 0.5);
      const fac = (r + g + b) / 3;
      return { outputs: [{ r, g, b }, fac] };
    },
  },

  white_noise_texture_shader: {
    label: 'White Noise Texture',
    category: 'SHADER_TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'W',      type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Value', type: SocketType.FLOAT },
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { dimensions: '3D' },
    props: [
      { key: 'dimensions', label: 'Dimensions', type: 'select', options: [
        { value: '1D', label: '1D' }, { value: '2D', label: '2D' },
        { value: '3D', label: '3D' }, { value: '4D', label: '4D' },
      ]},
    ],
    evaluate(values, inputs) {
      const v = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      const hash = (a, b, c) => {
        let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
        h = (h ^ (h >> 13)) * 1274126177;
        return ((h ^ (h >> 16)) >>> 0) / 4294967296;
      };
      const ix = Math.floor((v.x ?? 0) * 1000);
      const iy = Math.floor((v.y ?? 0) * 1000);
      const iz = Math.floor((v.z ?? 0) * 1000);
      const val = hash(ix, iy, iz);
      return {
        outputs: [
          val,
          { r: hash(ix + 17, iy + 31, iz + 59), g: hash(ix + 73, iy + 97, iz + 113), b: hash(ix + 151, iy + 173, iz + 199) },
        ],
      };
    },
  },

  // ─── Color (new) ──────────────────────────────────────────────────

  hue_saturation_value: {
    label: 'Hue/Saturation/Value',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Hue',        type: SocketType.FLOAT },
      { name: 'Saturation', type: SocketType.FLOAT },
      { name: 'Value',      type: SocketType.FLOAT },
      { name: 'Fac',        type: SocketType.FLOAT },
      { name: 'Color',      type: SocketType.COLOR },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { hue: 0.5, saturation: 1, value: 1, fac: 1 },
    props: [
      { key: 'hue',        label: 'Hue',        type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'saturation', label: 'Saturation', type: 'float', min: 0, max: 2, step: 0.01 },
      { key: 'value',      label: 'Value',      type: 'float', min: 0, max: 2, step: 0.01 },
      { key: 'fac',        label: 'Factor',     type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const color = inputs['Color'] || { r: 0.5, g: 0.5, b: 0.5 };
      const hueShift = (inputs['Hue'] ?? values.hue ?? 0.5) - 0.5;
      const satMul   = inputs['Saturation'] ?? values.saturation ?? 1;
      const valMul   = inputs['Value'] ?? values.value ?? 1;
      const fac      = clamp01(inputs['Fac'] ?? values.fac ?? 1);
      // RGB to HSV
      const r = color.r ?? 0, g = color.g ?? 0, b = color.b ?? 0;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const d = mx - mn;
      let h = 0, s = mx === 0 ? 0 : d / mx, v = mx;
      if (d !== 0) {
        if (mx === r) h = ((g - b) / d + 6) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
      }
      // Apply adjustments
      h = ((h + hueShift) % 1 + 1) % 1;
      s = clamp01(s * satMul);
      v = clamp01(v * valMul);
      // HSV to RGB
      const hi = Math.floor(h * 6);
      const f = h * 6 - hi;
      const p = v * (1 - s);
      const q = v * (1 - f * s);
      const t = v * (1 - (1 - f) * s);
      let rr, gg, bb;
      switch (hi % 6) {
        case 0: rr = v; gg = t; bb = p; break;
        case 1: rr = q; gg = v; bb = p; break;
        case 2: rr = p; gg = v; bb = t; break;
        case 3: rr = p; gg = q; bb = v; break;
        case 4: rr = t; gg = p; bb = v; break;
        case 5: rr = v; gg = p; bb = q; break;
        default: rr = v; gg = t; bb = p;
      }
      return {
        outputs: [{
          r: r + (rr - r) * fac,
          g: g + (gg - g) * fac,
          b: b + (bb - b) * fac,
        }],
      };
    },
  },

  brightness_contrast: {
    label: 'Brightness/Contrast',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Color',      type: SocketType.COLOR },
      { name: 'Bright',     type: SocketType.FLOAT },
      { name: 'Contrast',   type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { bright: 0, contrast: 0 },
    props: [
      { key: 'bright',   label: 'Bright',   type: 'float', min: -1, max: 1, step: 0.01 },
      { key: 'contrast', label: 'Contrast', type: 'float', min: -1, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const color = inputs['Color'] || { r: 0.5, g: 0.5, b: 0.5 };
      const bright   = inputs['Bright'] ?? values.bright ?? 0;
      const contrast = inputs['Contrast'] ?? values.contrast ?? 0;
      const factor = (1 + contrast);
      return {
        outputs: [{
          r: clamp01((color.r - 0.5) * factor + 0.5 + bright),
          g: clamp01((color.g - 0.5) * factor + 0.5 + bright),
          b: clamp01((color.b - 0.5) * factor + 0.5 + bright),
        }],
      };
    },
  },

  gamma: {
    label: 'Gamma',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Gamma', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { gamma: 1.0 },
    props: [
      { key: 'gamma', label: 'Gamma', type: 'float', min: 0.01, max: 10, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const color = inputs['Color'] || { r: 0.5, g: 0.5, b: 0.5 };
      const g = inputs['Gamma'] ?? values.gamma ?? 1.0;
      const invG = g !== 0 ? 1 / g : 1;
      return {
        outputs: [{
          r: clamp01(Math.pow(Math.max(color.r, 0), invG)),
          g: clamp01(Math.pow(Math.max(color.g, 0), invG)),
          b: clamp01(Math.pow(Math.max(color.b, 0), invG)),
        }],
      };
    },
  },

  invert_color: {
    label: 'Invert Color',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Fac',   type: SocketType.FLOAT },
      { name: 'Color', type: SocketType.COLOR },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { fac: 1 },
    props: [
      { key: 'fac', label: 'Factor', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const color = inputs['Color'] || { r: 0.5, g: 0.5, b: 0.5 };
      const fac = clamp01(inputs['Fac'] ?? values.fac ?? 1);
      return {
        outputs: [{
          r: color.r + (1 - 2 * color.r) * fac,
          g: color.g + (1 - 2 * color.g) * fac,
          b: color.b + (1 - 2 * color.b) * fac,
        }],
      };
    },
  },

  // ─── Vector (new) ─────────────────────────────────────────────────

  normal_map: {
    label: 'Normal Map',
    category: 'SHADER_VECTOR',
    inputs: [
      { name: 'Strength', type: SocketType.FLOAT },
      { name: 'Color',    type: SocketType.COLOR },
    ],
    outputs: [
      { name: 'Normal', type: SocketType.VECTOR },
    ],
    defaults: { strength: 1.0, space: 'tangent' },
    props: [
      { key: 'strength', label: 'Strength', type: 'float', min: 0, max: 10, step: 0.01 },
      { key: 'space', label: 'Space', type: 'select', options: [
        { value: 'tangent', label: 'Tangent Space' },
        { value: 'object',  label: 'Object Space' },
        { value: 'world',   label: 'World Space' },
      ]},
    ],
    evaluate(values, inputs) {
      const strength = inputs['Strength'] ?? values.strength ?? 1.0;
      const color = inputs['Color'] || { r: 0.5, g: 0.5, b: 1.0 };
      // Convert normal map color (0-1) to normal vector (-1 to 1)
      const nx = (color.r * 2 - 1) * strength;
      const ny = (color.g * 2 - 1) * strength;
      const nz = color.b * 2 - 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      return { outputs: [{ x: nx / len, y: ny / len, z: nz / len }] };
    },
  },

  bump: {
    label: 'Bump',
    category: 'SHADER_VECTOR',
    inputs: [
      { name: 'Strength', type: SocketType.FLOAT },
      { name: 'Distance', type: SocketType.FLOAT },
      { name: 'Height',   type: SocketType.FLOAT },
      { name: 'Normal',   type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Normal', type: SocketType.VECTOR },
    ],
    defaults: { strength: 1.0, distance: 0.1, invert: false },
    props: [
      { key: 'strength', label: 'Strength', type: 'float', min: 0, max: 10, step: 0.01 },
      { key: 'distance', label: 'Distance', type: 'float', min: 0, max: 10, step: 0.01 },
      { key: 'invert',   label: 'Invert',   type: 'bool' },
    ],
    evaluate(values, inputs) {
      const strength = inputs['Strength'] ?? values.strength ?? 1.0;
      const height   = inputs['Height'] ?? 0;
      const normal   = inputs['Normal'] || { x: 0, y: 1, z: 0 };
      const sign = values.invert ? -1 : 1;
      // Approximate: perturb normal based on height
      const perturbX = height * strength * sign * 0.5;
      const perturbZ = height * strength * sign * 0.5;
      const nx = (normal.x ?? 0) + perturbX;
      const ny = normal.y ?? 1;
      const nz = (normal.z ?? 0) + perturbZ;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      return { outputs: [{ x: nx / len, y: ny / len, z: nz / len }] };
    },
  },

  // ─── Converter (new) ──────────────────────────────────────────────

  shader_combine_xyz: {
    label: 'Combine XYZ',
    category: 'SHADER_CONVERTER',
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
      return {
        outputs: [{
          x: inputs['X'] ?? values.x ?? 0,
          y: inputs['Y'] ?? values.y ?? 0,
          z: inputs['Z'] ?? values.z ?? 0,
        }],
      };
    },
  },

  shader_separate_xyz: {
    label: 'Separate XYZ',
    category: 'SHADER_CONVERTER',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'X', type: SocketType.FLOAT },
      { name: 'Y', type: SocketType.FLOAT },
      { name: 'Z', type: SocketType.FLOAT },
    ],
    defaults: {},
    evaluate(values, inputs) {
      const v = inputs['Vector'] || { x: 0, y: 0, z: 0 };
      return { outputs: [v.x ?? 0, v.y ?? 0, v.z ?? 0] };
    },
  },

  shader_map_range: {
    label: 'Map Range',
    category: 'SHADER_CONVERTER',
    inputs: [
      { name: 'Value',    type: SocketType.FLOAT },
      { name: 'From Min', type: SocketType.FLOAT },
      { name: 'From Max', type: SocketType.FLOAT },
      { name: 'To Min',   type: SocketType.FLOAT },
      { name: 'To Max',   type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Result', type: SocketType.FLOAT },
    ],
    defaults: { value: 0.5, fromMin: 0, fromMax: 1, toMin: 0, toMax: 1, interpolation: 'linear', clamp: true },
    props: [
      { key: 'interpolation', label: 'Interpolation', type: 'select', options: [
        { value: 'linear', label: 'Linear' },
        { value: 'stepped', label: 'Stepped Linear' },
        { value: 'smooth', label: 'Smooth Step' },
        { value: 'smoother', label: 'Smoother Step' },
      ]},
      { key: 'clamp', label: 'Clamp', type: 'bool' },
      { key: 'value', label: 'Value', type: 'float', min: -1000, max: 1000, step: 0.01 },
      { key: 'fromMin', label: 'From Min', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'fromMax', label: 'From Max', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'toMin', label: 'To Min', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'toMax', label: 'To Max', type: 'float', min: -1000, max: 1000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const v = inputs['Value'] ?? values.value;
      const fMin = inputs['From Min'] ?? values.fromMin;
      const fMax = inputs['From Max'] ?? values.fromMax;
      const tMin = inputs['To Min'] ?? values.toMin;
      const tMax = inputs['To Max'] ?? values.toMax;
      const range = fMax - fMin;
      let t = range !== 0 ? (v - fMin) / range : 0;
      if (values.clamp) t = clamp01(t);
      switch (values.interpolation) {
        case 'smooth': t = t * t * (3 - 2 * t); break;
        case 'smoother': t = t * t * t * (t * (t * 6 - 15) + 10); break;
        case 'stepped': t = Math.floor(t * 4) / 4; break;
      }
      return { outputs: [tMin + t * (tMax - tMin)] };
    },
  },

  shader_clamp: {
    label: 'Clamp',
    category: 'SHADER_CONVERTER',
    inputs: [
      { name: 'Value', type: SocketType.FLOAT },
      { name: 'Min',   type: SocketType.FLOAT },
      { name: 'Max',   type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Result', type: SocketType.FLOAT },
    ],
    defaults: { value: 1, min: 0, max: 1, clampType: 'min_max' },
    props: [
      { key: 'clampType', label: 'Clamp Type', type: 'select', options: [
        { value: 'min_max', label: 'Min Max' },
        { value: 'range', label: 'Range' },
      ]},
      { key: 'value', label: 'Value', type: 'float', min: -1000, max: 1000, step: 0.01 },
      { key: 'min', label: 'Min', type: 'float', min: -1000, max: 1000, step: 0.01 },
      { key: 'max', label: 'Max', type: 'float', min: -1000, max: 1000, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const v = inputs['Value'] ?? values.value;
      let mn = inputs['Min'] ?? values.min;
      let mx = inputs['Max'] ?? values.max;
      if (values.clampType === 'range' && mn > mx) { const t = mn; mn = mx; mx = t; }
      return { outputs: [Math.min(Math.max(v, mn), mx)] };
    },
  },

  shader_rgb_curves: {
    label: 'RGB Curves',
    category: 'SHADER_COLOR',
    inputs: [
      { name: 'Fac',   type: SocketType.FLOAT },
      { name: 'Color', type: SocketType.COLOR },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { fac: 1 },
    props: [
      { key: 'fac', label: 'Factor', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const color = inputs['Color'] || { r: 0.5, g: 0.5, b: 0.5 };
      // Passthrough - curves not implemented in simplified editor
      return { outputs: [color] };
    },
  },

  object_info: {
    label: 'Object Info',
    category: 'SHADER_INPUT',
    inputs: [],
    outputs: [
      { name: 'Location', type: SocketType.VECTOR },
      { name: 'Color',    type: SocketType.COLOR },
      { name: 'Alpha',    type: SocketType.FLOAT },
      { name: 'Object Index', type: SocketType.FLOAT },
      { name: 'Random',   type: SocketType.FLOAT },
    ],
    defaults: {},
    evaluate() {
      return {
        outputs: [
          { x: 0, y: 0, z: 0 },
          { r: 1, g: 1, b: 1 },
          1,
          0,
          0.5,
        ],
      };
    },
  },

  uv_map: {
    label: 'UV Map',
    category: 'SHADER_INPUT',
    inputs: [],
    outputs: [
      { name: 'UV', type: SocketType.VECTOR },
    ],
    defaults: {},
    evaluate() {
      return { outputs: [{ x: 0, y: 0, z: 0, _source: 'uv' }] };
    },
  },

  ambient_occlusion: {
    label: 'Ambient Occlusion',
    category: 'SHADER_INPUT',
    inputs: [
      { name: 'Color',    type: SocketType.COLOR },
      { name: 'Distance', type: SocketType.FLOAT },
      { name: 'Normal',   type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'AO',    type: SocketType.FLOAT },
    ],
    defaults: { distance: 1, samples: 16, insideOnly: false },
    props: [
      { key: 'samples', label: 'Samples', type: 'int', min: 1, max: 128, step: 1 },
      { key: 'insideOnly', label: 'Inside', type: 'bool' },
      { key: 'distance', label: 'Distance', type: 'float', min: 0, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const color = inputs['Color'] || { r: 1, g: 1, b: 1 };
      return { outputs: [color, 1.0] };
    },
  },

  vector_displacement: {
    label: 'Displacement',
    category: 'SHADER_VECTOR',
    inputs: [
      { name: 'Height', type: SocketType.FLOAT },
      { name: 'Midlevel', type: SocketType.FLOAT },
      { name: 'Scale',  type: SocketType.FLOAT },
      { name: 'Normal', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Displacement', type: SocketType.VECTOR },
    ],
    defaults: { height: 0, midlevel: 0.5, scale: 1 },
    props: [
      { key: 'height',   label: 'Height',   type: 'float', min: -10, max: 10, step: 0.01 },
      { key: 'midlevel', label: 'Midlevel', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'scale',    label: 'Scale',    type: 'float', min: 0, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const h = inputs['Height'] ?? values.height ?? 0;
      const mid = inputs['Midlevel'] ?? values.midlevel ?? 0.5;
      const sc = inputs['Scale'] ?? values.scale ?? 1;
      const n = inputs['Normal'] || { x: 0, y: 1, z: 0 };
      const d = (h - mid) * sc;
      return { outputs: [{ x: n.x * d, y: n.y * d, z: n.z * d }] };
    },
  },
});
