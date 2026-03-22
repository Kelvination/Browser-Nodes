/**
 * shader/preview.js - Real-time shader preview using Three.js.
 *
 * Renders a 3D shape (sphere, cube, or plane) with a ShaderMaterial
 * built from the compiled shader result.  Assumes Three.js is available
 * globally via CDN (window.THREE).
 */

import { buildGeometry } from '../geo/builders.js';

const SHAPES = ['sphere', 'cube', 'plane'];
const BG_COLOR = 0x1a1a2e;
const GRID_COLOR = 0x2a2a3e;

export class ShaderPreview {
  /**
   * @param {HTMLCanvasElement} canvas - The canvas element to render into.
   */
  constructor(canvas) {
    this._canvas  = canvas;
    this._running = false;
    this._rafId   = null;
    this._shapeIdx = 0;
    this._time    = 0;

    const THREE = window.THREE;
    if (!THREE) {
      console.error('ShaderPreview: THREE.js is not loaded globally.');
      return;
    }

    // ── Renderer ────────────────────────────────────────────────
    this._renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(BG_COLOR, 1);

    // ── Scene ───────────────────────────────────────────────────
    this._scene = new THREE.Scene();

    // Subtle grid helper
    const grid = new THREE.GridHelper(6, 12, GRID_COLOR, GRID_COLOR);
    grid.position.y = -1.2;
    grid.material.transparent = true;
    grid.material.opacity = 0.3;
    this._scene.add(grid);

    // ── Camera ──────────────────────────────────────────────────
    this._camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this._camera.position.set(2.2, 1.6, 3.0);
    this._camera.lookAt(0, 0, 0);

    // ── Default material (grey PBR-lite fallback) ───────────────
    this._material = new THREE.ShaderMaterial({
      vertexShader: defaultVertexShader(),
      fragmentShader: defaultFragmentShader(),
      uniforms: buildDefaultUniforms(THREE),
      side: THREE.DoubleSide,
    });

    // ── Mesh ────────────────────────────────────────────────────
    this._mesh = null;
    this._createShape();

    // ── Orbit controls (manual) ─────────────────────────────────
    this._orbitState = {
      theta: Math.PI * 0.25,
      phi: Math.PI * 0.3,
      radius: 4.0,
      target: { x: 0, y: 0, z: 0 },
      dragging: false,
      lastX: 0,
      lastY: 0,
      pinchDist: 0,
    };
    this._updateCameraOrbit();
    this._bindControls();

    // Initial resize
    this.resize();
  }

  // ══════════════════════════════════════════════════════════════
  //  Public API
  // ══════════════════════════════════════════════════════════════

  /**
   * Update the shader material from a compiled shader result.
   * @param {{ vertexShader: string, fragmentShader: string, uniforms: object }} compiled
   */
  updateShader(compiled) {
    if (!compiled || !this._renderer) return;

    const THREE = window.THREE;

    // Build Three.js uniform objects
    const uniforms = {};
    for (const [key, entry] of Object.entries(compiled.uniforms || {})) {
      const val = entry.value;
      if (Array.isArray(val) && val.length === 3) {
        uniforms[key] = { value: new THREE.Vector3(val[0], val[1], val[2]) };
      } else if (Array.isArray(val) && val.length === 2) {
        uniforms[key] = { value: new THREE.Vector2(val[0], val[1]) };
      } else {
        uniforms[key] = { value: val };
      }
    }

    // Create new ShaderMaterial
    try {
      const newMat = new THREE.ShaderMaterial({
        vertexShader:   compiled.vertexShader,
        fragmentShader: compiled.fragmentShader,
        uniforms,
        side: THREE.DoubleSide,
      });

      // Dispose old material
      if (this._material) this._material.dispose();
      this._material = newMat;

      if (this._mesh) {
        this._mesh.material = this._material;
      }
    } catch (e) {
      console.warn('ShaderPreview: failed to compile GLSL -', e.message);
    }
  }

  /** Start the render loop. */
  start() {
    if (this._running || !this._renderer) return;
    this._running = true;
    this._lastFrame = performance.now();
    this._loop();
  }

  /** Stop the render loop. */
  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Handle canvas resize. */
  resize() {
    if (!this._renderer || !this._canvas) return;
    const parent = this._canvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth  || 300;
    const h = parent.clientHeight || 300;

    this._renderer.setSize(w, h, false);
    this._canvas.width  = w * Math.min(window.devicePixelRatio, 2);
    this._canvas.height = h * Math.min(window.devicePixelRatio, 2);
    this._canvas.style.width  = w + 'px';
    this._canvas.style.height = h + 'px';

    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }

  /**
   * Replace the preview mesh with geometry from the geo graph output.
   * Falls back to built-in shapes if geoData is null/empty.
   * @param {Array|null} geometries - Array of geometry descriptors from geo graph evaluation.
   */
  setExternalGeometry(geometries) {
    const THREE = window.THREE;
    if (!THREE) return;

    if (!geometries || geometries.length === 0) {
      // No geometry available - fall back to built-in shape
      this._externalGeo = false;
      this._createShape();
      return;
    }

    // Remove existing mesh
    if (this._mesh) {
      this._scene.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh = null;
    }

    // Build geometry from geo graph descriptors
    const builtGeometries = [];
    for (const geoData of geometries) {
      if (!geoData) continue;
      const geo = buildGeometry(geoData);
      if (geo) builtGeometries.push(geo);
    }

    if (builtGeometries.length === 0) {
      this._externalGeo = false;
      this._createShape();
      return;
    }

    // Ensure each geometry has normals and UVs (needed by the shader)
    for (const g of builtGeometries) {
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) {
        // Generate simple planar UVs from position as fallback
        const pos = g.getAttribute('position');
        const uvs = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          uvs[i * 2] = pos.getX(i) * 0.5 + 0.5;
          uvs[i * 2 + 1] = pos.getY(i) * 0.5 + 0.5;
        }
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      }
    }

    // Merge multiple geometries into one, or use the single one
    let geometry;
    if (builtGeometries.length === 1) {
      geometry = builtGeometries[0];
    } else {
      // Merge all geometries
      const positions = [];
      const normals = [];
      const indices = [];
      let vertOffset = 0;

      for (const g of builtGeometries) {
        const pos = g.getAttribute('position');
        const norm = g.getAttribute('normal');
        const idx = g.index;

        for (let j = 0; j < pos.count; j++) {
          positions.push(pos.getX(j), pos.getY(j), pos.getZ(j));
          if (norm) normals.push(norm.getX(j), norm.getY(j), norm.getZ(j));
        }
        if (idx) {
          for (let j = 0; j < idx.count; j++) {
            indices.push(idx.getX(j) + vertOffset);
          }
        }
        vertOffset += pos.count;
        g.dispose();
      }

      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (normals.length > 0) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      if (indices.length > 0) geometry.setIndex(indices);
      if (normals.length === 0) geometry.computeVertexNormals();
    }

    // Apply transforms from the first geo descriptor
    this._mesh = new THREE.Mesh(geometry, this._material);

    // Apply transforms from geo descriptors
    for (const geoData of geometries) {
      if (!geoData?.transforms) continue;
      for (const t of geoData.transforms) {
        if (t.translate) {
          this._mesh.position.x += t.translate.x || 0;
          this._mesh.position.y += t.translate.y || 0;
          this._mesh.position.z += t.translate.z || 0;
        }
        if (t.rotate) {
          this._mesh.rotation.x += t.rotate.x || 0;
          this._mesh.rotation.y += t.rotate.y || 0;
          this._mesh.rotation.z += t.rotate.z || 0;
        }
        if (t.scale) {
          this._mesh.scale.x *= t.scale.x || 1;
          this._mesh.scale.y *= t.scale.y || 1;
          this._mesh.scale.z *= t.scale.z || 1;
        }
      }
      break; // Only apply first set of transforms
    }

    this._scene.add(this._mesh);
    this._externalGeo = true;
  }

  /** Cycle through preview shapes: sphere -> cube -> plane -> sphere ... */
  toggleShape() {
    this._externalGeo = false;
    this._shapeIdx = (this._shapeIdx + 1) % SHAPES.length;
    this._createShape();
  }

  /** Get current shape name. */
  get currentShape() {
    if (this._externalGeo) return 'geo output';
    return SHAPES[this._shapeIdx];
  }

  // ══════════════════════════════════════════════════════════════
  //  Internal
  // ══════════════════════════════════════════════════════════════

  _createShape() {
    const THREE = window.THREE;
    if (!THREE) return;

    if (this._mesh) {
      this._scene.remove(this._mesh);
      this._mesh.geometry.dispose();
    }

    let geometry;
    switch (SHAPES[this._shapeIdx]) {
      case 'cube':
        geometry = new THREE.BoxGeometry(1.6, 1.6, 1.6, 4, 4, 4);
        break;
      case 'plane':
        geometry = new THREE.PlaneGeometry(2.4, 2.4, 16, 16);
        break;
      case 'sphere':
      default:
        geometry = new THREE.SphereGeometry(1.0, 48, 32);
        break;
    }

    this._mesh = new THREE.Mesh(geometry, this._material);
    this._scene.add(this._mesh);
  }

  _loop() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(() => this._loop());

    const now = performance.now();
    const dt  = (now - this._lastFrame) / 1000;
    this._lastFrame = now;
    this._time += dt;

    // Update time uniform
    if (this._material?.uniforms?.uTime) {
      this._material.uniforms.uTime.value = this._time;
    }

    // Update camera position uniform for Fresnel / specular
    if (this._material?.uniforms?.uCameraPos) {
      this._material.uniforms.uCameraPos.value.set(
        this._camera.position.x,
        this._camera.position.y,
        this._camera.position.z
      );
    }

    this._renderer.render(this._scene, this._camera);
  }

  // ── Orbit controls ────────────────────────────────────────────

  _updateCameraOrbit() {
    const s = this._orbitState;
    const x = s.radius * Math.sin(s.phi) * Math.sin(s.theta) + s.target.x;
    const y = s.radius * Math.cos(s.phi) + s.target.y;
    const z = s.radius * Math.sin(s.phi) * Math.cos(s.theta) + s.target.z;
    this._camera.position.set(x, y, z);
    this._camera.lookAt(s.target.x, s.target.y, s.target.z);
  }

  _bindControls() {
    const c = this._canvas;
    if (!c) return;

    // ── Mouse ───────────────────────────────────────────────────
    c.addEventListener('mousedown', (e) => {
      this._orbitState.dragging = true;
      this._orbitState.lastX = e.clientX;
      this._orbitState.lastY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._orbitState.dragging) return;
      const dx = e.clientX - this._orbitState.lastX;
      const dy = e.clientY - this._orbitState.lastY;
      this._orbitState.lastX = e.clientX;
      this._orbitState.lastY = e.clientY;
      this._orbitState.theta -= dx * 0.008;
      this._orbitState.phi   = Math.max(0.1, Math.min(Math.PI - 0.1,
        this._orbitState.phi + dy * 0.008));
      this._updateCameraOrbit();
    });

    window.addEventListener('mouseup', () => {
      this._orbitState.dragging = false;
    });

    // ── Scroll zoom ─────────────────────────────────────────────
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._orbitState.radius = Math.max(1.5, Math.min(20,
        this._orbitState.radius + e.deltaY * 0.005));
      this._updateCameraOrbit();
    }, { passive: false });

    // ── Touch ───────────────────────────────────────────────────
    c.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this._orbitState.dragging = true;
        this._orbitState.lastX = e.touches[0].clientX;
        this._orbitState.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._orbitState.pinchDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: true });

    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && this._orbitState.dragging) {
        const dx = e.touches[0].clientX - this._orbitState.lastX;
        const dy = e.touches[0].clientY - this._orbitState.lastY;
        this._orbitState.lastX = e.touches[0].clientX;
        this._orbitState.lastY = e.touches[0].clientY;
        this._orbitState.theta -= dx * 0.008;
        this._orbitState.phi = Math.max(0.1, Math.min(Math.PI - 0.1,
          this._orbitState.phi + dy * 0.008));
        this._updateCameraOrbit();
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const delta = this._orbitState.pinchDist - dist;
        this._orbitState.pinchDist = dist;
        this._orbitState.radius = Math.max(1.5, Math.min(20,
          this._orbitState.radius + delta * 0.02));
        this._updateCameraOrbit();
      }
    }, { passive: false });

    c.addEventListener('touchend', () => {
      this._orbitState.dragging = false;
    }, { passive: true });
  }
}

// ══════════════════════════════════════════════════════════════════
//  Default shaders (fallback when no graph is connected)
// ══════════════════════════════════════════════════════════════════

function buildDefaultUniforms(THREE) {
  return {
    uBaseColor:        { value: new THREE.Vector3(0.4, 0.4, 0.8) },
    uMetallic:         { value: 0.0 },
    uRoughness:        { value: 0.5 },
    uEmission:         { value: new THREE.Vector3(0, 0, 0) },
    uEmissionStrength: { value: 0.0 },
    uFresnelIOR:       { value: 0.0 },
    uLightDir:         { value: new THREE.Vector3(0.5, 0.8, 0.6) },
    uLightColor:       { value: new THREE.Vector3(1.0, 0.98, 0.92) },
    uAmbientColor:     { value: new THREE.Vector3(0.08, 0.08, 0.12) },
    uCameraPos:        { value: new THREE.Vector3(0, 0, 5) },
    uTime:             { value: 0.0 },
  };
}

function defaultVertexShader() {
  // NOTE: modelMatrix, viewMatrix, projectionMatrix, normalMatrix,
  // position, normal, uv are injected by Three.js ShaderMaterial.
  return /* glsl */ `
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
}

function defaultFragmentShader() {
  return /* glsl */ `
    precision highp float;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying vec2 vUv;

    uniform vec3  uBaseColor;
    uniform float uMetallic;
    uniform float uRoughness;
    uniform vec3  uEmission;
    uniform float uEmissionStrength;
    uniform float uFresnelIOR;
    uniform vec3  uLightDir;
    uniform vec3  uLightColor;
    uniform vec3  uAmbientColor;
    uniform vec3  uCameraPos;
    uniform float uTime;

    float schlickFresnel(float cosTheta, float ior) {
      float r0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
      return r0 + (1.0 - r0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
    }

    float distributionGGX(float NdotH, float rough) {
      float a  = rough * rough;
      float a2 = a * a;
      float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
      return a2 / (3.14159265 * denom * denom + 0.0001);
    }

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

      vec3 F0 = mix(vec3(0.04), uBaseColor, uMetallic);
      vec3 F  = F0 + (1.0 - F0) * pow(clamp(1.0 - HdotV, 0.0, 1.0), 5.0);

      float D = distributionGGX(NdotH, uRoughness);
      float G = geometrySmith(NdotV, NdotL, uRoughness);

      vec3 specular = (D * G * F) / (4.0 * NdotV * NdotL + 0.0001);
      vec3 kD = (vec3(1.0) - F) * (1.0 - uMetallic);
      vec3 diffuse = kD * uBaseColor / 3.14159265;

      vec3 Lo = (diffuse + specular) * uLightColor * NdotL;
      vec3 ambient = uAmbientColor * uBaseColor;

      float rimFresnel = pow(clamp(1.0 - NdotV, 0.0, 1.0), 3.0);
      vec3 rim = vec3(rimFresnel) * 0.15 * uLightColor;

      vec3 emissionContrib = uEmission * uEmissionStrength;

      vec3 color = ambient + Lo + rim + emissionContrib;
      color = color / (color + vec3(1.0));
      color = pow(color, vec3(1.0 / 2.2));

      gl_FragColor = vec4(color, 1.0);
    }
  `;
}
