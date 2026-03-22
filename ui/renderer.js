/**
 * ui/renderer.js - Canvas-based node graph renderer with touch support.
 * Features Blender-style inline value fields on unconnected inputs.
 */
import { registry, SocketColors } from '../core/registry.js';
import { NodeGraph } from '../core/graph.js';

export class GraphRenderer {
  constructor(canvas, graph) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.graph = graph;

    // View transform
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;

    // Node layout constants
    this.nodeWidth = 180;
    this.nodeHeaderH = 26;
    this.socketRowH = 24;
    this.socketSize = 6;
    this.nodePadding = 6;

    // Interaction state
    this.dragging = null;
    this.panning = false;
    this.connecting = null;
    this.selectedNode = null;
    this.hoveredSocket = null;
    this.pinchDist = null;

    // Inline value scrubbing state
    this.scrubbing = null; // { nodeId, propKey, startX, startVal, step, min, max, propType }

    // Touch tracking
    this.lastTouchPos = null;
    this.touchStartTime = 0;
    this.lastTapTime = 0;
    this.lastTapPos = null;

    // Callbacks
    this.onNodeSelected = null;
    this.onNodeDoubleTap = null;
    this.onConnectionMade = null;
    this.onConnectionDropped = null;
    this.onNodeValueChanged = null;
    this.onEmptyDoubleTap = null;
    this.onStatusUpdate = null;
    this.onValueFieldTap = null; // (node, prop, screenRect) - tap without drag on value field

    this._setupEvents();
    this._resize();

    this._raf = null;
    this._startLoop();
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewWidth = rect.width;
    this.viewHeight = rect.height;
  }

  _startLoop() {
    const loop = () => {
      this.render();
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  // ===== Coordinate transforms =====
  screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.zoom,
      y: (sy - this.panY) / this.zoom,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.zoom + this.panX,
      y: wy * this.zoom + this.panY,
    };
  }

  // ===== Node geometry helpers =====
  getNodeHeight(node) {
    const def = this.graph.getNodeDef(node);
    if (!def) return this.nodeHeaderH;
    if (node.collapsed) return this.nodeHeaderH;
    // Blender layout: outputs on top, then inputs below (each on own row)
    const rows = def.outputs.length + def.inputs.length;
    return this.nodeHeaderH + rows * this.socketRowH + this.nodePadding;
  }

  getSocketPos(node, isOutput, socketIdx) {
    const def = this.graph.getNodeDef(node);
    const x = isOutput ? node.x + this.nodeWidth : node.x;
    // Outputs at top, inputs below all outputs
    const outputCount = def ? def.outputs.length : 0;
    const rowIdx = isOutput ? socketIdx : outputCount + socketIdx;
    const y = node.y + this.nodeHeaderH + rowIdx * this.socketRowH + this.socketRowH / 2;
    return { x, y };
  }

  /** Get the bounding box of the inline value field for an input socket. */
  _getValueFieldRect(node, socketIdx) {
    const def = this.graph.getNodeDef(node);
    const outputCount = def ? def.outputs.length : 0;
    const x = node.x + this.socketSize + 4;
    const rowY = node.y + this.nodeHeaderH + (outputCount + socketIdx) * this.socketRowH;
    const fieldW = this.nodeWidth - this.socketSize * 2 - 8;
    return { x, y: rowY + 2, w: fieldW, h: this.socketRowH - 4 };
  }

  /** Find which property key corresponds to an input socket by matching names. */
  _getInputPropKey(node, def, socketIdx) {
    const inp = def.inputs[socketIdx];
    if (!inp || !def.props) return null;
    // Match by input name to prop key (common patterns)
    const name = inp.name;
    for (const p of def.props) {
      if (p.label === name) return p;
      // Match "Value" → "value", "Value2" → "value2", etc.
      if (p.key === name.toLowerCase()) return p;
      if (p.key === name.toLowerCase().replace(/ /g, '')) return p;
    }
    // Try matching first input to first numeric prop, second to second, etc.
    const numericProps = def.props.filter(p => p.type === 'float' || p.type === 'int');
    const numericInputs = def.inputs.filter(i => i.type === 'float' || i.type === 'int' || i.type === 'bool');
    const inputIdx = numericInputs.indexOf(inp);
    if (inputIdx >= 0 && inputIdx < numericProps.length) {
      return numericProps[inputIdx];
    }
    return null;
  }

  hitTestNode(wx, wy) {
    for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
      const node = this.graph.nodes[i];
      const h = this.getNodeHeight(node);
      if (wx >= node.x && wx <= node.x + this.nodeWidth &&
          wy >= node.y && wy <= node.y + h) {
        return node;
      }
    }
    return null;
  }

  hitTestSocket(wx, wy) {
    const hitR = 14 / this.zoom;
    for (const node of this.graph.nodes) {
      if (node.collapsed) continue;
      const def = this.graph.getNodeDef(node);
      if (!def) continue;

      for (let i = 0; i < def.outputs.length; i++) {
        const pos = this.getSocketPos(node, true, i);
        if (Math.abs(wx - pos.x) < hitR && Math.abs(wy - pos.y) < hitR) {
          return { nodeId: node.id, socketIdx: i, isOutput: true, type: def.outputs[i].type };
        }
      }
      for (let i = 0; i < def.inputs.length; i++) {
        const pos = this.getSocketPos(node, false, i);
        if (Math.abs(wx - pos.x) < hitR && Math.abs(wy - pos.y) < hitR) {
          return { nodeId: node.id, socketIdx: i, isOutput: false, type: def.inputs[i].type };
        }
      }
    }
    return null;
  }

  /** Hit-test inline value fields on unconnected inputs. Returns { node, socketIdx, prop } or null. */
  hitTestValueField(wx, wy) {
    for (let ni = this.graph.nodes.length - 1; ni >= 0; ni--) {
      const node = this.graph.nodes[ni];
      if (node.collapsed) continue;
      const def = this.graph.getNodeDef(node);
      if (!def) continue;

      for (let i = 0; i < def.inputs.length; i++) {
        const connected = this.graph.getInputConnection(node.id, i);
        if (connected) continue;

        const inp = def.inputs[i];
        if (inp.type !== 'float' && inp.type !== 'int') continue;

        const prop = this._getInputPropKey(node, def, i);
        if (!prop) continue;

        const rect = this._getValueFieldRect(node, i);
        if (wx >= rect.x && wx <= rect.x + rect.w &&
            wy >= rect.y && wy <= rect.y + rect.h) {
          return { node, socketIdx: i, prop };
        }
      }
    }
    return null;
  }

  // ===== Event handling =====
  _setupEvents() {
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);

    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    this.canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });

    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));
  }

  _getTouchPos(touch) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  _onTouchStart(e) {
    e.preventDefault();

    if (e.touches.length === 2) {
      const t1 = this._getTouchPos(e.touches[0]);
      const t2 = this._getTouchPos(e.touches[1]);
      this.pinchDist = Math.hypot(t2.x - t1.x, t2.y - t1.y);
      this.pinchCenter = { x: (t1.x + t2.x) / 2, y: (t1.y + t2.y) / 2 };
      this.dragging = null;
      this.connecting = null;
      this.scrubbing = null;
      return;
    }

    const pos = this._getTouchPos(e.touches[0]);
    const world = this.screenToWorld(pos.x, pos.y);

    const socket = this.hitTestSocket(world.x, world.y);
    if (socket) {
      this.connecting = {
        fromNode: socket.nodeId,
        fromSocket: socket.socketIdx,
        isOutput: socket.isOutput,
        type: socket.type,
        x: pos.x,
        y: pos.y,
      };
      return;
    }

    // Check for value field hit (scrub or tap-to-edit)
    const vf = this.hitTestValueField(world.x, world.y);
    if (vf) {
      this.scrubbing = {
        nodeId: vf.node.id,
        propKey: vf.prop.key,
        startX: pos.x,
        startVal: vf.node.values[vf.prop.key] ?? 0,
        step: vf.prop.step ?? 0.1,
        min: vf.prop.min ?? -10000,
        max: vf.prop.max ?? 10000,
        propType: vf.prop.type,
        moved: false,
        _vfNode: vf.node,
        _vfProp: vf.prop,
        _vfSocketIdx: vf.socketIdx,
      };
      this.selectedNode = vf.node.id;
      if (this.onNodeSelected) this.onNodeSelected(vf.node);
      return;
    }

    const node = this.hitTestNode(world.x, world.y);
    if (node) {
      const now = Date.now();
      if (now - this.lastTapTime < 350 && this.selectedNode === node.id) {
        if (this.onNodeDoubleTap) this.onNodeDoubleTap(node);
        this.lastTapTime = 0;
        return;
      }
      this.lastTapTime = now;
      this.lastTapPos = { x: pos.x, y: pos.y };

      this.selectedNode = node.id;
      if (this.onNodeSelected) this.onNodeSelected(node);

      const idx = this.graph.nodes.indexOf(node);
      if (idx >= 0) {
        this.graph.nodes.splice(idx, 1);
        this.graph.nodes.push(node);
      }

      this.dragging = {
        nodeId: node.id,
        offsetX: world.x - node.x,
        offsetY: world.y - node.y,
        startX: node.x,
        startY: node.y,
        moved: false,
      };
      this.touchStartTime = Date.now();
    } else {
      // Empty space tap
      const now = Date.now();
      if (now - this.lastTapTime < 350 && this.lastTapPos &&
          Math.abs(pos.x - this.lastTapPos.x) < 30 && Math.abs(pos.y - this.lastTapPos.y) < 30) {
        // Double tap on empty space
        if (this.onEmptyDoubleTap) {
          const rect = this.canvas.getBoundingClientRect();
          this.onEmptyDoubleTap({ screenX: rect.left + pos.x, screenY: rect.top + pos.y, worldX: world.x, worldY: world.y });
        }
        this.lastTapTime = 0;
        this.lastTapPos = null;
        return;
      }
      this.lastTapTime = now;
      this.lastTapPos = { x: pos.x, y: pos.y };
      this.panning = true;
      this.lastTouchPos = pos;
      this.selectedNode = null;
      if (this.onNodeSelected) this.onNodeSelected(null);
    }
  }

  _onTouchMove(e) {
    e.preventDefault();

    if (e.touches.length === 2 && this.pinchDist !== null) {
      const t1 = this._getTouchPos(e.touches[0]);
      const t2 = this._getTouchPos(e.touches[1]);
      const newDist = Math.hypot(t2.x - t1.x, t2.y - t1.y);
      const center = { x: (t1.x + t2.x) / 2, y: (t1.y + t2.y) / 2 };

      const scale = newDist / this.pinchDist;
      const newZoom = Math.min(10, Math.max(0.05, this.zoom * scale));

      this.panX = center.x - (center.x - this.panX) * (newZoom / this.zoom);
      this.panY = center.y - (center.y - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;
      this.pinchDist = newDist;

      if (this.pinchCenter) {
        this.panX += center.x - this.pinchCenter.x;
        this.panY += center.y - this.pinchCenter.y;
        this.pinchCenter = center;
      }
      return;
    }

    const pos = this._getTouchPos(e.touches[0]);

    if (this.scrubbing) {
      // Only start actual scrubbing after a minimum drag distance (5px)
      if (Math.abs(pos.x - this.scrubbing.startX) > 5) {
        this.scrubbing.moved = true;
        this._handleScrub(pos.x);
      }
      return;
    }

    if (this.connecting) {
      this.connecting.x = pos.x;
      this.connecting.y = pos.y;
      return;
    }

    if (this.dragging) {
      const world = this.screenToWorld(pos.x, pos.y);
      this.graph.moveNode(
        this.dragging.nodeId,
        world.x - this.dragging.offsetX,
        world.y - this.dragging.offsetY
      );
      this.dragging.moved = true;
      return;
    }

    if (this.panning && this.lastTouchPos) {
      this.panX += pos.x - this.lastTouchPos.x;
      this.panY += pos.y - this.lastTouchPos.y;
      this.lastTouchPos = pos;
    }
  }

  _onTouchEnd(e) {
    if (this.scrubbing) {
      if (!this.scrubbing.moved && this.onValueFieldTap) {
        // Tap without drag → open numeric input
        const node = this.scrubbing._vfNode;
        const prop = this.scrubbing._vfProp;
        const socketIdx = this.scrubbing._vfSocketIdx;
        const rect = this._getValueFieldRect(node, socketIdx);
        const screenTL = this.worldToScreen(rect.x, rect.y);
        const screenBR = this.worldToScreen(rect.x + rect.w, rect.y + rect.h);
        this.onValueFieldTap(node, prop, {
          x: screenTL.x,
          y: screenTL.y,
          w: screenBR.x - screenTL.x,
          h: screenBR.y - screenTL.y,
        });
      }
      this.scrubbing = null;
      return;
    }

    if (this.connecting && e.touches.length === 0) {
      const pos = { x: this.connecting.x, y: this.connecting.y };
      const world = this.screenToWorld(pos.x, pos.y);
      const socket = this.hitTestSocket(world.x, world.y);

      if (socket && socket.isOutput !== this.connecting.isOutput &&
          NodeGraph.typesCompatible(
            this.connecting.isOutput ? this.connecting.type : socket.type,
            this.connecting.isOutput ? socket.type : this.connecting.type)) {
        let from, to;
        if (this.connecting.isOutput) {
          from = { nodeId: this.connecting.fromNode, socketIdx: this.connecting.fromSocket };
          to = { nodeId: socket.nodeId, socketIdx: socket.socketIdx };
        } else {
          from = { nodeId: socket.nodeId, socketIdx: socket.socketIdx };
          to = { nodeId: this.connecting.fromNode, socketIdx: this.connecting.fromSocket };
        }
        const ok = this.graph.addConnection(from.nodeId, from.socketIdx, to.nodeId, to.socketIdx);
        if (ok && this.onConnectionMade) this.onConnectionMade();
      } else if (!socket && this.onConnectionDropped) {
        const rect = this.canvas.getBoundingClientRect();
        this.onConnectionDropped({
          fromNode: this.connecting.fromNode,
          fromSocket: this.connecting.fromSocket,
          isOutput: this.connecting.isOutput,
          socketType: this.connecting.type,
          screenX: rect.left + pos.x,
          screenY: rect.top + pos.y,
          worldX: world.x,
          worldY: world.y,
        });
      }
      this.connecting = null;
    }

    if (this.dragging) {
      this.dragging = null;
    }

    this.panning = false;
    this.pinchDist = null;
    this.pinchCenter = null;
    this.lastTouchPos = null;
  }

  // ===== Mouse events (desktop) =====
  _onMouseDown(e) {
    const pos = { x: e.offsetX, y: e.offsetY };
    const world = this.screenToWorld(pos.x, pos.y);

    const socket = this.hitTestSocket(world.x, world.y);
    if (socket) {
      this.connecting = {
        fromNode: socket.nodeId,
        fromSocket: socket.socketIdx,
        isOutput: socket.isOutput,
        type: socket.type,
        x: pos.x,
        y: pos.y,
      };
      return;
    }

    // Check for value field hit (scrub or tap-to-edit)
    const vf = this.hitTestValueField(world.x, world.y);
    if (vf) {
      this.scrubbing = {
        nodeId: vf.node.id,
        propKey: vf.prop.key,
        startX: pos.x,
        startVal: vf.node.values[vf.prop.key] ?? 0,
        step: vf.prop.step ?? 0.1,
        min: vf.prop.min ?? -10000,
        max: vf.prop.max ?? 10000,
        propType: vf.prop.type,
        moved: false,
        _vfNode: vf.node,
        _vfProp: vf.prop,
        _vfSocketIdx: vf.socketIdx,
      };
      this.selectedNode = vf.node.id;
      if (this.onNodeSelected) this.onNodeSelected(vf.node);
      return;
    }

    const node = this.hitTestNode(world.x, world.y);
    if (node) {
      this.selectedNode = node.id;
      if (this.onNodeSelected) this.onNodeSelected(node);

      const idx = this.graph.nodes.indexOf(node);
      if (idx >= 0) {
        this.graph.nodes.splice(idx, 1);
        this.graph.nodes.push(node);
      }

      this.dragging = {
        nodeId: node.id,
        offsetX: world.x - node.x,
        offsetY: world.y - node.y,
        moved: false,
      };
    } else {
      this.panning = true;
      this.lastTouchPos = pos;
      this.selectedNode = null;
      if (this.onNodeSelected) this.onNodeSelected(null);
    }
  }

  _onMouseMove(e) {
    const pos = { x: e.offsetX, y: e.offsetY };

    if (this.scrubbing) {
      if (Math.abs(pos.x - this.scrubbing.startX) > 5) {
        this.scrubbing.moved = true;
        this._handleScrub(pos.x);
      }
      return;
    }

    if (this.connecting) {
      this.connecting.x = pos.x;
      this.connecting.y = pos.y;
      return;
    }

    if (this.dragging) {
      const world = this.screenToWorld(pos.x, pos.y);
      this.graph.moveNode(
        this.dragging.nodeId,
        world.x - this.dragging.offsetX,
        world.y - this.dragging.offsetY
      );
      this.dragging.moved = true;
      return;
    }

    if (this.panning && this.lastTouchPos) {
      this.panX += pos.x - this.lastTouchPos.x;
      this.panY += pos.y - this.lastTouchPos.y;
      this.lastTouchPos = pos;
    }

    const world = this.screenToWorld(pos.x, pos.y);
    this.hoveredSocket = this.hitTestSocket(world.x, world.y);
  }

  _onMouseUp(e) {
    if (this.scrubbing) {
      if (!this.scrubbing.moved && this.onValueFieldTap) {
        const node = this.scrubbing._vfNode;
        const prop = this.scrubbing._vfProp;
        const socketIdx = this.scrubbing._vfSocketIdx;
        const rect = this._getValueFieldRect(node, socketIdx);
        const screenTL = this.worldToScreen(rect.x, rect.y);
        const screenBR = this.worldToScreen(rect.x + rect.w, rect.y + rect.h);
        this.onValueFieldTap(node, prop, {
          x: screenTL.x,
          y: screenTL.y,
          w: screenBR.x - screenTL.x,
          h: screenBR.y - screenTL.y,
        });
      }
      this.scrubbing = null;
      return;
    }

    if (this.connecting) {
      const pos = { x: e.offsetX, y: e.offsetY };
      const world = this.screenToWorld(pos.x, pos.y);
      const socket = this.hitTestSocket(world.x, world.y);

      if (socket && socket.isOutput !== this.connecting.isOutput &&
          NodeGraph.typesCompatible(
            this.connecting.isOutput ? this.connecting.type : socket.type,
            this.connecting.isOutput ? socket.type : this.connecting.type)) {
        let from, to;
        if (this.connecting.isOutput) {
          from = { nodeId: this.connecting.fromNode, socketIdx: this.connecting.fromSocket };
          to = { nodeId: socket.nodeId, socketIdx: socket.socketIdx };
        } else {
          from = { nodeId: socket.nodeId, socketIdx: socket.socketIdx };
          to = { nodeId: this.connecting.fromNode, socketIdx: this.connecting.fromSocket };
        }
        this.graph.addConnection(from.nodeId, from.socketIdx, to.nodeId, to.socketIdx);
        if (this.onConnectionMade) this.onConnectionMade();
      } else if (!socket && this.onConnectionDropped) {
        const rect = this.canvas.getBoundingClientRect();
        this.onConnectionDropped({
          fromNode: this.connecting.fromNode,
          fromSocket: this.connecting.fromSocket,
          isOutput: this.connecting.isOutput,
          socketType: this.connecting.type,
          screenX: e.clientX,
          screenY: e.clientY,
          worldX: world.x,
          worldY: world.y,
        });
      }
      this.connecting = null;
    }

    this.dragging = null;
    this.panning = false;
    this.lastTouchPos = null;
  }

  _onWheel(e) {
    e.preventDefault();
    const pos = { x: e.offsetX, y: e.offsetY };
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(10, Math.max(0.05, this.zoom * delta));

    this.panX = pos.x - (pos.x - this.panX) * (newZoom / this.zoom);
    this.panY = pos.y - (pos.y - this.panY) * (newZoom / this.zoom);
    this.zoom = newZoom;
  }

  _onDblClick(e) {
    const pos = { x: e.offsetX, y: e.offsetY };
    const world = this.screenToWorld(pos.x, pos.y);
    const node = this.hitTestNode(world.x, world.y);
    if (node) {
      if (this.onNodeDoubleTap) this.onNodeDoubleTap(node);
    } else {
      // Double click on empty space
      if (this.onEmptyDoubleTap) {
        this.onEmptyDoubleTap({ screenX: e.clientX, screenY: e.clientY, worldX: world.x, worldY: world.y });
      }
    }
  }

  // ===== Value scrubbing =====
  _handleScrub(screenX) {
    if (!this.scrubbing) return;
    const s = this.scrubbing;
    const deltaPixels = screenX - s.startX;
    const sensitivity = s.step * 0.5;
    let newVal = s.startVal + deltaPixels * sensitivity;
    newVal = Math.max(s.min, Math.min(s.max, newVal));
    if (s.propType === 'int') newVal = Math.round(newVal);
    else newVal = Math.round(newVal * 1000) / 1000;

    const node = this.graph.nodes.find(n => n.id === s.nodeId);
    if (node) {
      this.graph.setNodeValue(s.nodeId, s.propKey, newVal);
      if (this.onNodeValueChanged) this.onNodeValueChanged(node);
    }
  }

  // ===== Zoom to fit =====
  zoomToFit() {
    if (this.graph.nodes.length === 0) {
      this.panX = this.viewWidth / 2;
      this.panY = this.viewHeight / 2;
      this.zoom = 1;
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of this.graph.nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + this.nodeWidth);
      maxY = Math.max(maxY, node.y + this.getNodeHeight(node));
    }

    const pad = 40;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    this.zoom = Math.min(2, Math.min(this.viewWidth / w, this.viewHeight / h));
    this.panX = (this.viewWidth - w * this.zoom) / 2 - minX * this.zoom + pad * this.zoom;
    this.panY = (this.viewHeight - h * this.zoom) / 2 - minY * this.zoom + pad * this.zoom;
  }

  // ===== Rendering =====
  render() {
    const ctx = this.ctx;
    const w = this.viewWidth;
    const h = this.viewHeight;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    this._drawGrid(ctx, w, h);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    this._drawConnections(ctx);

    if (this.connecting) {
      this._drawActiveConnection(ctx);
    }

    for (const node of this.graph.nodes) {
      this._drawNode(ctx, node);
    }

    ctx.restore();
  }

  _drawGrid(ctx, w, h) {
    const gridSize = 30 * this.zoom;
    const offsetX = this.panX % gridSize;
    const offsetY = this.panY % gridSize;

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offsetX; x < w; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = offsetY; y < h; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    const majorSize = gridSize * 5;
    const majorOffX = this.panX % majorSize;
    const majorOffY = this.panY % majorSize;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    for (let x = majorOffX; x < w; x += majorSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = majorOffY; y < h; y += majorSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  _drawConnections(ctx) {
    for (const conn of this.graph.connections) {
      const fromNode = this.graph.nodes.find(n => n.id === conn.fromNode);
      const toNode = this.graph.nodes.find(n => n.id === conn.toNode);
      if (!fromNode || !toNode) continue;

      const fromPos = this.getSocketPos(fromNode, true, conn.fromSocket);
      const toPos = this.getSocketPos(toNode, false, conn.toSocket);

      const fromDef = this.graph.getNodeDef(fromNode);
      const socketType = fromDef?.outputs[conn.fromSocket]?.type || 'float';
      const color = SocketColors[socketType] || '#90a4ae';

      this._drawCurve(ctx, fromPos.x, fromPos.y, toPos.x, toPos.y, color, 2.5);
    }
  }

  _drawActiveConnection(ctx) {
    const conn = this.connecting;
    const node = this.graph.nodes.find(n => n.id === conn.fromNode);
    if (!node) return;

    const socketPos = this.getSocketPos(node, conn.isOutput, conn.fromSocket);
    const endWorld = this.screenToWorld(conn.x, conn.y);
    const color = SocketColors[conn.type] || '#90a4ae';

    if (conn.isOutput) {
      this._drawCurve(ctx, socketPos.x, socketPos.y, endWorld.x, endWorld.y, color, 2, true);
    } else {
      this._drawCurve(ctx, endWorld.x, endWorld.y, socketPos.x, socketPos.y, color, 2, true);
    }
  }

  _drawCurve(ctx, x1, y1, x2, y2, color, width, dashed) {
    const dx = Math.abs(x2 - x1) * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
    ctx.stroke();
    if (dashed) ctx.setLineDash([]);
  }

  _drawNode(ctx, node) {
    const def = this.graph.getNodeDef(node);
    if (!def) return;

    const x = node.x;
    const y = node.y;
    const w = this.nodeWidth;
    const h = this.getNodeHeight(node);
    const r = 8;
    const graphType = this.graph.graphType;
    const categories = registry.getCategories(graphType);
    const cat = categories[def.category] || {};
    const isSelected = this.selectedNode === node.id;

    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;

    // Body
    ctx.fillStyle = '#232b3e';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Header
    ctx.fillStyle = cat.color || '#444';
    ctx.beginPath();
    ctx.roundRect(x, y, w, this.nodeHeaderH, [r, r, 0, 0]);
    ctx.fill();

    // Header text
    ctx.fillStyle = '#fff';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';
    const icon = cat.icon || '';
    ctx.fillText(icon + ' ' + def.label, x + 8, y + this.nodeHeaderH / 2);

    // Selection border
    if (isSelected) {
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 1, y - 1, w + 2, h + 2, r + 1);
      ctx.stroke();
    }

    if (node.collapsed) return;

    // Blender layout: outputs at top, then inputs below
    let rowIdx = 0;

    // Draw output sockets first (top of node body)
    for (let i = 0; i < def.outputs.length; i++) {
      const rowY = y + this.nodeHeaderH + rowIdx * this.socketRowH;

      if (rowIdx > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 4, rowY);
        ctx.lineTo(x + w - 4, rowY);
        ctx.stroke();
      }

      const out = def.outputs[i];
      const sx = x + w;
      const sy = rowY + this.socketRowH / 2;
      const color = SocketColors[out.type] || '#90a4ae';

      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, this.socketSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#bbb';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(out.name, sx - this.socketSize - 6, sy + 1);

      rowIdx++;
    }

    // Draw input sockets below outputs
    for (let i = 0; i < def.inputs.length; i++) {
      const rowY = y + this.nodeHeaderH + rowIdx * this.socketRowH;

      if (rowIdx > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 4, rowY);
        ctx.lineTo(x + w - 4, rowY);
        ctx.stroke();
      }

      const inp = def.inputs[i];
      const sx = x;
      const sy = rowY + this.socketRowH / 2;
      const color = SocketColors[inp.type] || '#90a4ae';
      const connected = this.graph.getInputConnection(node.id, i);

      // Socket circle
      ctx.fillStyle = connected ? color : '#232b3e';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, this.socketSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (!connected && (inp.type === 'float' || inp.type === 'int')) {
        // Draw Blender-style inline value field
        const prop = this._getInputPropKey(node, def, i);
        if (prop) {
          this._drawValueField(ctx, node, i, inp, prop, rowY);
        } else {
          ctx.fillStyle = '#ccc';
          ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(inp.name, sx + this.socketSize + 6, sy + 1);
        }
      } else {
        // Normal label (for connected inputs or non-numeric types)
        ctx.fillStyle = connected ? '#999' : '#ccc';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(inp.name, sx + this.socketSize + 6, sy + 1);
      }

      rowIdx++;
    }

    ctx.textAlign = 'left';
  }

  /** Draw Blender-style inline value field for an unconnected numeric input. */
  _drawValueField(ctx, node, socketIdx, inp, prop, rowY) {
    const rect = this._getValueFieldRect(node, socketIdx);
    const val = node.values[prop.key] ?? 0;
    const isScrubbing = this.scrubbing && this.scrubbing.nodeId === node.id && this.scrubbing.propKey === prop.key;

    // Background bar
    ctx.fillStyle = isScrubbing ? 'rgba(79,195,247,0.15)' : 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 3);
    ctx.fill();

    // Fill proportion bar (shows value relative to min/max range)
    const min = prop.min ?? 0;
    const max = prop.max ?? 1;
    const range = max - min;
    if (range > 0) {
      const frac = Math.max(0, Math.min(1, (val - min) / range));
      const barW = frac * rect.w;
      if (barW > 0) {
        ctx.fillStyle = isScrubbing ? 'rgba(79,195,247,0.25)' : 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, barW, rect.h, [3, 0, 0, 3]);
        ctx.fill();
      }
    }

    // Border on hover/scrub
    if (isScrubbing) {
      ctx.strokeStyle = 'rgba(79,195,247,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 3);
      ctx.stroke();
    }

    // Label on left
    ctx.fillStyle = '#999';
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(inp.name, rect.x + 4, rect.y + rect.h / 2);

    // Value on right
    const displayVal = prop.type === 'int' ? Math.round(val).toString() : val.toFixed(2);
    ctx.fillStyle = '#ddd';
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(displayVal, rect.x + rect.w - 4, rect.y + rect.h / 2);

    ctx.textAlign = 'left';
  }
}
