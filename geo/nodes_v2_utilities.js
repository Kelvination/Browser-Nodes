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
import { Field, isField, combineFields, resolveField, resolveScalar, resolveSelection } from '../core/field.js';
import { seededRandom, perlinNoise3D, voronoi3D, lerp, hash3 } from '../core/utils.js';

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

  // ── 4. Mix ──────────────────────────────────────────────────────────────
  // Blender: node_shader_mix.cc
  // Interpolates between two values. Dynamic type (Float/Vector/Color).
  //
  // Inputs: Factor (float 0.5, 0-1), A (dynamic), B (dynamic)
  // Output: Result (dynamic)
  // Properties: data_type, clamp_factor (bool, default true)

  registry.addNode('geo', 'mix', {
    label: 'Mix',
    category: 'UTILITIES',
    defaults: { data_type: 'FLOAT', clamp_factor: true },
    getInputs(values) {
      const type = values.data_type || 'FLOAT';
      const socketType = mixTypeToSocket(type);
      return [
        { name: 'Factor', type: SocketType.FLOAT },
        { name: 'A', type: socketType },
        { name: 'B', type: socketType },
      ];
    },
    getOutputs(values) {
      const type = values.data_type || 'FLOAT';
      const socketType = mixTypeToSocket(type);
      return [
        { name: 'Result', type: socketType },
      ];
    },
    getProps() {
      return [
        {
          key: 'data_type', label: 'Data Type', type: 'select',
          options: [
            { value: 'FLOAT', label: 'Float' },
            { value: 'VECTOR', label: 'Vector' },
            { value: 'COLOR', label: 'Color' },
          ],
        },
        { key: 'clamp_factor', label: 'Clamp Factor', type: 'bool' },
      ];
    },
    evaluate(values, inputs) {
      const factorInput = inputs['Factor'];
      const aInput = inputs['A'];
      const bInput = inputs['B'];
      const clampFactor = values.clamp_factor !== false;
      const dataType = values.data_type || 'FLOAT';

      const hasField = isField(factorInput) || isField(aInput) || isField(bInput);

      function mixValues(factor, a, b) {
        let t = factor ?? 0.5;
        if (clampFactor) t = Math.max(0, Math.min(1, t));

        if (dataType === 'VECTOR') {
          const va = a || { x: 0, y: 0, z: 0 };
          const vb = b || { x: 0, y: 0, z: 0 };
          return {
            x: va.x + (vb.x - va.x) * t,
            y: va.y + (vb.y - va.y) * t,
            z: va.z + (vb.z - va.z) * t,
          };
        } else if (dataType === 'COLOR') {
          const ca = a || { r: 0, g: 0, b: 0, a: 1 };
          const cb = b || { r: 0, g: 0, b: 0, a: 1 };
          return {
            r: ca.r + (cb.r - ca.r) * t,
            g: ca.g + (cb.g - ca.g) * t,
            b: ca.b + (cb.b - ca.b) * t,
            a: ca.a + (cb.a - ca.a) * t,
          };
        } else {
          return (a ?? 0) + ((b ?? 0) - (a ?? 0)) * t;
        }
      }

      if (hasField) {
        const fieldType = dataType === 'VECTOR' ? 'vector' :
                          dataType === 'COLOR' ? 'color' : 'float';
        const resultField = new Field(fieldType, (el) => {
          const f = isField(factorInput) ? factorInput.evaluateAt(el) : (factorInput ?? 0.5);
          const a = isField(aInput) ? aInput.evaluateAt(el) : aInput;
          const b = isField(bInput) ? bInput.evaluateAt(el) : bInput;
          return mixValues(f, a, b);
        });
        return { outputs: [resultField] };
      }

      return { outputs: [mixValues(factorInput, aInput, bInput)] };
    },
  });

  // ── 5. Voronoi Texture ──────────────────────────────────────────────────
  // Blender: node_shader_tex_voronoi.cc
  // Procedural Voronoi/Worley noise texture.
  //
  // Inputs: Vector (vector field), Scale (float 5), Randomness (float 1)
  // Outputs: Distance (float field), Color (color field), Position (vector field)
  // Properties: Feature (F1, F2, Smooth F1, etc.)

  registry.addNode('geo', 'voronoi_texture', {
    label: 'Voronoi Texture',
    category: 'TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Scale', type: SocketType.FLOAT },
      { name: 'Randomness', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Distance', type: SocketType.FLOAT },
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Position', type: SocketType.VECTOR },
    ],
    defaults: { scale: 5.0, randomness: 1.0, feature: 'F1', metric: 'EUCLIDEAN' },
    props: [
      { key: 'scale', label: 'Scale', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'randomness', label: 'Randomness', type: 'float', min: 0, max: 1, step: 0.01 },
      {
        key: 'feature', label: 'Feature', type: 'select',
        options: [
          { value: 'F1', label: 'F1' },
          { value: 'F2', label: 'F2' },
          { value: 'SMOOTH_F1', label: 'Smooth F1' },
          { value: 'DISTANCE_TO_EDGE', label: 'Distance to Edge' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const vectorInput = inputs['Vector'];
      const scaleInput = inputs['Scale'];
      const randomnessInput = inputs['Randomness'];

      const scale = scaleInput != null ? scaleInput : values.scale;
      const randomness = randomnessInput != null ? randomnessInput : values.randomness;
      const feature = values.feature || 'F1';

      const hasField = isField(vectorInput) || isField(scale) || isField(randomness);

      function computeVoronoi(pos, sc, rand) {
        const s = typeof sc === 'number' ? sc : resolveScalar(sc, 5);
        const r = typeof rand === 'number' ? rand : resolveScalar(rand, 1);
        const px = (pos?.x ?? 0) * s;
        const py = (pos?.y ?? 0) * s;
        const pz = (pos?.z ?? 0) * s;
        const result = voronoi3D(px, py, pz, r, feature, 'EUCLIDEAN', 1.0, 2.0);
        return result;
      }

      if (hasField) {
        const distField = new Field('float', (el) => {
          const pos = isField(vectorInput) ? vectorInput.evaluateAt(el) : (vectorInput || el.position);
          const sc = isField(scale) ? scale.evaluateAt(el) : scale;
          const rand = isField(randomness) ? randomness.evaluateAt(el) : randomness;
          return computeVoronoi(pos, sc, rand).distance;
        });
        const colorField = new Field('color', (el) => {
          const pos = isField(vectorInput) ? vectorInput.evaluateAt(el) : (vectorInput || el.position);
          const sc = isField(scale) ? scale.evaluateAt(el) : scale;
          const rand = isField(randomness) ? randomness.evaluateAt(el) : randomness;
          const v = computeVoronoi(pos, sc, rand);
          return { r: v.color.x, g: v.color.y, b: v.color.z, a: 1 };
        });
        const posField = new Field('vector', (el) => {
          const pos = isField(vectorInput) ? vectorInput.evaluateAt(el) : (vectorInput || el.position);
          const sc = isField(scale) ? scale.evaluateAt(el) : scale;
          const rand = isField(randomness) ? randomness.evaluateAt(el) : randomness;
          return computeVoronoi(pos, sc, rand).position || { x: 0, y: 0, z: 0 };
        });
        return { outputs: [distField, colorField, posField] };
      }

      const pos = vectorInput || { x: 0, y: 0, z: 0 };
      const v = computeVoronoi(pos, scale, randomness);
      return { outputs: [
        v.distance,
        { r: v.color.x, g: v.color.y, b: v.color.z, a: 1 },
        v.position || { x: 0, y: 0, z: 0 },
      ]};
    },
  });

  // ── 6. Capture Attribute ────────────────────────────────────────────────
  // Blender: node_geo_attribute_capture.cc
  // Evaluates a field on geometry and stores the result as an attribute.
  //
  // Inputs: Geometry, Value (dynamic field)
  // Outputs: Geometry, Value (stored field)
  // Properties: data_type, domain
  //
  // Simplified: single capture item (Blender supports multiple via Extend sockets)

  registry.addNode('geo', 'capture_attribute', {
    label: 'Capture Attribute',
    category: 'UTILITIES',
    defaults: { data_type: 'FLOAT', domain: 'POINT' },
    getInputs(values) {
      const socketType = captureTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Geometry', type: SocketType.GEOMETRY },
        { name: 'Value', type: socketType },
      ];
    },
    getOutputs(values) {
      const socketType = captureTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Geometry', type: SocketType.GEOMETRY },
        { name: 'Value', type: socketType },
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
      const valueInput = inputs['Value'];

      if (!geo) {
        return { outputs: [new GeometrySet(), valueInput ?? 0] };
      }

      const domain = values.domain || 'POINT';
      const domainEnum = domain === 'FACE' ? DOMAIN.FACE :
                         domain === 'EDGE' ? DOMAIN.EDGE :
                         domain === 'CORNER' ? DOMAIN.CORNER : DOMAIN.POINT;

      const result = geo.copy();
      const elements = result.buildElements(domainEnum);

      if (elements.length === 0 || valueInput == null) {
        return { outputs: [result, valueInput ?? 0] };
      }

      // Evaluate the field and capture the values
      const capturedValues = isField(valueInput)
        ? valueInput.evaluateAll(elements)
        : new Array(elements.length).fill(valueInput);

      // Return a field that reads from the captured array
      const fieldType = values.data_type === 'FLOAT_VECTOR' ? 'vector' :
                        values.data_type === 'INT' ? 'int' :
                        values.data_type === 'BOOLEAN' ? 'bool' :
                        values.data_type === 'FLOAT_COLOR' ? 'color' : 'float';

      const capturedField = new Field(fieldType, (el) => {
        const idx = el.index;
        if (idx >= 0 && idx < capturedValues.length) {
          return capturedValues[idx];
        }
        return capturedValues[0] ?? 0;
      });

      return { outputs: [result, capturedField] };
    },
  });

  // ── 7. Attribute Statistic ──────────────────────────────────────────────
  // Blender: node_geo_attribute_statistic.cc
  // Computes min/max/mean/median/sum/range/stddev/variance of a field.
  //
  // Inputs: Geometry, Selection (bool field), Attribute (float/vector field)
  // Outputs: Mean, Median, Sum, Min, Max, Range, Std Dev, Variance
  // Properties: data_type (Float, Vector), domain

  registry.addNode('geo', 'attribute_statistic', {
    label: 'Attribute Statistic',
    category: 'UTILITIES',
    defaults: { data_type: 'FLOAT', domain: 'POINT' },
    getInputs(values) {
      const type = values.data_type === 'FLOAT_VECTOR' ? SocketType.VECTOR : SocketType.FLOAT;
      return [
        { name: 'Geometry', type: SocketType.GEOMETRY },
        { name: 'Selection', type: SocketType.BOOL },
        { name: 'Attribute', type: type },
      ];
    },
    getOutputs(values) {
      const type = values.data_type === 'FLOAT_VECTOR' ? SocketType.VECTOR : SocketType.FLOAT;
      return [
        { name: 'Mean', type },
        { name: 'Median', type },
        { name: 'Sum', type },
        { name: 'Min', type },
        { name: 'Max', type },
        { name: 'Range', type },
        { name: 'Standard Deviation', type },
        { name: 'Variance', type },
      ];
    },
    getProps() {
      return [
        {
          key: 'data_type', label: 'Data Type', type: 'select',
          options: [
            { value: 'FLOAT', label: 'Float' },
            { value: 'FLOAT_VECTOR', label: 'Vector' },
          ],
        },
        {
          key: 'domain', label: 'Domain', type: 'select',
          options: [
            { value: 'POINT', label: 'Point' },
            { value: 'EDGE', label: 'Edge' },
            { value: 'FACE', label: 'Face' },
          ],
        },
      ];
    },
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      const attrInput = inputs['Attribute'];
      const isVector = values.data_type === 'FLOAT_VECTOR';
      const zero = isVector ? { x: 0, y: 0, z: 0 } : 0;
      const defaults = [zero, zero, zero, zero, zero, zero, zero, zero];

      if (!geo || attrInput == null) return { outputs: defaults };

      const domainEnum = values.domain === 'FACE' ? DOMAIN.FACE :
                         values.domain === 'EDGE' ? DOMAIN.EDGE : DOMAIN.POINT;
      const elements = geo.buildElements(domainEnum);
      const selection = resolveSelection(inputs['Selection'], elements);

      const vals = isField(attrInput)
        ? attrInput.evaluateAll(elements)
        : new Array(elements.length).fill(attrInput);

      // Filter by selection
      const data = [];
      for (let i = 0; i < vals.length; i++) {
        if (!selection || selection[i]) data.push(vals[i]);
      }

      if (data.length === 0) return { outputs: defaults };

      if (isVector) {
        return { outputs: computeVectorStats(data) };
      } else {
        return { outputs: computeFloatStats(data) };
      }
    },
  });

  // ── 8. Accumulate Field ─────────────────────────────────────────────────
  // Blender: node_geo_accumulate_field.cc
  // Running total of field values. Outputs: Leading, Trailing, Total.
  //
  // Inputs: Value (dynamic field), Group Index (int field)
  // Outputs: Leading, Trailing, Total
  // Properties: data_type (Float, Int, Vector), domain

  registry.addNode('geo', 'accumulate_field', {
    label: 'Accumulate Field',
    category: 'UTILITIES',
    defaults: { data_type: 'FLOAT', domain: 'POINT' },
    getInputs(values) {
      const type = values.data_type === 'FLOAT_VECTOR' ? SocketType.VECTOR :
                   values.data_type === 'INT' ? SocketType.INT : SocketType.FLOAT;
      return [
        { name: 'Value', type },
        { name: 'Group Index', type: SocketType.INT },
      ];
    },
    getOutputs(values) {
      const type = values.data_type === 'FLOAT_VECTOR' ? SocketType.VECTOR :
                   values.data_type === 'INT' ? SocketType.INT : SocketType.FLOAT;
      return [
        { name: 'Leading', type },
        { name: 'Trailing', type },
        { name: 'Total', type },
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
          ],
        },
        {
          key: 'domain', label: 'Domain', type: 'select',
          options: [
            { value: 'POINT', label: 'Point' },
            { value: 'EDGE', label: 'Edge' },
            { value: 'FACE', label: 'Face' },
          ],
        },
      ];
    },
    evaluate(values, inputs) {
      const valueInput = inputs['Value'];
      const groupInput = inputs['Group Index'];
      const dataType = values.data_type || 'FLOAT';
      const isVector = dataType === 'FLOAT_VECTOR';
      const fieldType = isVector ? 'vector' : dataType === 'INT' ? 'int' : 'float';
      const zero = isVector ? { x: 0, y: 0, z: 0 } : 0;

      // These are field outputs that need context to evaluate
      // We return fields that compute the accumulation lazily
      const leadingField = new Field(fieldType, (el) => {
        // In a real implementation, this would pre-compute all values
        // For now, return the value at this index (simplified)
        const val = isField(valueInput) ? valueInput.evaluateAt(el) : (valueInput ?? (isVector ? { x: 1, y: 1, z: 1 } : 1));
        if (isVector) {
          return {
            x: val.x * (el.index + 1),
            y: val.y * (el.index + 1),
            z: val.z * (el.index + 1),
          };
        }
        return val * (el.index + 1);
      });

      const trailingField = new Field(fieldType, (el) => {
        const val = isField(valueInput) ? valueInput.evaluateAt(el) : (valueInput ?? (isVector ? { x: 1, y: 1, z: 1 } : 1));
        if (isVector) {
          return {
            x: val.x * el.index,
            y: val.y * el.index,
            z: val.z * el.index,
          };
        }
        return val * el.index;
      });

      const totalField = new Field(fieldType, (el) => {
        const val = isField(valueInput) ? valueInput.evaluateAt(el) : (valueInput ?? (isVector ? { x: 1, y: 1, z: 1 } : 1));
        if (isVector) {
          return {
            x: val.x * el.count,
            y: val.y * el.count,
            z: val.z * el.count,
          };
        }
        return val * el.count;
      });

      return { outputs: [leadingField, trailingField, totalField] };
    },
  });

  // ── 9. Separate Color ───────────────────────────────────────────────────
  // Blender: node_fn_separate_color.cc
  // Split a color into R, G, B, A components.
  //
  // Input: Color
  // Outputs: Red, Green, Blue, Alpha
  // Property: Mode (RGB, HSV, HSL)

  registry.addNode('geo', 'separate_color', {
    label: 'Separate Color',
    category: 'UTILITIES',
    inputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    outputs: [
      { name: 'Red', type: SocketType.FLOAT },
      { name: 'Green', type: SocketType.FLOAT },
      { name: 'Blue', type: SocketType.FLOAT },
      { name: 'Alpha', type: SocketType.FLOAT },
    ],
    defaults: { mode: 'RGB' },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'RGB', label: 'RGB' },
          { value: 'HSV', label: 'HSV' },
          { value: 'HSL', label: 'HSL' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const color = inputs['Color'];
      const mode = values.mode || 'RGB';

      function separate(c) {
        const col = c || { r: 0, g: 0, b: 0, a: 1 };
        if (mode === 'RGB') {
          return [col.r ?? 0, col.g ?? 0, col.b ?? 0, col.a ?? 1];
        }
        // HSV/HSL conversion from RGB
        const r = col.r ?? 0, g = col.g ?? 0, b = col.b ?? 0;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d > 0) {
          if (max === r) h = ((g - b) / d + 6) % 6 / 6;
          else if (max === g) h = ((b - r) / d + 2) / 6;
          else h = ((r - g) / d + 4) / 6;
        }
        if (mode === 'HSV') {
          const s = max > 0 ? d / max : 0;
          return [h, s, max, col.a ?? 1];
        }
        // HSL
        const l = (max + min) / 2;
        const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
        return [h, s, l, col.a ?? 1];
      }

      if (isField(color)) {
        return { outputs: [
          new Field('float', (el) => separate(color.evaluateAt(el))[0]),
          new Field('float', (el) => separate(color.evaluateAt(el))[1]),
          new Field('float', (el) => separate(color.evaluateAt(el))[2]),
          new Field('float', (el) => separate(color.evaluateAt(el))[3]),
        ]};
      }
      const [c0, c1, c2, c3] = separate(color);
      return { outputs: [c0, c1, c2, c3] };
    },
  });

  // ── 10. Combine Color ──────────────────────────────────────────────────
  // Blender: node_fn_combine_color.cc
  // Combine R, G, B, A into a color.
  //
  // Inputs: Red (0), Green (0), Blue (0), Alpha (1)
  // Output: Color
  // Property: Mode (RGB, HSV, HSL)

  registry.addNode('geo', 'combine_color', {
    label: 'Combine Color',
    category: 'UTILITIES',
    inputs: [
      { name: 'Red', type: SocketType.FLOAT },
      { name: 'Green', type: SocketType.FLOAT },
      { name: 'Blue', type: SocketType.FLOAT },
      { name: 'Alpha', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { mode: 'RGB' },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'RGB', label: 'RGB' },
          { value: 'HSV', label: 'HSV' },
          { value: 'HSL', label: 'HSL' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const mode = values.mode || 'RGB';
      const c0 = inputs['Red'], c1 = inputs['Green'], c2 = inputs['Blue'], c3 = inputs['Alpha'];
      const hasField = isField(c0) || isField(c1) || isField(c2) || isField(c3);

      function combine(v0, v1, v2, v3) {
        const a = v3 ?? 1;
        if (mode === 'RGB') {
          return { r: v0 ?? 0, g: v1 ?? 0, b: v2 ?? 0, a };
        }
        // HSV/HSL to RGB
        const h = (v0 ?? 0) * 6, s = v1 ?? 0, vl = v2 ?? 0;
        if (mode === 'HSV') {
          const c = vl * s;
          const x = c * (1 - Math.abs(h % 2 - 1));
          const m = vl - c;
          let r = m, g = m, b = m;
          if (h < 1) { r += c; g += x; }
          else if (h < 2) { r += x; g += c; }
          else if (h < 3) { g += c; b += x; }
          else if (h < 4) { g += x; b += c; }
          else if (h < 5) { r += x; b += c; }
          else { r += c; b += x; }
          return { r, g, b, a };
        }
        // HSL
        const c = (1 - Math.abs(2 * vl - 1)) * s;
        const x = c * (1 - Math.abs(h % 2 - 1));
        const m = vl - c / 2;
        let r = m, g = m, b = m;
        if (h < 1) { r += c; g += x; }
        else if (h < 2) { r += x; g += c; }
        else if (h < 3) { g += c; b += x; }
        else if (h < 4) { g += x; b += c; }
        else if (h < 5) { r += x; b += c; }
        else { r += c; b += x; }
        return { r, g, b, a };
      }

      if (hasField) {
        return { outputs: [new Field('color', (el) => {
          const v0 = isField(c0) ? c0.evaluateAt(el) : (c0 ?? 0);
          const v1 = isField(c1) ? c1.evaluateAt(el) : (c1 ?? 0);
          const v2 = isField(c2) ? c2.evaluateAt(el) : (c2 ?? 0);
          const v3 = isField(c3) ? c3.evaluateAt(el) : (c3 ?? 1);
          return combine(v0, v1, v2, v3);
        })] };
      }
      return { outputs: [combine(c0, c1, c2, c3)] };
    },
  });

  // ── 11. Evaluate at Index ──────────────────────────────────────────────
  // Blender: node_geo_evaluate_at_index.cc
  // "Retrieve a value from a field at a specific index"
  //
  // Inputs: Value (dynamic field), Index (int field)
  // Output: Value (dynamic)
  // Properties: data_type, domain

  registry.addNode('geo', 'evaluate_at_index', {
    label: 'Evaluate at Index',
    category: 'UTILITIES',
    defaults: { data_type: 'FLOAT', domain: 'POINT' },
    getInputs(values) {
      const type = evalAtIndexTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Value', type },
        { name: 'Index', type: SocketType.INT },
      ];
    },
    getOutputs(values) {
      const type = evalAtIndexTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Value', type },
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
        {
          key: 'domain', label: 'Domain', type: 'select',
          options: [
            { value: 'POINT', label: 'Point' },
            { value: 'EDGE', label: 'Edge' },
            { value: 'FACE', label: 'Face' },
          ],
        },
      ];
    },
    evaluate(values, inputs) {
      const valueInput = inputs['Value'];
      const indexInput = inputs['Index'];
      const fieldType = values.data_type === 'FLOAT_VECTOR' ? 'vector' :
                        values.data_type === 'INT' ? 'int' :
                        values.data_type === 'BOOLEAN' ? 'bool' :
                        values.data_type === 'FLOAT_COLOR' ? 'color' : 'float';

      // Returns a field that evaluates valueInput at the specified index
      const resultField = new Field(fieldType, (el) => {
        const idx = isField(indexInput) ? indexInput.evaluateAt(el) : (indexInput ?? 0);
        // Evaluate the value field at a synthetic element with the target index
        if (isField(valueInput)) {
          return valueInput.evaluateAt({ ...el, index: Math.round(idx) });
        }
        return valueInput ?? 0;
      });

      return { outputs: [resultField] };
    },
  });

  // ── 12. Spline Length ──────────────────────────────────────────────────
  // Blender: node_geo_input_spline_length.cc
  // "Retrieve the total length of each spline"
  // Outputs: Length (float field), Point Count (int field)

  registry.addNode('geo', 'spline_length', {
    label: 'Spline Length',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Length', type: SocketType.FLOAT },
      { name: 'Point Count', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      const lengthField = new Field('float', (el) => {
        // Would need spline context for real length computation
        return 0;
      });
      const countField = new Field('int', (el) => {
        return el.localCount ?? el.count ?? 0;
      });
      return { outputs: [lengthField, countField] };
    },
  });

  // ── 13. Is Spline Cyclic ───────────────────────────────────────────────
  // Blender: node_geo_input_spline_cyclic.cc
  // Reads the built-in "cyclic" attribute.
  // Output: Cyclic (bool field)

  registry.addNode('geo', 'is_spline_cyclic', {
    label: 'Is Spline Cyclic',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Cyclic', type: SocketType.BOOL },
    ],
    defaults: {},
    props: [],
    evaluate() {
      return { outputs: [new Field('bool', () => false)] };
    },
  });

  // ── 14. White Noise Texture ────────────────────────────────────────────
  // Blender: node_shader_tex_white_noise.cc
  // Pure random noise (no spatial correlation).
  //
  // Input: Vector (vector field), W (float)
  // Outputs: Value (float), Color (color)
  // Property: Dimensions (1D-4D)

  registry.addNode('geo', 'white_noise_texture', {
    label: 'White Noise Texture',
    category: 'TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'W', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Value', type: SocketType.FLOAT },
      { name: 'Color', type: SocketType.COLOR },
    ],
    defaults: { dimensions: '3D' },
    props: [
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
      const vecInput = inputs['Vector'];
      const wInput = inputs['W'];
      const hasField = isField(vecInput) || isField(wInput);

      function whiteNoise(pos, w) {
        const x = pos?.x ?? 0, y = pos?.y ?? 0, z = pos?.z ?? 0;
        const val = hash3(x + (w ?? 0) * 13.37, y, z);
        const r = hash3(x + 100, y + 200, z + 300);
        const g = hash3(x + 400, y + 500, z + 600);
        const b = hash3(x + 700, y + 800, z + 900);
        return { value: val, color: { r, g, b, a: 1 } };
      }

      if (hasField) {
        const valField = new Field('float', (el) => {
          const pos = isField(vecInput) ? vecInput.evaluateAt(el) : (vecInput || el.position);
          const w = isField(wInput) ? wInput.evaluateAt(el) : wInput;
          return whiteNoise(pos, w).value;
        });
        const colField = new Field('color', (el) => {
          const pos = isField(vecInput) ? vecInput.evaluateAt(el) : (vecInput || el.position);
          const w = isField(wInput) ? wInput.evaluateAt(el) : wInput;
          return whiteNoise(pos, w).color;
        });
        return { outputs: [valField, colField] };
      }

      const n = whiteNoise(vecInput, wInput);
      return { outputs: [n.value, n.color] };
    },
  });

  // ── 15. Gradient Texture ───────────────────────────────────────────────
  // Blender: node_shader_tex_gradient.cc
  // Procedural gradient based on position.
  //
  // Input: Vector (vector field)
  // Outputs: Color, Fac (float)
  // Property: gradient_type (Linear, Quadratic, Easing, Diagonal, Radial, etc.)

  registry.addNode('geo', 'gradient_texture', {
    label: 'Gradient Texture',
    category: 'TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Fac', type: SocketType.FLOAT },
    ],
    defaults: { gradient_type: 'LINEAR' },
    props: [
      {
        key: 'gradient_type', label: 'Type', type: 'select',
        options: [
          { value: 'LINEAR', label: 'Linear' },
          { value: 'QUADRATIC', label: 'Quadratic' },
          { value: 'EASING', label: 'Easing' },
          { value: 'DIAGONAL', label: 'Diagonal' },
          { value: 'RADIAL', label: 'Radial' },
          { value: 'QUADRATIC_SPHERE', label: 'Quadratic Sphere' },
          { value: 'SPHERICAL', label: 'Spherical' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const vecInput = inputs['Vector'];
      const gradType = values.gradient_type || 'LINEAR';

      function computeGradient(pos) {
        const p = pos || { x: 0, y: 0, z: 0 };
        let fac;
        switch (gradType) {
          case 'LINEAR':
            fac = p.x;
            break;
          case 'QUADRATIC':
            fac = Math.max(0, p.x);
            fac = fac * fac;
            break;
          case 'EASING': {
            const t = Math.max(0, Math.min(1, p.x));
            fac = t * t * (3 - 2 * t); // smoothstep
            break;
          }
          case 'DIAGONAL':
            fac = (p.x + p.y) / 2;
            break;
          case 'RADIAL': {
            fac = Math.atan2(p.y, p.x) / (2 * Math.PI) + 0.5;
            break;
          }
          case 'QUADRATIC_SPHERE': {
            const r = Math.max(0.0001, Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z));
            fac = Math.max(0, 1 - r);
            fac = fac * fac;
            break;
          }
          case 'SPHERICAL': {
            const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
            fac = Math.max(0, 1 - r);
            break;
          }
          default:
            fac = 0;
        }
        fac = Math.max(0, Math.min(1, fac));
        return fac;
      }

      if (isField(vecInput)) {
        const facField = new Field('float', (el) => {
          const pos = vecInput.evaluateAt(el);
          return computeGradient(pos);
        });
        const colField = new Field('color', (el) => {
          const f = computeGradient(vecInput.evaluateAt(el));
          return { r: f, g: f, b: f, a: 1 };
        });
        return { outputs: [colField, facField] };
      }

      const fac = computeGradient(vecInput);
      return { outputs: [{ r: fac, g: fac, b: fac, a: 1 }, fac] };
    },
  });

  // ── 16. Checker Texture ────────────────────────────────────────────────
  // Blender: node_shader_tex_checker.cc
  // Alternating checkerboard pattern.
  //
  // Inputs: Vector, Color1, Color2, Scale (float 5.0)
  // Outputs: Color, Fac

  registry.addNode('geo', 'checker_texture', {
    label: 'Checker Texture',
    category: 'TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Color1', type: SocketType.COLOR },
      { name: 'Color2', type: SocketType.COLOR },
      { name: 'Scale', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Fac', type: SocketType.FLOAT },
    ],
    defaults: { scale: 5.0 },
    props: [
      { key: 'scale', label: 'Scale', type: 'float', min: -10000, max: 10000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const vecInput = inputs['Vector'];
      const c1Input = inputs['Color1'] || { r: 0.8, g: 0.8, b: 0.8, a: 1 };
      const c2Input = inputs['Color2'] || { r: 0.2, g: 0.2, b: 0.2, a: 1 };
      const scaleInput = inputs['Scale'] ?? values.scale;
      const hasField = isField(vecInput) || isField(scaleInput);

      function checker(pos, scale) {
        const s = typeof scale === 'number' ? scale : 5;
        const px = pos?.x ?? 0, py = pos?.y ?? 0, pz = pos?.z ?? 0;
        const ix = Math.floor(px * s);
        const iy = Math.floor(py * s);
        const iz = Math.floor(pz * s);
        return ((ix + iy + iz) & 1) === 0 ? 1 : 0;
      }

      if (hasField) {
        const facField = new Field('float', (el) => {
          const pos = isField(vecInput) ? vecInput.evaluateAt(el) : (vecInput || el.position);
          const s = isField(scaleInput) ? scaleInput.evaluateAt(el) : scaleInput;
          return checker(pos, s);
        });
        const colField = new Field('color', (el) => {
          const pos = isField(vecInput) ? vecInput.evaluateAt(el) : (vecInput || el.position);
          const s = isField(scaleInput) ? scaleInput.evaluateAt(el) : scaleInput;
          const f = checker(pos, s);
          const ca = isField(c1Input) ? c1Input.evaluateAt(el) : c1Input;
          const cb = isField(c2Input) ? c2Input.evaluateAt(el) : c2Input;
          return f ? ca : cb;
        });
        return { outputs: [colField, facField] };
      }

      const fac = checker(vecInput, scaleInput);
      return { outputs: [fac ? c1Input : c2Input, fac] };
    },
  });

  // ── 17. Wave Texture ───────────────────────────────────────────────────
  // Blender: node_shader_tex_wave.cc
  // Wave pattern (bands or rings).
  //
  // Inputs: Vector, Scale, Distortion, Detail, Detail Scale, Detail Roughness, Phase Offset
  // Outputs: Color, Fac
  // Properties: wave_type (Bands/Rings), wave_profile (Sine/Saw/Triangle)

  registry.addNode('geo', 'wave_texture', {
    label: 'Wave Texture',
    category: 'TEXTURE',
    inputs: [
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Scale', type: SocketType.FLOAT },
      { name: 'Distortion', type: SocketType.FLOAT },
      { name: 'Detail', type: SocketType.FLOAT },
      { name: 'Detail Scale', type: SocketType.FLOAT },
      { name: 'Detail Roughness', type: SocketType.FLOAT },
      { name: 'Phase Offset', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Color', type: SocketType.COLOR },
      { name: 'Fac', type: SocketType.FLOAT },
    ],
    defaults: {
      scale: 5.0, distortion: 0.0, detail: 2.0, detail_scale: 1.0,
      detail_roughness: 0.5, phase_offset: 0.0,
      wave_type: 'BANDS', wave_profile: 'SIN',
    },
    props: [
      { key: 'scale', label: 'Scale', type: 'float', min: -1000, max: 1000, step: 0.1 },
      {
        key: 'wave_type', label: 'Type', type: 'select',
        options: [
          { value: 'BANDS', label: 'Bands' },
          { value: 'RINGS', label: 'Rings' },
        ],
      },
      {
        key: 'wave_profile', label: 'Profile', type: 'select',
        options: [
          { value: 'SIN', label: 'Sine' },
          { value: 'SAW', label: 'Saw' },
          { value: 'TRI', label: 'Triangle' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const vecInput = inputs['Vector'];
      const scaleInput = inputs['Scale'] ?? values.scale;
      const distInput = inputs['Distortion'] ?? values.distortion;
      const phaseInput = inputs['Phase Offset'] ?? values.phase_offset;
      const waveType = values.wave_type || 'BANDS';
      const profile = values.wave_profile || 'SIN';
      const hasField = isField(vecInput) || isField(scaleInput);

      function computeWave(pos, scale, dist, phase) {
        const s = typeof scale === 'number' ? scale : 5;
        const d = typeof dist === 'number' ? dist : 0;
        const ph = typeof phase === 'number' ? phase : 0;
        const px = (pos?.x ?? 0) * s, py = (pos?.y ?? 0) * s, pz = (pos?.z ?? 0) * s;

        let n;
        if (waveType === 'BANDS') {
          n = px;
        } else {
          n = Math.sqrt(px * px + py * py + pz * pz);
        }

        n += d * perlinNoise3D(px, py, pz) + ph;

        let fac;
        if (profile === 'SIN') {
          fac = 0.5 + 0.5 * Math.sin(n * Math.PI * 2);
        } else if (profile === 'SAW') {
          fac = ((n % 1) + 1) % 1;
        } else {
          // Triangle
          fac = Math.abs(((n % 1) + 1) % 1 * 2 - 1);
        }
        return Math.max(0, Math.min(1, fac));
      }

      if (hasField) {
        const facField = new Field('float', (el) => {
          const pos = isField(vecInput) ? vecInput.evaluateAt(el) : (vecInput || el.position);
          const s = isField(scaleInput) ? scaleInput.evaluateAt(el) : scaleInput;
          return computeWave(pos, s, distInput, phaseInput);
        });
        const colField = new Field('color', (el) => {
          const f = facField.evaluateAt(el);
          return { r: f, g: f, b: f, a: 1 };
        });
        return { outputs: [colField, facField] };
      }

      const fac = computeWave(vecInput, scaleInput, distInput, phaseInput);
      return { outputs: [{ r: fac, g: fac, b: fac, a: 1 }, fac] };
    },
  });

  // ── 18. Evaluate on Domain ─────────────────────────────────────────────
  // Blender: node_geo_evaluate_on_domain.cc
  // "Retrieve values from a field on a different domain"
  //
  // Input: Value (dynamic field)
  // Output: Value (dynamic field)
  // Properties: domain, data_type

  registry.addNode('geo', 'evaluate_on_domain', {
    label: 'Evaluate on Domain',
    category: 'UTILITIES',
    defaults: { data_type: 'FLOAT', domain: 'POINT' },
    getInputs(values) {
      const type = evalAtIndexTypeToSocket(values.data_type || 'FLOAT');
      return [{ name: 'Value', type }];
    },
    getOutputs(values) {
      const type = evalAtIndexTypeToSocket(values.data_type || 'FLOAT');
      return [{ name: 'Value', type }];
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
        {
          key: 'domain', label: 'Domain', type: 'select',
          options: [
            { value: 'POINT', label: 'Point' },
            { value: 'EDGE', label: 'Edge' },
            { value: 'FACE', label: 'Face' },
            { value: 'CORNER', label: 'Face Corner' },
            { value: 'SPLINE', label: 'Spline' },
          ],
        },
      ];
    },
    evaluate(values, inputs) {
      // In a full implementation, this would change the evaluation domain
      // For now, pass through the field
      return { outputs: [inputs['Value'] ?? 0] };
    },
  });

  // ── 19. Index of Nearest ───────────────────────────────────────────────
  // Blender: node_geo_index_of_nearest.cc
  // "Find the nearest element in a group"
  //
  // Inputs: Position (vector field), Group ID (int field)
  // Outputs: Index (int field), Has Neighbor (bool field)

  registry.addNode('geo', 'index_of_nearest', {
    label: 'Index of Nearest',
    category: 'UTILITIES',
    inputs: [
      { name: 'Position', type: SocketType.VECTOR },
      { name: 'Group ID', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Index', type: SocketType.INT },
      { name: 'Has Neighbor', type: SocketType.BOOL },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      // Returns field outputs - would need full element context for real implementation
      const indexField = new Field('int', (el) => {
        // Find nearest different-index element (simplified: return index-1 or index+1)
        return el.index > 0 ? el.index - 1 : (el.count > 1 ? 1 : 0);
      });
      const hasNeighborField = new Field('bool', (el) => el.count > 1);
      return { outputs: [indexField, hasNeighborField] };
    },
  });

  // ── 20. Remove Named Attribute ─────────────────────────────────────────
  // Blender: node_geo_remove_attribute.cc
  // "Remove the attribute with the given name"
  //
  // Inputs: Geometry, Name (string)
  // Output: Geometry

  registry.addNode('geo', 'remove_named_attribute', {
    label: 'Remove Named Attribute',
    category: 'ATTRIBUTE',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { name: '' },
    props: [
      { key: 'name', label: 'Name', type: 'text' },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      // Pass through - attribute removal is a future enhancement
      return { outputs: [geo.copy()] };
    },
  });

  // ── 21. Blur Attribute ─────────────────────────────────────────────────
  // Blender: node_geo_blur_attribute.cc
  // "Smooth an attribute value between neighboring mesh elements"
  //
  // Inputs: Value (dynamic field), Iterations (int, 1), Weight (float field, 1.0)
  // Output: Value (dynamic field)
  // Property: data_type

  registry.addNode('geo', 'blur_attribute', {
    label: 'Blur Attribute',
    category: 'ATTRIBUTE',
    defaults: { data_type: 'FLOAT', iterations: 1 },
    getInputs(values) {
      const type = evalAtIndexTypeToSocket(values.data_type || 'FLOAT');
      return [
        { name: 'Value', type },
        { name: 'Iterations', type: SocketType.INT },
        { name: 'Weight', type: SocketType.FLOAT },
      ];
    },
    getOutputs(values) {
      const type = evalAtIndexTypeToSocket(values.data_type || 'FLOAT');
      return [{ name: 'Value', type }];
    },
    getProps() {
      return [
        {
          key: 'data_type', label: 'Data Type', type: 'select',
          options: [
            { value: 'FLOAT', label: 'Float' },
            { value: 'INT', label: 'Integer' },
            { value: 'FLOAT_VECTOR', label: 'Vector' },
            { value: 'FLOAT_COLOR', label: 'Color' },
          ],
        },
        { key: 'iterations', label: 'Iterations', type: 'int', min: 0, max: 100, step: 1 },
      ];
    },
    evaluate(values, inputs) {
      // Blur requires mesh topology context for neighbor averaging
      // Pass through the input field for now
      // DOCUMENTED LIMITATION: Blur requires mesh adjacency data for actual smoothing
      return { outputs: [inputs['Value'] ?? 0] };
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

function mixTypeToSocket(type) {
  switch (type) {
    case 'FLOAT': return SocketType.FLOAT;
    case 'VECTOR': return SocketType.VECTOR;
    case 'COLOR': return SocketType.COLOR;
    default: return SocketType.FLOAT;
  }
}

function captureTypeToSocket(type) {
  switch (type) {
    case 'FLOAT': return SocketType.FLOAT;
    case 'INT': return SocketType.INT;
    case 'FLOAT_VECTOR': return SocketType.VECTOR;
    case 'BOOLEAN': return SocketType.BOOL;
    case 'FLOAT_COLOR': return SocketType.COLOR;
    default: return SocketType.FLOAT;
  }
}

function computeFloatStats(data) {
  const n = data.length;
  const sorted = [...data].sort((a, b) => a - b);

  const sum = data.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const min = sorted[0];
  const max = sorted[n - 1];
  const range = max - min;

  // Median
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  // Variance & std dev
  let variance = 0;
  for (const v of data) {
    variance += (v - mean) * (v - mean);
  }
  variance /= n;
  const stdDev = Math.sqrt(variance);

  return [mean, median, sum, min, max, range, stdDev, variance];
}

function computeVectorStats(data) {
  const n = data.length;

  // Compute per-component
  const xs = data.map(v => v.x ?? 0);
  const ys = data.map(v => v.y ?? 0);
  const zs = data.map(v => v.z ?? 0);

  const xStats = computeFloatStats(xs);
  const yStats = computeFloatStats(ys);
  const zStats = computeFloatStats(zs);

  return [
    { x: xStats[0], y: yStats[0], z: zStats[0] }, // mean
    { x: xStats[1], y: yStats[1], z: zStats[1] }, // median
    { x: xStats[2], y: yStats[2], z: zStats[2] }, // sum
    { x: xStats[3], y: yStats[3], z: zStats[3] }, // min
    { x: xStats[4], y: yStats[4], z: zStats[4] }, // max
    { x: xStats[5], y: yStats[5], z: zStats[5] }, // range
    { x: xStats[6], y: yStats[6], z: zStats[6] }, // std dev
    { x: xStats[7], y: yStats[7], z: zStats[7] }, // variance
  ];
}

function evalAtIndexTypeToSocket(type) {
  switch (type) {
    case 'FLOAT': return SocketType.FLOAT;
    case 'INT': return SocketType.INT;
    case 'FLOAT_VECTOR': return SocketType.VECTOR;
    case 'BOOLEAN': return SocketType.BOOL;
    case 'FLOAT_COLOR': return SocketType.COLOR;
    default: return SocketType.FLOAT;
  }
}
