/**
 * app.js - Main application controller (ES module).
 * Ties together the graph, renderer, viewport, shader preview, and UI.
 * Supports both geometry and shader graph types via tabs.
 */
import { registry } from './core/registry.js';
import { NodeGraph } from './core/graph.js';

// Import v2 node registrations (real geometry pipeline)
import { registerPrimitiveNodes } from './geo/nodes_v2_primitives.js';
import { registerOperationNodes } from './geo/nodes_v2_operations.js';
import { registerCurveNodes } from './geo/nodes_v2_curves.js';
import { registerFieldNodes } from './geo/nodes_v2_fields.js';
import { registerPointOpNodes } from './geo/nodes_v2_point_ops.js';
import { registerRotationNodes } from './geo/nodes_v2_rotation.js';
import { registerMeshOpNodes } from './geo/nodes_v2_mesh_ops.js';
import { registerUtilityNodes } from './geo/nodes_v2_utilities.js';
import { registerSamplingNodes } from './geo/nodes_v2_sampling.js';

// Register all v2 geometry nodes
registerPrimitiveNodes(registry);
registerOperationNodes(registry);
registerCurveNodes(registry);
registerFieldNodes(registry);
registerPointOpNodes(registry);
registerRotationNodes(registry);
registerMeshOpNodes(registry);
registerUtilityNodes(registry);
registerSamplingNodes(registry);

// Import shader nodes (unchanged)
import './shader/nodes.js';

import { GraphRenderer } from './ui/renderer.js';
import { Viewport3D } from './ui/viewport.js';
import { ShaderPreview } from './shader/preview.js';
import { compileShader } from './shader/compiler.js';

(function () {
  'use strict';

  // ===== Dual graph instances =====
  const geoGraph = new NodeGraph('geo');
  const shaderGraph = new NodeGraph('shader');
  let activeGraphType = 'geo';
  let activeGraph = geoGraph;

  // ===== Core UI instances =====
  const graphCanvas = document.getElementById('graph-canvas');
  let renderer = new GraphRenderer(graphCanvas, activeGraph);

  const threeCanvas = document.getElementById('three-canvas');
  const viewport = new Viewport3D(threeCanvas);

  const shaderCanvas = document.getElementById('shader-canvas');
  let shaderPreview = null;
  try {
    shaderPreview = new ShaderPreview(shaderCanvas);
  } catch (e) {
    console.warn('Shader preview init failed:', e);
  }

  // ===== UI Elements =====
  const btnMenu = document.getElementById('btn-menu');
  const btnAddNode = document.getElementById('btn-add-node');
  const btnRun = document.getElementById('btn-run');
  const btnToggleView = document.getElementById('btn-toggle-view');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const btnUndo = document.getElementById('btn-undo');
  const sideMenu = document.getElementById('side-menu');
  const menuOverlay = document.getElementById('menu-overlay');
  const btnCloseMenu = document.getElementById('btn-close-menu');
  const nodeSearch = document.getElementById('node-search');
  const nodeCategories = document.getElementById('node-categories');
  const propsPanel = document.getElementById('properties-panel');
  const propsOverlay = document.getElementById('props-overlay');
  const btnCloseProps = document.getElementById('btn-close-props');
  const propsTitle = document.getElementById('props-title');
  const propsContent = document.getElementById('props-content');
  const btnDeleteNode = document.getElementById('btn-delete-node');
  const viewport3d = document.getElementById('viewport-3d');
  const shaderPreviewEl = document.getElementById('shader-preview');
  const btnResetCam = document.getElementById('btn-reset-cam');
  const btnWireframe = document.getElementById('btn-wireframe');
  const viewportInfo = document.getElementById('viewport-info');
  const shaderPreviewInfo = document.getElementById('shader-preview-info');
  const statusText = document.getElementById('status-text');
  const graphTabs = document.getElementById('graph-tabs');
  const btnShaderShape = document.getElementById('btn-shader-shape');

  const dropMenu = document.getElementById('drop-menu');
  const dropMenuSearch = document.getElementById('drop-menu-search');
  const dropMenuItems = document.getElementById('drop-menu-items');
  const dropMenuOverlay = document.getElementById('drop-menu-overlay');

  let viewportVisible = false;
  let shaderPreviewVisible = false;
  let currentPropsNode = null;
  let pendingDrop = null; // stores connection drop info for context menu

  // ===== Graph Version & Storage =====
  const GRAPH_VERSION = 4; // v2 pipeline: real geometry (GeometrySet) instead of descriptors

  function getStorageKey(graphType) {
    return graphType === 'shader' ? 'geonodes_shader_graph' : 'geonodes_graph';
  }

  function initDefaultScene(graph) {
    const savedVersion = localStorage.getItem('geonodes_version');
    const saved = localStorage.getItem(getStorageKey(graph.graphType));
    if (saved && parseInt(savedVersion) === GRAPH_VERSION && graph.fromJSON(saved)) {
      statusText.textContent = `Loaded saved ${graph.graphType} graph`;
      return;
    }

    if (graph.graphType === 'geo') {
      const cubeNode = graph.addNode('mesh_cube', 50, 100);
      const transformNode = graph.addNode('transform_geometry', 300, 80);
      const outputNode = graph.addNode('output', 550, 120);
      if (cubeNode && transformNode && outputNode) {
        graph.addConnection(cubeNode.id, 0, transformNode.id, 0);
        graph.addConnection(transformNode.id, 0, outputNode.id, 0);
      }
      statusText.textContent = 'Default geometry scene loaded';
    } else if (graph.graphType === 'shader') {
      const colorNode = graph.addNode('color_value', 50, 80);
      const bsdfNode = graph.addNode('principled_bsdf', 300, 60);
      const outputNode = graph.addNode('shader_output', 550, 100);
      if (colorNode && bsdfNode && outputNode) {
        graph.addConnection(colorNode.id, 0, bsdfNode.id, 0);
        graph.addConnection(bsdfNode.id, 0, outputNode.id, 0);
      }
      statusText.textContent = 'Default shader scene loaded';
    }
  }

  function saveGraph() {
    try {
      localStorage.setItem(getStorageKey(activeGraph.graphType), activeGraph.toJSON());
      localStorage.setItem('geonodes_version', GRAPH_VERSION.toString());
      localStorage.setItem('geonodes_active_tab', activeGraphType);
    } catch (e) {
      // Storage full
    }
  }

  // ===== Tab Switching =====
  function switchTab(graphType) {
    if (graphType === activeGraphType) return;

    // Save current state
    saveGraph();
    closeProperties();

    activeGraphType = graphType;
    activeGraph = graphType === 'shader' ? shaderGraph : geoGraph;

    // Update renderer to use new graph
    renderer.destroy();
    renderer = new GraphRenderer(graphCanvas, activeGraph);
    setupRendererCallbacks();
    renderer.zoomToFit();

    // Update tab UI
    graphTabs.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === graphType);
    });

    // Toggle viewport vs shader preview
    if (graphType === 'shader') {
      if (viewportVisible) {
        viewport3d.classList.add('hidden');
        viewport.stop();
        viewportVisible = false;
      }
    } else {
      if (shaderPreviewVisible) {
        shaderPreviewEl.classList.add('hidden');
        if (shaderPreview) shaderPreview.stop();
        shaderPreviewVisible = false;
      }
    }

    statusText.textContent = `Switched to ${graphType === 'shader' ? 'Shader' : 'Geometry'} graph`;
    setTimeout(() => renderer._resize(), 50);
  }

  // ===== Side Menu (Add Node) =====
  function openMenu() {
    sideMenu.classList.remove('hidden');
    sideMenu.classList.add('visible');
    menuOverlay.classList.remove('hidden');
    menuOverlay.classList.add('visible');
    nodeSearch.value = '';
    buildNodeList('');
    setTimeout(() => nodeSearch.focus(), 300);
  }

  function closeMenu() {
    sideMenu.classList.remove('visible');
    menuOverlay.classList.remove('visible');
    setTimeout(() => {
      sideMenu.classList.add('hidden');
      menuOverlay.classList.add('hidden');
    }, 250);
  }

  function buildNodeList(filter) {
    nodeCategories.innerHTML = '';
    const lowerFilter = filter.toLowerCase();
    const nodeTypes = registry.getNodeTypes(activeGraphType);
    const categories = registry.getCategories(activeGraphType);

    const grouped = {};
    for (const [typeId, def] of Object.entries(nodeTypes)) {
      if (lowerFilter && !def.label.toLowerCase().includes(lowerFilter)) continue;

      const cat = def.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ typeId, def });
    }

    for (const [catId, items] of Object.entries(grouped)) {
      const catDef = categories[catId];
      if (!catDef) continue;

      const section = document.createElement('div');
      section.className = 'node-category';

      const h3 = document.createElement('h3');
      h3.textContent = catDef.name;
      section.appendChild(h3);

      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'node-list-item';
        el.innerHTML = `
          <div class="node-icon" style="background:${catDef.color}">${catDef.icon}</div>
          <span class="node-label">${item.def.label}</span>
        `;
        el.addEventListener('click', () => {
          addNodeToCenter(item.typeId);
          closeMenu();
        });
        section.appendChild(el);
      }

      nodeCategories.appendChild(section);
    }
  }

  function addNodeToCenter(typeId) {
    const def = registry.getNodeDef(activeGraphType, typeId);
    // Check if singular node already exists (like Blender: "only one allowed")
    if (def?.singular) {
      const existing = activeGraph.nodes.find(n => n.type === typeId);
      if (existing) {
        statusText.textContent = `Only one ${def.label} node is allowed per node tree`;
        // Select and focus on the existing one
        renderer.selectedNode = existing.id;
        if (renderer.onNodeSelected) renderer.onNodeSelected(existing);
        return;
      }
    }
    const center = renderer.screenToWorld(renderer.viewWidth / 2, renderer.viewHeight / 2);
    const x = center.x - renderer.nodeWidth / 2 + (Math.random() - 0.5) * 40;
    const y = center.y - 40 + (Math.random() - 0.5) * 40;
    const node = activeGraph.addNode(typeId, x, y);
    if (node) {
      renderer.selectedNode = node.id;
      statusText.textContent = `Added ${def?.label || typeId}`;
      saveGraph();
      autoRun();
    }
  }

  // ===== Connection Drop Context Menu =====
  function openDropMenu(info) {
    pendingDrop = info;
    const nodeTypes = registry.getNodeTypes(activeGraphType);
    const categories = registry.getCategories(activeGraphType);
    // Filter to compatible nodes
    const compatible = [];
    for (const [typeId, def] of Object.entries(nodeTypes)) {
      // Skip singular nodes that already exist in the graph
      if (def.singular && activeGraph.nodes.find(n => n.type === typeId)) continue;

      if (info.isOutput) {
        // Dragged from an output: need nodes with a matching INPUT
        const matchIdx = def.inputs.findIndex(inp =>
          inp.type === info.socketType || NodeGraph.typesCompatible(info.socketType, inp.type));
        if (matchIdx >= 0) compatible.push({ typeId, def, matchIdx, matchIsOutput: false });
      } else {
        // Dragged from an input: need nodes with a matching OUTPUT
        const matchIdx = def.outputs.findIndex(out =>
          out.type === info.socketType || NodeGraph.typesCompatible(out.type, info.socketType));
        if (matchIdx >= 0) compatible.push({ typeId, def, matchIdx, matchIsOutput: true });
      }
    }

    if (compatible.length === 0) return;

    // Position the menu at the cursor
    const menuW = 240, menuH = 360;
    let left = info.screenX;
    let top = info.screenY;
    if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
    if (top + menuH > window.innerHeight) top = window.innerHeight - menuH - 8;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    dropMenu.style.left = left + 'px';
    dropMenu.style.top = top + 'px';

    dropMenuSearch.value = '';
    buildDropMenuList(compatible, categories, '');

    dropMenu.classList.remove('hidden');
    dropMenuOverlay.classList.remove('hidden');
    setTimeout(() => dropMenuSearch.focus(), 50);

    // Live search
    dropMenuSearch.oninput = () => {
      buildDropMenuList(compatible, categories, dropMenuSearch.value);
    };
  }

  function buildDropMenuList(compatible, categories, filter) {
    dropMenuItems.innerHTML = '';
    const lf = filter.toLowerCase();

    const grouped = {};
    for (const item of compatible) {
      if (lf && !item.def.label.toLowerCase().includes(lf)) continue;
      const cat = item.def.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    }

    for (const [catId, items] of Object.entries(grouped)) {
      const catDef = categories[catId];
      if (!catDef) continue;

      const catEl = document.createElement('div');
      catEl.className = 'drop-menu-cat';
      catEl.textContent = catDef.name;
      dropMenuItems.appendChild(catEl);

      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'drop-menu-item';
        el.innerHTML = `<div class="dmi-icon" style="background:${catDef.color}">${catDef.icon}</div>${item.def.label}`;
        el.addEventListener('click', () => {
          selectDropMenuItem(item);
        });
        dropMenuItems.appendChild(el);
      }
    }
  }

  function selectDropMenuItem(item) {
    if (!pendingDrop) return;
    const info = pendingDrop;

    // Create node at the drop world position
    const x = info.worldX - renderer.nodeWidth / 2;
    const y = info.worldY - 30;
    const node = activeGraph.addNode(item.typeId, x, y);
    if (node) {
      // Auto-connect
      if (info.isOutput) {
        // Source was an output socket, connect to the new node's matching input
        activeGraph.addConnection(info.fromNode, info.fromSocket, node.id, item.matchIdx);
      } else {
        // Source was an input socket, connect from the new node's matching output
        activeGraph.addConnection(node.id, item.matchIdx, info.fromNode, info.fromSocket);
      }

      renderer.selectedNode = node.id;
      statusText.textContent = `Added & connected ${item.def.label}`;
      saveGraph();
      autoRun();
    }

    closeDropMenu();
  }

  function closeDropMenu() {
    dropMenu.classList.add('hidden');
    dropMenuOverlay.classList.add('hidden');
    pendingDrop = null;
    dropMenuSearch.oninput = null;
  }

  // ===== Properties Panel =====
  function openProperties(node) {
    if (!node) return;
    currentPropsNode = node;
    const def = activeGraph.getNodeDef(node);
    if (!def) return;

    propsTitle.textContent = def.label;
    propsContent.innerHTML = '';

    // Support dynamic props (e.g., Random Value shows different fields per data_type)
    const baseDef = registry.getNodeDef(activeGraphType, node.type);
    const effectiveProps = baseDef?.getProps ? baseDef.getProps(node.values) : def.props;

    if (!effectiveProps || effectiveProps.length === 0) {
      propsContent.innerHTML = '<p style="color:var(--text-dim);font-size:13px;padding:8px 0;">No editable properties</p>';
    } else {
      // Detect XYZ triplets for uniform link toggle
      const xyzGroups = new Set();
      const xyzGroupMap = {};
      for (let i = 0; i < effectiveProps.length - 2; i++) {
        const p = effectiveProps[i], q = effectiveProps[i+1], r = effectiveProps[i+2];
        if ((p.type === 'float' || p.type === 'int') && p.type === q.type && q.type === r.type) {
          const lp = p.label, lq = q.label, lr = r.label;
          if (lp.endsWith('X') && lq.endsWith('Y') && lr.endsWith('Z') &&
              lp.slice(0, -1).trim() === lq.slice(0, -1).trim() &&
              lq.slice(0, -1).trim() === lr.slice(0, -1).trim()) {
            const groupKey = lp.slice(0, -1).trim() || 'XYZ';
            xyzGroups.add(i);
            xyzGroupMap[i] = { keys: [p.key, q.key, r.key], label: groupKey, props: [p, q, r] };
          }
        }
      }

      const rendered = new Set();
      for (let pi = 0; pi < effectiveProps.length; pi++) {
        if (rendered.has(pi)) continue;
        const prop = effectiveProps[pi];

        // XYZ group rendering
        if (xyzGroups.has(pi)) {
          const grp = xyzGroupMap[pi];
          rendered.add(pi); rendered.add(pi+1); rendered.add(pi+2);

          const group = document.createElement('div');
          group.className = 'prop-group';

          const headerRow = document.createElement('div');
          headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';

          const label = document.createElement('div');
          label.className = 'prop-label';
          label.style.margin = '0';
          label.textContent = grp.label;
          headerRow.appendChild(label);

          const linkBtn = document.createElement('button');
          const linkKey = `_link_${grp.keys[0]}`;
          let linked = !!node.values[linkKey];
          linkBtn.className = 'prop-link-btn';
          linkBtn.textContent = linked ? '\u{1F517}' : '\u{26D3}\uFE0F';
          linkBtn.title = linked ? 'Uniform (linked)' : 'Independent';
          linkBtn.style.cssText = `background:none;border:1px solid var(--border);border-radius:4px;
            cursor:pointer;font-size:14px;padding:2px 6px;opacity:${linked ? '1' : '0.5'};`;
          linkBtn.addEventListener('click', () => {
            linked = !linked;
            activeGraph.setNodeValue(node.id, linkKey, linked);
            linkBtn.textContent = linked ? '\u{1F517}' : '\u{26D3}\uFE0F';
            linkBtn.title = linked ? 'Uniform (linked)' : 'Independent';
            linkBtn.style.opacity = linked ? '1' : '0.5';
            if (linked) {
              // Set Y and Z to match X
              const xVal = node.values[grp.keys[0]];
              activeGraph.setNodeValue(node.id, grp.keys[1], xVal);
              activeGraph.setNodeValue(node.id, grp.keys[2], xVal);
              openProperties(node); // Refresh UI
              saveGraph();
              autoRun();
            }
          });
          headerRow.appendChild(linkBtn);
          group.appendChild(headerRow);

          // Create value bars for each axis
          const axisBars = [];
          grp.props.forEach((ap, ai) => {
            const axisLabel = ['X', 'Y', 'Z'][ai];
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:4px;';

            const axTag = document.createElement('span');
            axTag.textContent = axisLabel;
            axTag.style.cssText = `font-size:11px;font-weight:600;color:${['#e06060','#60c060','#6080e0'][ai]};width:14px;text-align:center;flex-shrink:0;`;
            row.appendChild(axTag);

            const bar = createValueBar(node, ap, (v) => {
              if (node.values[linkKey]) {
                grp.keys.forEach((k, ki) => {
                  activeGraph.setNodeValue(node.id, k, v);
                  if (ki !== ai && axisBars[ki]) axisBars[ki]._updateDisplay();
                });
              }
            });
            bar.style.flex = '1';
            axisBars.push(bar);

            row.appendChild(bar);
            group.appendChild(row);
          });

          propsContent.appendChild(group);
          continue;
        }

        // Normal single prop rendering
        const group = document.createElement('div');
        group.className = 'prop-group';

        const label = document.createElement('div');
        label.className = 'prop-label';
        label.textContent = prop.label;
        group.appendChild(label);

        switch (prop.type) {
          case 'float':
          case 'int': {
            // Blender-style value bar: scrub to change, tap to type
            group.appendChild(createValueBar(node, prop));
            break;
          }

          case 'bool': {
            const wrap = document.createElement('div');
            wrap.className = 'prop-checkbox-wrap';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'prop-checkbox';
            cb.checked = !!node.values[prop.key];

            const cbLabel = document.createElement('span');
            cbLabel.textContent = cb.checked ? 'On' : 'Off';
            cbLabel.style.fontSize = '13px';

            cb.addEventListener('change', () => {
              activeGraph.setNodeValue(node.id, prop.key, cb.checked);
              cbLabel.textContent = cb.checked ? 'On' : 'Off';
              saveGraph();
              autoRun();
            });

            wrap.appendChild(cb);
            wrap.appendChild(cbLabel);
            group.appendChild(wrap);
            break;
          }

          case 'select': {
            const select = document.createElement('select');
            select.className = 'prop-select';
            for (const opt of (prop.options || [])) {
              const option = document.createElement('option');
              // Support both plain strings and {value, label} objects
              const val = typeof opt === 'string' ? opt : opt.value;
              const lbl = typeof opt === 'string' ? opt : (opt.label || opt.value);
              option.value = val;
              option.textContent = lbl;
              if (node.values[prop.key] === val) option.selected = true;
              select.appendChild(option);
            }
            select.addEventListener('change', () => {
              activeGraph.setNodeValue(node.id, prop.key, select.value);
              // Clean up connections that reference sockets that no longer exist
              // (e.g., when Random Value switches data_type)
              const newDef = activeGraph.getNodeDef(node);
              if (newDef) {
                activeGraph.connections = activeGraph.connections.filter(c => {
                  if (c.fromNode === node.id && c.fromSocket >= newDef.outputs.length) return false;
                  if (c.toNode === node.id && c.toSocket >= newDef.inputs.length) return false;
                  return true;
                });
              }
              // Refresh properties panel when mode/type selector changes
              openProperties(node);
              saveGraph();
              autoRun();
            });
            group.appendChild(select);
            break;
          }
        }

        propsContent.appendChild(group);
      }
    }

    // Connections info
    const connInfo = document.createElement('div');
    connInfo.style.cssText = 'margin-top:16px;padding-top:12px;border-top:1px solid var(--border);';
    const conns = activeGraph.connections.filter(c => c.fromNode === node.id || c.toNode === node.id);
    connInfo.innerHTML = `<div class="prop-label">Connections: ${conns.length}</div>
      <div style="font-size:12px;color:var(--text-dim);">Node ID: ${node.id}</div>`;
    propsContent.appendChild(connInfo);

    propsPanel.classList.remove('hidden');
    propsPanel.classList.add('visible');
    propsOverlay.classList.remove('hidden');
    propsOverlay.classList.add('visible');
  }

  function closeProperties() {
    propsPanel.classList.remove('visible');
    propsOverlay.classList.remove('visible');
    setTimeout(() => {
      propsPanel.classList.add('hidden');
      propsOverlay.classList.add('hidden');
    }, 250);
    currentPropsNode = null;
  }

  function formatNum(v, type) {
    if (type === 'int') return Math.round(v).toString();
    return parseFloat(v).toFixed(2);
  }

  /**
   * Create a Blender-style value bar for the properties panel.
   * Supports: drag/scrub to change, tap to type a value.
   *
   * @param {Object} node - The node being edited
   * @param {Object} prop - The property definition { key, type, min, max, step, label }
   * @param {Function} [onChange] - Optional callback after value changes (for linked XYZ)
   * @returns {HTMLElement} The value bar container
   */
  function createValueBar(node, prop, onChange) {
    const bar = document.createElement('div');
    bar.className = 'value-bar';

    const fill = document.createElement('div');
    fill.className = 'value-bar-fill';

    const labelEl = document.createElement('span');
    labelEl.className = 'value-bar-label';
    labelEl.textContent = prop.label;

    const valEl = document.createElement('span');
    valEl.className = 'value-bar-value';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'value-bar-input hidden';
    input.inputMode = 'decimal';
    input.step = prop.step ?? (prop.type === 'int' ? 1 : 0.1);
    if (prop.min != null) input.min = prop.min;
    if (prop.max != null) input.max = prop.max;

    bar.appendChild(fill);
    bar.appendChild(labelEl);
    bar.appendChild(valEl);
    bar.appendChild(input);

    const min = prop.min ?? 0;
    const max = prop.max ?? 1;
    const range = max - min;

    function updateDisplay() {
      const v = node.values[prop.key] ?? 0;
      valEl.textContent = formatNum(v, prop.type);
      const frac = range > 0 ? Math.max(0, Math.min(1, (v - min) / range)) : 0;
      fill.style.width = (frac * 100) + '%';
    }
    updateDisplay();

    // Scrub handling
    let scrubStartX = 0, scrubStartVal = 0, scrubMoved = false;
    const step = prop.step ?? (prop.type === 'int' ? 1 : 0.1);

    function onPointerDown(e) {
      if (input.classList.contains('editing')) return;
      e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      scrubStartX = clientX;
      scrubStartVal = node.values[prop.key] ?? 0;
      scrubMoved = false;
      bar.classList.add('scrubbing');

      function onPointerMove(e2) {
        const cx = e2.touches ? e2.touches[0].clientX : e2.clientX;
        if (Math.abs(cx - scrubStartX) > 3) scrubMoved = true;
        if (!scrubMoved) return;
        const delta = (cx - scrubStartX) * step * 0.5;
        let v = scrubStartVal + delta;
        v = Math.max(min, Math.min(max, v));
        if (prop.type === 'int') v = Math.round(v);
        else v = Math.round(v * 1000) / 1000;
        activeGraph.setNodeValue(node.id, prop.key, v);
        updateDisplay();
        if (onChange) onChange(v);
      }

      function onPointerUp() {
        bar.classList.remove('scrubbing');
        document.removeEventListener('mousemove', onPointerMove);
        document.removeEventListener('mouseup', onPointerUp);
        document.removeEventListener('touchmove', onPointerMove);
        document.removeEventListener('touchend', onPointerUp);
        document.removeEventListener('touchcancel', onPointerUp);
        if (!scrubMoved) {
          // Tap → show input
          labelEl.style.display = 'none';
          valEl.style.display = 'none';
          input.classList.remove('hidden');
          input.classList.add('editing');
          input.value = node.values[prop.key] ?? 0;
          input.focus();
          input.select();
        } else {
          saveGraph();
          autoRun();
        }
      }

      document.addEventListener('mousemove', onPointerMove);
      document.addEventListener('mouseup', onPointerUp);
      document.addEventListener('touchmove', onPointerMove, { passive: false });
      document.addEventListener('touchend', onPointerUp);
      document.addEventListener('touchcancel', onPointerUp);
    }

    bar.addEventListener('mousedown', onPointerDown);
    bar.addEventListener('touchstart', onPointerDown, { passive: false });

    function commitInput() {
      let v = prop.type === 'int' ? parseInt(input.value) : parseFloat(input.value);
      if (isNaN(v)) v = 0;
      v = Math.max(min, Math.min(max, v));
      activeGraph.setNodeValue(node.id, prop.key, v);
      input.classList.add('hidden');
      input.classList.remove('editing');
      labelEl.style.display = '';
      valEl.style.display = '';
      updateDisplay();
      if (onChange) onChange(v);
      saveGraph();
      autoRun();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitInput(); }
      if (e.key === 'Escape') {
        input.classList.add('hidden');
        input.classList.remove('editing');
        labelEl.style.display = '';
        valEl.style.display = '';
      }
    });
    input.addEventListener('blur', () => {
      if (input.classList.contains('editing')) commitInput();
    });

    bar._updateDisplay = updateDisplay;
    return bar;
  }

  // ===== 3D Viewport (Geo) =====
  function toggleViewport() {
    if (activeGraphType === 'shader') {
      toggleShaderPreview();
      return;
    }
    viewportVisible = !viewportVisible;
    if (viewportVisible) {
      viewport3d.classList.remove('hidden');
      viewport.start();
      viewport.resize();
      runGraph();
    } else {
      viewport3d.classList.add('hidden');
      viewport.stop();
    }
    setTimeout(() => renderer._resize(), 50);
  }

  function toggleShaderPreview() {
    shaderPreviewVisible = !shaderPreviewVisible;
    if (shaderPreviewVisible) {
      shaderPreviewEl.classList.remove('hidden');
      if (shaderPreview) {
        shaderPreview.start();
        shaderPreview.resize();
      }
      runGraph();
    } else {
      shaderPreviewEl.classList.add('hidden');
      if (shaderPreview) shaderPreview.stop();
    }
    setTimeout(() => renderer._resize(), 50);
  }

  function runGraph() {
    const app = document.getElementById('app');
    app.classList.add('running');

    const result = activeGraph.evaluate();

    if (result.error) {
      statusText.textContent = 'Error: ' + result.error;
    } else {
      statusText.textContent = `Evaluated (${result.evalTime || '?'}ms)`;
    }

    if (activeGraphType === 'geo') {
      // Show geo viewport
      if (!viewportVisible) {
        viewportVisible = true;
        viewport3d.classList.remove('hidden');
        viewport.start();
        viewport.resize();
        setTimeout(() => renderer._resize(), 50);
      }

      const stats = viewport.updateGeometry(result.geometries);
      viewportInfo.textContent = `Verts: ${stats.verts} | Faces: ${stats.faces}`;
    } else if (activeGraphType === 'shader') {
      // Show shader preview
      if (!shaderPreviewVisible) {
        shaderPreviewVisible = true;
        shaderPreviewEl.classList.remove('hidden');
        if (shaderPreview) {
          shaderPreview.start();
          shaderPreview.resize();
        }
        setTimeout(() => renderer._resize(), 50);
      }

      if (result.shaderResult && shaderPreview) {
        try {
          const compiled = compileShader(result.shaderResult);
          shaderPreview.updateShader(compiled);

          // Also evaluate the geo graph and use its output as the preview mesh
          const geoResult = geoGraph.evaluate();
          if (geoResult.geometries && geoResult.geometries.length > 0) {
            shaderPreview.setExternalGeometry(geoResult.geometries);
            shaderPreviewInfo.textContent = 'Shader on geo output';
          } else {
            shaderPreview.setExternalGeometry(null);
            shaderPreviewInfo.textContent = 'Shader compiled (no geo)';
          }
        } catch (e) {
          shaderPreviewInfo.textContent = 'Compile error: ' + e.message;
        }
      }
    }

    saveGraph();
    setTimeout(() => app.classList.remove('running'), 500);
  }

  // ===== Auto-update: debounced runGraph on any change =====
  let _autoRunTimer = null;
  function autoRun() {
    if (_autoRunTimer) clearTimeout(_autoRunTimer);
    _autoRunTimer = setTimeout(() => {
      _autoRunTimer = null;
      if (viewportVisible || shaderPreviewVisible) {
        runGraph();
      }
    }, 100);
  }

  // ===== Renderer callbacks =====
  function clearGraph() {
    if (!confirm('Clear all nodes? This cannot be undone.')) return;
    activeGraph.clear(true);
    renderer.selectedNode = null;
    closeProperties();
    statusText.textContent = 'Graph cleared';
    saveGraph();
    renderer.zoomToFit();
  }

  function setupRendererCallbacks() {
    renderer.onNodeSelected = (node) => {
      if (!node) return;
    };

    renderer.onNodeDoubleTap = (node) => {
      openProperties(node);
    };

    renderer.onConnectionMade = () => {
      statusText.textContent = 'Connected';
      saveGraph();
      autoRun();
    };

    renderer.onConnectionDropped = (info) => {
      openDropMenu(info);
    };

    renderer.onNodeValueChanged = () => {
      saveGraph();
      autoRun();
    };

    renderer.onEmptyDoubleTap = (info) => {
      // Open the add-node drop menu at the cursor position
      openAddMenuAt(info);
    };

    // Inline value edit: tap on a value field without dragging
    const inlineEdit = document.getElementById('inline-edit');
    const inlineInput = document.getElementById('inline-edit-input');
    let inlineEditNode = null;
    let inlineEditProp = null;

    renderer.onValueFieldTap = (node, prop, screenRect) => {
      inlineEditNode = node;
      inlineEditProp = prop;

      // Position the overlay over the value field
      const canvasRect = graphCanvas.getBoundingClientRect();
      inlineEdit.style.left = (canvasRect.left + screenRect.x) + 'px';
      inlineEdit.style.top = (canvasRect.top + screenRect.y) + 'px';
      inlineEdit.style.width = screenRect.w + 'px';
      inlineEdit.style.height = screenRect.h + 'px';
      inlineEdit.classList.remove('hidden');

      inlineInput.value = node.values[prop.key] ?? 0;
      inlineInput.step = prop.step ?? (prop.type === 'int' ? 1 : 0.1);
      if (prop.min != null) inlineInput.min = prop.min;
      if (prop.max != null) inlineInput.max = prop.max;
      inlineInput.focus();
      inlineInput.select();
    };

    function commitInlineEdit() {
      if (!inlineEditNode || !inlineEditProp) return;
      let v = inlineEditProp.type === 'int'
        ? parseInt(inlineInput.value)
        : parseFloat(inlineInput.value);
      if (isNaN(v)) v = 0;
      activeGraph.setNodeValue(inlineEditNode.id, inlineEditProp.key, v);
      inlineEdit.classList.add('hidden');
      inlineEditNode = null;
      inlineEditProp = null;
      saveGraph();
      autoRun();
    }

    inlineInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitInlineEdit();
      } else if (e.key === 'Escape') {
        inlineEdit.classList.add('hidden');
        inlineEditNode = null;
        inlineEditProp = null;
      }
    });
    inlineInput.addEventListener('blur', () => {
      if (inlineEditNode) commitInlineEdit();
    });
  }

  /** Open add-node menu at a specific screen/world position (for double-click on empty space). */
  function openAddMenuAt(info) {
    // Reuse the drop menu UI but show ALL nodes (not filtered by socket type)
    pendingDrop = null; // no auto-connect
    const nodeTypes = registry.getNodeTypes(activeGraphType);
    const categories = registry.getCategories(activeGraphType);
    const outputTypeId = activeGraphType === 'shader' ? 'shader_output' : 'output';

    const allItems = [];
    for (const [typeId, def] of Object.entries(nodeTypes)) {
      if (typeId === outputTypeId) continue;
      allItems.push({ typeId, def });
    }

    if (allItems.length === 0) return;

    const menuW = 240, menuH = 360;
    let left = info.screenX;
    let top = info.screenY;
    if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
    if (top + menuH > window.innerHeight) top = window.innerHeight - menuH - 8;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    dropMenu.style.left = left + 'px';
    dropMenu.style.top = top + 'px';

    dropMenuSearch.value = '';

    const buildList = (filter) => {
      dropMenuItems.innerHTML = '';
      const lf = filter.toLowerCase();
      const grouped = {};
      for (const item of allItems) {
        if (lf && !item.def.label.toLowerCase().includes(lf)) continue;
        const cat = item.def.category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
      }
      for (const [catId, items] of Object.entries(grouped)) {
        const catDef = categories[catId];
        if (!catDef) continue;
        const catEl = document.createElement('div');
        catEl.className = 'drop-menu-cat';
        catEl.textContent = catDef.name;
        dropMenuItems.appendChild(catEl);
        for (const item of items) {
          const el = document.createElement('div');
          el.className = 'drop-menu-item';
          el.innerHTML = `<div class="dmi-icon" style="background:${catDef.color}">${catDef.icon}</div>${item.def.label}`;
          el.addEventListener('click', () => {
            const x = info.worldX - renderer.nodeWidth / 2;
            const y = info.worldY - 30;
            const node = activeGraph.addNode(item.typeId, x, y);
            if (node) {
              renderer.selectedNode = node.id;
              statusText.textContent = `Added ${item.def.label}`;
              saveGraph();
              autoRun();
            }
            closeDropMenu();
          });
          dropMenuItems.appendChild(el);
        }
      }
    };

    buildList('');
    dropMenu.classList.remove('hidden');
    dropMenuOverlay.classList.remove('hidden');
    setTimeout(() => dropMenuSearch.focus(), 50);
    dropMenuSearch.oninput = () => buildList(dropMenuSearch.value);
  }

  // ===== Event Bindings =====
  btnMenu.addEventListener('click', openMenu);
  btnAddNode.addEventListener('click', openMenu);
  btnCloseMenu.addEventListener('click', closeMenu);
  menuOverlay.addEventListener('click', closeMenu);

  document.getElementById('btn-clear-graph').addEventListener('click', () => {
    closeMenu();
    clearGraph();
  });

  nodeSearch.addEventListener('input', () => {
    buildNodeList(nodeSearch.value);
  });

  dropMenuOverlay.addEventListener('click', closeDropMenu);

  btnCloseProps.addEventListener('click', closeProperties);
  propsOverlay.addEventListener('click', closeProperties);

  btnDeleteNode.addEventListener('click', () => {
    if (currentPropsNode) {
      const def = activeGraph.getNodeDef(currentPropsNode);
      if (def?.singular) {
        statusText.textContent = 'Cannot delete output node';
        return;
      }
      activeGraph.removeNode(currentPropsNode.id);
      renderer.selectedNode = null;
      closeProperties();
      statusText.textContent = 'Node deleted';
      saveGraph();
      autoRun();
    }
  });

  btnRun.addEventListener('click', runGraph);
  btnToggleView.addEventListener('click', toggleViewport);
  btnZoomFit.addEventListener('click', () => renderer.zoomToFit());

  btnUndo.addEventListener('click', () => {
    if (activeGraph.undo()) {
      renderer.selectedNode = null;
      statusText.textContent = 'Undo';
      saveGraph();
      autoRun();
    } else {
      statusText.textContent = 'Nothing to undo';
    }
  });

  btnResetCam.addEventListener('click', () => viewport.resetCamera());
  btnWireframe.addEventListener('click', () => {
    const wf = viewport.toggleWireframe();
    statusText.textContent = wf ? 'Wireframe on' : 'Wireframe off';
  });

  if (btnShaderShape) {
    btnShaderShape.addEventListener('click', () => {
      if (shaderPreview) {
        const shape = shaderPreview.toggleShape();
        statusText.textContent = `Preview: ${shape}`;
      }
    });
  }

  // Tab switching
  graphTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Allow Escape to close drop menu even from search input
    if (e.key === 'Escape' && pendingDrop) {
      closeDropMenu();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.key) {
      case 'a':
      case 'A':
        openMenu();
        break;
      case 'Delete':
      case 'Backspace':
        if (renderer.selectedNode) {
          const node = activeGraph.nodes.find(n => n.id === renderer.selectedNode);
          if (node) {
            const def = activeGraph.getNodeDef(node);
            if (!def?.singular) {
              activeGraph.removeNode(node.id);
              renderer.selectedNode = null;
              statusText.textContent = 'Node deleted';
              saveGraph();
              autoRun();
            }
          }
        }
        break;
      case 'f':
      case 'F':
        renderer.zoomToFit();
        break;
      case 'z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (activeGraph.undo()) {
            renderer.selectedNode = null;
            statusText.textContent = 'Undo';
            saveGraph();
            autoRun();
          }
        }
        break;
      case ' ':
        e.preventDefault();
        runGraph();
        break;
      case 'x':
      case 'X':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          clearGraph();
        }
        break;
      case '1':
        switchTab('geo');
        break;
      case '2':
        switchTab('shader');
        break;
    }
  });

  // ===== Init =====
  setupRendererCallbacks();

  // Load saved tab preference
  const savedTab = localStorage.getItem('geonodes_active_tab');

  // Initialize both graphs
  initDefaultScene(geoGraph);
  initDefaultScene(shaderGraph);

  // Switch to saved tab if needed
  if (savedTab === 'shader') {
    switchTab('shader');
  }

  renderer.zoomToFit();

  // Auto-save periodically
  setInterval(saveGraph, 10000);

  // Expose for debugging
  window._geoNodes = { geoGraph, shaderGraph, renderer, viewport, shaderPreview, registry };
})();
