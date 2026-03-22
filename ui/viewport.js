/**
 * ui/viewport.js - Three.js 3D viewport for previewing geometry node output.
 * Refactored as ES module. Uses geo/converter.js for GeometrySet → Three.js.
 */
import { geometrySetToThreeJS } from '../geo/converter.js';

export class Viewport3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.meshes = [];
    this.wireframeMode = false;
    this.orbitAngle = 0;
    this.orbitPhi = 0.6;
    this.orbitDist = 5;
    this.orbitTarget = { x: 0, y: 0, z: 0 };
    this.isActive = false;

    this.lastTouch = null;
    this.lastPinchDist = null;

    this._init();
  }

  _init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this._updateCamera();

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 8, 6);
    this.scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0x4fc3f7, 0.3);
    dirLight2.position.set(-3, 2, -4);
    this.scene.add(dirLight2);

    // Grid and axes
    const gridHelper = new THREE.GridHelper(10, 10, 0x2d3a55, 0x1e2a45);
    this.scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(1);
    this.scene.add(axesHelper);

    // Events
    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', () => this._onTouchEnd(), { passive: false });
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.isActive) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.isActive = true;
    this.resize();
    this._animate();
  }

  stop() {
    this.isActive = false;
  }

  _animate() {
    if (!this.isActive) return;
    requestAnimationFrame(() => this._animate());
    this.renderer.render(this.scene, this.camera);
  }

  _updateCamera() {
    const x = this.orbitTarget.x + this.orbitDist * Math.sin(this.orbitAngle) * Math.cos(this.orbitPhi);
    const y = this.orbitTarget.y + this.orbitDist * Math.sin(this.orbitPhi);
    const z = this.orbitTarget.z + this.orbitDist * Math.cos(this.orbitAngle) * Math.cos(this.orbitPhi);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.orbitTarget.x, this.orbitTarget.y, this.orbitTarget.z);
  }

  resetCamera() {
    this.orbitAngle = 0.6;
    this.orbitPhi = 0.5;
    this.orbitDist = 5;
    this.orbitTarget = { x: 0, y: 0, z: 0 };
    this._updateCamera();
  }

  toggleWireframe() {
    this.wireframeMode = !this.wireframeMode;
    for (const mesh of this.meshes) {
      if (mesh.material) {
        mesh.material.wireframe = this.wireframeMode;
      }
    }
    return this.wireframeMode;
  }

  // ===== Touch/mouse orbit controls =====
  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.lastPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    } else if (e.touches.length === 1) {
      this.lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (this.lastPinchDist) {
        const scale = this.lastPinchDist / dist;
        this.orbitDist = Math.max(1, Math.min(30, this.orbitDist * scale));
        this._updateCamera();
      }
      this.lastPinchDist = dist;
    } else if (e.touches.length === 1 && this.lastTouch) {
      const dx = e.touches[0].clientX - this.lastTouch.x;
      const dy = e.touches[0].clientY - this.lastTouch.y;
      this.orbitAngle -= dx * 0.01;
      this.orbitPhi = Math.max(-1.5, Math.min(1.5, this.orbitPhi + dy * 0.01));
      this._updateCamera();
      this.lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }

  _onTouchEnd() {
    this.lastTouch = null;
    this.lastPinchDist = null;
  }

  _onMouseDown(e) {
    const onMove = (ev) => {
      this.orbitAngle -= ev.movementX * 0.01;
      this.orbitPhi = Math.max(-1.5, Math.min(1.5, this.orbitPhi + ev.movementY * 0.01));
      this._updateCamera();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  _onWheel(e) {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 1.1 : 0.9;
    this.orbitDist = Math.max(1, Math.min(30, this.orbitDist * scale));
    this._updateCamera();
  }

  // ===== Build geometry from evaluation results =====
  /**
   * Update the viewport with GeometrySet objects from the new v2 pipeline.
   * @param {GeometrySet[]} geometrySets - Array of GeometrySet instances
   */
  updateGeometry(geometrySets) {
    // Remove old objects
    for (const obj of this.meshes) {
      this.scene.remove(obj);
      obj.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    }
    this.meshes = [];

    if (!geometrySets || geometrySets.length === 0) return { verts: 0, faces: 0 };

    let totalVerts = 0;
    let totalFaces = 0;

    for (const gs of geometrySets) {
      if (!gs) continue;
      const result = geometrySetToThreeJS(gs, this.wireframeMode);
      for (const obj of result.objects) {
        this.scene.add(obj);
        this.meshes.push(obj);
      }
      totalVerts += result.verts;
      totalFaces += result.faces;
    }

    return { verts: totalVerts, faces: totalFaces };
  }
}
