/**
 * shader/compiler.js - Compiles a shader graph evaluation result into GLSL.
 *
 * Takes the shaderResult produced by evaluating a shader graph and generates
 * a vertex shader, fragment shader, and uniforms object suitable for use
 * with Three.js ShaderMaterial.
 *
 * Lighting model: PBR-lite (ambient + directional + Fresnel rim).
 */

/**
 * Compile a shader descriptor into GLSL vertex/fragment shaders.
 *
 * @param {object|null} shaderResult - The output of graph.evaluate().shaderResult.
 *   Typically has the shape { outputs: [], shaderResult: <descriptor> } where
 *   the descriptor is { type, baseColor, metallic, roughness, emission, ... }.
 * @returns {{ vertexShader: string, fragmentShader: string, uniforms: object }}
 */
export function compileShader(shaderResult) {
  // Dig out the actual material descriptor
  const descriptor = extractDescriptor(shaderResult);

  // Extract material properties with safe defaults
  const baseColor        = toVec3(descriptor?.baseColor, 0.4, 0.4, 0.8);
  const metallic         = clamp01(descriptor?.metallic  ?? 0.0);
  const roughness        = clamp01(descriptor?.roughness ?? 0.5);
  const emission         = toVec3(descriptor?.emission, 0.0, 0.0, 0.0);
  const emissionStrength = descriptor?.emissionStrength ?? 0.0;
  const hasNormalMap     = descriptor?.normal != null;
  const fresnelIOR       = descriptor?.fresnelIOR ?? 0.0;

  // ── Uniforms ────────────────────────────────────────────────────
  const uniforms = {
    uBaseColor:        { value: [baseColor.x, baseColor.y, baseColor.z] },
    uMetallic:         { value: metallic },
    uRoughness:        { value: roughness },
    uEmission:         { value: [emission.x, emission.y, emission.z] },
    uEmissionStrength: { value: emissionStrength },
    uFresnelIOR:       { value: fresnelIOR },
    uLightDir:         { value: [0.5, 0.8, 0.6] },   // normalised in shader
    uLightColor:       { value: [1.0, 0.98, 0.92] },
    uAmbientColor:     { value: [0.08, 0.08, 0.12] },
    uCameraPos:        { value: [0.0, 0.0, 5.0] },    // updated by preview
    uTime:             { value: 0.0 },
  };

  // ── Vertex shader ───────────────────────────────────────────────
  // NOTE: modelMatrix, viewMatrix, projectionMatrix, normalMatrix,
  // position, normal, uv are all injected by Three.js ShaderMaterial.
  const vertexShader = /* glsl */ `
    precision highp float;

    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying vec2 vUv;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      vWorldNormal = normalize(normalMatrix * normal);
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  // ── Fragment shader ─────────────────────────────────────────────
  const fragmentShader = /* glsl */ `
    precision highp float;

    // Varyings
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying vec2 vUv;

    // Material uniforms
    uniform vec3  uBaseColor;
    uniform float uMetallic;
    uniform float uRoughness;
    uniform vec3  uEmission;
    uniform float uEmissionStrength;
    uniform float uFresnelIOR;

    // Lighting uniforms
    uniform vec3 uLightDir;
    uniform vec3 uLightColor;
    uniform vec3 uAmbientColor;
    uniform vec3 uCameraPos;
    uniform float uTime;

    // ── Helpers ──────────────────────────────────────────────────

    float schlickFresnel(float cosTheta, float ior) {
      float r0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
      return r0 + (1.0 - r0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }

    // GGX distribution term
    float distributionGGX(float NdotH, float rough) {
      float a  = rough * rough;
      float a2 = a * a;
      float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
      return a2 / (3.14159265 * denom * denom + 0.0001);
    }

    // Geometry Smith term (approx)
    float geometrySmith(float NdotV, float NdotL, float rough) {
      float k = (rough + 1.0) * (rough + 1.0) / 8.0;
      float g1 = NdotV / (NdotV * (1.0 - k) + k + 0.0001);
      float g2 = NdotL / (NdotL * (1.0 - k) + k + 0.0001);
      return g1 * g2;
    }

    void main() {
      vec3 N = normalize(vWorldNormal);
      vec3 V = normalize(uCameraPos - vWorldPosition);
      vec3 L = normalize(uLightDir);
      vec3 H = normalize(V + L);

      float NdotL = max(dot(N, L), 0.0);
      float NdotV = max(dot(N, V), 0.0);
      float NdotH = max(dot(N, H), 0.0);
      float HdotV = max(dot(H, V), 0.0);

      // ── PBR-lite shading ──────────────────────────────────────

      // Fresnel at half-angle (Schlick)
      vec3 F0 = mix(vec3(0.04), uBaseColor, uMetallic);
      vec3 F  = F0 + (1.0 - F0) * pow(clamp(1.0 - HdotV, 0.0, 1.0), 5.0);

      // Distribution & geometry
      float D = distributionGGX(NdotH, uRoughness);
      float G = geometrySmith(NdotV, NdotL, uRoughness);

      // Specular BRDF
      vec3 specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);

      // Energy conservation: diffuse weight
      vec3 kD = (vec3(1.0) - F) * (1.0 - uMetallic);

      // Diffuse (Lambertian)
      vec3 diffuse = kD * uBaseColor / 3.14159265;

      // Direct lighting
      vec3 Lo = (diffuse + specular) * uLightColor * NdotL;

      // Ambient (simple hemisphere)
      vec3 ambient = uAmbientColor * uBaseColor;

      // Rim / Fresnel highlight
      float rimFresnel = pow(clamp(1.0 - NdotV, 0.0, 1.0), 3.0);
      vec3 rim = vec3(rimFresnel) * 0.15 * uLightColor;

      // Emission
      vec3 emissionContrib = uEmission * uEmissionStrength;

      // Combine
      vec3 color = ambient + Lo + rim + emissionContrib;

      // Simple tone mapping (Reinhard)
      color = color / (color + vec3(1.0));

      // Gamma correction
      color = pow(color, vec3(1.0 / 2.2));

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  return { vertexShader, fragmentShader, uniforms };
}

// ══════════════════════════════════════════════════════════════════
//  Internal helpers
// ══════════════════════════════════════════════════════════════════

/**
 * Walk possibly nested shaderResult structures to find the material descriptor.
 * The graph evaluate returns { shaderResult: { outputs:[], shaderResult: desc } }
 * so we may need to unwrap one or two levels.
 */
function extractDescriptor(result) {
  if (!result) return null;

  // Direct descriptor object (has `type` like 'principled', 'emission', etc.)
  if (result.type && typeof result.baseColor !== 'undefined') return result;

  // Nested in shaderResult property
  if (result.shaderResult) return extractDescriptor(result.shaderResult);

  // Nested in outputs array (from evaluate returning { outputs: [descriptor] })
  if (result.outputs && result.outputs.length > 0) {
    return extractDescriptor(result.outputs[0]);
  }

  return result;
}

/**
 * Convert a colour-like object {r,g,b} or hex string to {x,y,z} for GLSL uniforms.
 */
function toVec3(color, dr, dg, db) {
  if (!color) return { x: dr, y: dg, z: db };

  // Hex string
  if (typeof color === 'string' && color.startsWith('#')) {
    const h = color.replace('#', '');
    return {
      x: parseInt(h.substring(0, 2), 16) / 255,
      y: parseInt(h.substring(2, 4), 16) / 255,
      z: parseInt(h.substring(4, 6), 16) / 255,
    };
  }

  // {r,g,b} object
  if (typeof color.r === 'number') {
    return { x: color.r, y: color.g, z: color.b };
  }

  // {x,y,z} already
  if (typeof color.x === 'number') return color;

  return { x: dr, y: dg, z: db };
}

function clamp01(v) {
  return Math.min(Math.max(v ?? 0, 0), 1);
}
