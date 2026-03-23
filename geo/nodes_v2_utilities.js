/**
 * geo/nodes_v2_utilities.js - Utility and flow control nodes.
 *
 * Nodes: switch, noise_texture, domain_size
 *
 * Verified against Blender source:
 *   source/blender/nodes/geometry/nodes/node_geo_switch.cc
 *   source/blender/nodes/shader/nodes/node_shader_tex_noise.cc
 */

import { SocketType } from '../core/registry.js';
import {
  GeometrySet,
  DOMAIN,
} from '../core/geometry.js';
import { Field, isField, combineFields, resolveScalar } from '../core/field.js';
import { seededRandom, perlinNoise3D } from '../core/utils.js';

export function registerUtilityNodes(registry) {
  // ── Categories ──────────────────────────────────────────────────────────
  registry.addCategory('geo', 'UTILITIES', { name: 'Utilities', color: '#78909C', icon: '⚙' });
  registry.addCategory('geo', 'TEXTURE', { name: 'Texture', color: '#E91E63', icon: '◆' });

  // ── 1. Switch ───────────────────────────────────────────────────────────
  // Blender: node_geo_switch.cc
  // Routes either the "False" or "True" input to "Output" based on Switch bool.
  //
  // Inputs: Switch (bool), False (dynamic type), True (dynamic type)
  // Output: Output (dynamic type)
  // Property: input_type (Float, Int, Bool, Vector, Color, Geometry)
  //
  // Dynamic: socket types change based on input_type property

  registry.addNode('geo', 'switch', {
    label: 'Switch',
    category: 'UTILITIES',
    defaults: { input_type: 'FLOAT' },
    getInputs(values) {
      const type = values.input_type || 'FLOAT';
      const socketType = switchTypeToSocket(type);
      return [
        { name: 'Switch', type: SocketType.BOOL },
        { name: 'False', type: socketType },
        { name: 'True', type: socketType },
      ];
    },
    getOutputs(values) {
      const type = values.input_type || 'FLOAT';
      const socketType = switchTypeToSocket(type);
      return [
        { name: 'Output', type: socketType },
      ];
    },
    getProps() {
      return [
        {
          key: 'input_type', label: 'Type', type: 'select',
          options: [
            { value: 'FLOAT', label: 'Float' },
            { value: 'INT', label: 'Integer' },
            { value: 'BOOLEAN', label: 'Boolean' },
            { value: 'VECTOR', label: 'Vector' },
            { value: 'COLOR', label: 'Color' },
            { value: 'GEOMETRY', label: 'Geometry' },
          ],
        },
      ];
    },
    evaluate(values, inputs) {
      const switchVal = inputs['Switch'];
      const resolved = resolveScalar(switchVal, false);
      const output = resolved ? inputs['True'] : inputs['False'];

      // Handle field-based switch for non-geometry types
      if (isField(switchVal) && values.input_type !== 'GEOMETRY') {
        const falseVal = inputs['False'];
        const trueVal = inputs['True'];
        const type = values.input_type || 'FLOAT';
        const fieldType = type === 'VECTOR' ? 'vector' :
                          type === 'INT' ? 'int' :
                          type === 'BOOLEAN' ? 'bool' : 'float';

        return { outputs: [new Field(fieldType, (el) => {
          const sw = switchVal.evaluateAt(el);
          const f = isField(falseVal) ? falseVal.evaluateAt(el) : falseVal;
          const t = isField(trueVal) ? trueVal.evaluateAt(el) : trueVal;
          return sw ? t : f;
        })] };
      }

      return { outputs: [output ?? getDefaultForType(values.input_type)] };
    },
  });

  // ── 2. Noise Texture ────────────────────────────────────────────────────
  // Blender: node_shader_tex_noise.cc (also used in geometry nodes)
  // Procedural noise texture using Perlin noise.
  //
  // Inputs: Vector (vector field), Scale (float 5.0), Detail (float 2.0),
  //         Roughness (float 0.5), Lacunarity (float 2.0), Distortion (float 0.0)
  // Outputs: Fac (float field 0-1), Color (color field)
  // Property: Dimensions (1D, 2D, 3D, 4D) - we implement 3D

  registry.addNode('geo', 'noise_texture', {
    label: 'Noise Texture',
    category: 'TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Scale', type: SocketType.FLOAT },
      { name: 'Detail', type: SocketType.FLOAT },
      { name: 'Roughness', type: SocketType.FLOAT },
      { name: 'Lacunarity', type: SocketType.FLOAT },
      { name: 'Distortion', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Fac', type: SocketType.FLOAT },
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: {
      scale: 5.0,
      detail: 2.0,
      roughness: 0.5,
      lacunarity: 2.0,
      distortion: 0.0,
      dimensions: '3D',
    },
    props: [
      { key: 'scale', label: 'Scale', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'detail', label: 'Detail', type: 'float', min: 0, max: 15, step: 0.1 },
      { key: 'roughness', label: 'Roughness', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'lacunarity', label: 'Lacunarity', type: 'float', min: 0, max: 10, step: 0.1 },
      { key: 'distortion', label: 'Distortion', type: 'float', min: -1000, max: 1000, step: 0.1 },
      {
        key: 'dimensions', label: 'Dimensions', type: 'select',
        options: [
          { value: '1D', label: '1D' },
          { value: '2D', label: '2D' },
          { value: '3D', label: '3D' },
          { value: '4D', label: '4D' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const scaleInput = inputs['Scale'];
      const detailInput = inputs['Detail'];
      const roughnessInput = inputs['Roughness'];
      const lacunarityInput = inputs['Lacunarity'];
      const distortionInput = inputs['Distortion'];
      const vectorInput = inputs['Vector'];

      const scale = scaleInput != null ? scaleInput : values.scale;
      const detail = detailInput != null ? detailInput : values.detail;
      const roughness = roughnessInput != null ? roughnessInput : values.roughness;
      const lacunarity = lacunarityInput != null ? lacunarityInput : values.lacunarity;
      const distortion = distortionInput != null ? distortionInput : values.distortion;

      // Check if any input is a field
      const hasField = isField(vectorInput) || isField(scale) || isField(detail)
        || isField(roughness) || isField(lacunarity) || isField(distortion);

      function computeNoise(pos, sc, det, rough, lac, dist) {
        const s = typeof sc === 'number' ? sc : resolveScalar(sc, 5);
        const d = typeof det === 'number' ? det : resolveScalar(det, 2);
        const r = typeof rough === 'number' ? rough : resolveScalar(rough, 0.5);
        const l = typeof lac === 'number' ? lac : resolveScalar(lac, 2);
        const di = typeof dist === 'number' ? dist : resolveScalar(dist, 0);

        let px = (pos?.x ?? 0) * s;
        let py = (pos?.y ?? 0) * s;
        let pz = (pos?.z ?? 0) * s;

        // Apply distortion
        if (di !== 0) {
          px += perlinNoise3D(px + 13.5, py + 13.5, pz + 13.5) * di;
          py += perlinNoise3D(px + 13.5, py + 13.5, pz + 13.5) * di;
          pz += perlinNoise3D(px + 13.5, py + 13.5, pz + 13.5) * di;
        }

        // fBm (fractal Brownian motion) using Perlin noise
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxAmplitude = 0;
        const octaves = Math.max(0, Math.min(Math.floor(d) + 1, 16));

        for (let i = 0; i < octaves; i++) {
          value += perlinNoise3D(px * frequency, py * frequency, pz * frequency) * amplitude;
          maxAmplitude += amplitude;
          amplitude *= r;
          frequency *= l;
        }

        // Fractional octave
        const frac = d - Math.floor(d);
        if (frac > 0 && octaves < 16) {
          value += perlinNoise3D(px * frequency, py * frequency, pz * frequency) * amplitude * frac;
          maxAmplitude += amplitude * frac;
        }

        if (maxAmplitude > 0) {
          value /= maxAmplitude;
        }

        // Map from [-1,1] to [0,1]
        const fac = value * 0.5 + 0.5;
        return Math.max(0, Math.min(1, fac));
      }

      if (hasField) {
        const facField = new Field('float', (el) => {
          const pos = isField(vectorInput) ? vectorInput.evaluateAt(el) : (vectorInput || el.position);
          const sc = isField(scale) ? scale.evaluateAt(el) : scale;
          const det = isField(detail) ? detail.evaluateAt(el) : detail;
          const rough = isField(roughness) ? roughness.evaluateAt(el) : roughness;
          const lac = isField(lacunarity) ? lacunarity.evaluateAt(el) : lacunarity;
          const dist = isField(distortion) ? distortion.evaluateAt(el) : distortion;
          return computeNoise(pos, sc, det, rough, lac, dist);
        });

        const colorField = new Field('color', (el) => {
          const pos = isField(vectorInput) ? vectorInput.evaluateAt(el) : (vectorInput || el.position);
          const sc = isField(scale) ? scale.evaluateAt(el) : scale;
          const det = isField(detail) ? detail.evaluateAt(el) : detail;
          const rough = isField(roughness) ? roughness.evaluateAt(el) : roughness;
          const lac = isField(lacunarity) ? lacunarity.evaluateAt(el) : lacunarity;
          const dist = isField(distortion) ? distortion.evaluateAt(el) : distortion;
          // Use offset positions for RGB channels
          const r = computeNoise(pos, sc, det, rough, lac, dist);
          const p2 = { x: (pos?.x ?? 0) + 100, y: (pos?.y ?? 0) + 100, z: (pos?.z ?? 0) + 100 };
          const g = computeNoise(p2, sc, det, rough, lac, dist);
          const p3 = { x: (pos?.x ?? 0) + 200, y: (pos?.y ?? 0) + 200, z: (pos?.z ?? 0) + 200 };
          const b = computeNoise(p3, sc, det, rough, lac, dist);
          return { r, g, b, a: 1 };
        });

        return { outputs: [facField, colorField] };
      }

      // Non-field evaluation
      const pos = vectorInput || { x: 0, y: 0, z: 0 };
      const fac = computeNoise(pos, scale, detail, roughness, lacunarity, distortion);
      const p2 = { x: pos.x + 100, y: pos.y + 100, z: pos.z + 100 };
      const g = computeNoise(p2, scale, detail, roughness, lacunarity, distortion);
      const p3 = { x: pos.x + 200, y: pos.y + 200, z: pos.z + 200 };
      const b = computeNoise(p3, scale, detail, roughness, lacunarity, distortion);

      return { outputs: [fac, { r: fac, g, b, a: 1 }] };
    },
  });

  // ── 3. Domain Size ──────────────────────────────────────────────────────
  // Blender: node_geo_attribute_domain_size.cc
  // Returns the number of elements in each domain.
  //
  // Input: Geometry
  // Outputs: Point Count, Edge Count, Face Count, Face Corner Count,
  //          Spline Count, Instance Count

  registry.addNode('geo', 'domain_size', {
    label: 'Domain Size',
    category: 'UTILITIES',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    outputs: [
      { name: 'Point Count', type: SocketType.INT },
      { name: 'Edge Count', type: SocketType.INT },
      { name: 'Face Count', type: SocketType.INT },
      { name: 'Face Corner Count', type: SocketType.INT },
      { name: 'Spline Count', type: SocketType.INT },
      { name: 'Instance Count', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) {
        return { outputs: [0, 0, 0, 0, 0, 0] };
      }
      return { outputs: [
        geo.domainSize(DOMAIN.POINT),
        geo.domainSize(DOMAIN.EDGE),
        geo.domainSize(DOMAIN.FACE),
        geo.domainSize(DOMAIN.CORNER),
        geo.domainSize(DOMAIN.SPLINE),
        geo.domainSize(DOMAIN.INSTANCE),
      ]};
    },
  });
}

// ── Helper functions ─────────────────────────────────────────────────────────

function switchTypeToSocket(type) {
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

function getDefaultForType(type) {
  switch (type) {
    case 'FLOAT': return 0;
    case 'INT': return 0;
    case 'BOOLEAN': return false;
    case 'VECTOR': return { x: 0, y: 0, z: 0 };
    case 'COLOR': return { r: 0, g: 0, b: 0, a: 1 };
    case 'GEOMETRY': return new GeometrySet();
    default: return 0;
  }
}
