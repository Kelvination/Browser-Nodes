/**
 * geo/nodes_v2_curves.js - Curve operation nodes (resample, sample, curve to mesh).
 */

import { SocketType } from '../core/registry.js';
import { GeometrySet, MeshComponent, CurveComponent, DOMAIN } from '../core/geometry.js';
import { Field, isField, resolveField, resolveScalar } from '../core/field.js';
import {
  vecCross as cross,
  vecNormalize as normalize,
  vecSub,
  vecAdd,
  vecScale,
} from '../core/utils.js';

// ── Frenet Frame ────────────────────────────────────────────────────────────

function computeFrenetFrame(tangent, prevNormal) {
  // tangent is normalized
  // Compute normal perpendicular to tangent
  let normal;
  if (prevNormal) {
    // Parallel transport: project previous normal onto plane perpendicular to new tangent
    const dot = prevNormal.x * tangent.x + prevNormal.y * tangent.y + prevNormal.z * tangent.z;
    normal = {
      x: prevNormal.x - dot * tangent.x,
      y: prevNormal.y - dot * tangent.y,
      z: prevNormal.z - dot * tangent.z,
    };
  } else {
    // Initial normal: cross tangent with up, or right if tangent is up
    const up = Math.abs(tangent.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    normal = cross(tangent, up);
  }
  const len = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2) || 1;
  normal.x /= len; normal.y /= len; normal.z /= len;
  const binormal = cross(tangent, normal);
  return { normal, binormal };
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerCurveNodes(registry) {
  // ── Category ────────────────────────────────────────────────────────────
  registry.addCategory('geo', 'CURVE', { name: 'Curve', color: '#FFC107', icon: '〰' });

  // ═══════════════════════════════════════════════════════════════════════════
  // SET CURVE RADIUS
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Blender reference: node_geo_set_curve_radius.cc
  //
  // Sets the radius attribute on curve control points. The radius is used by
  // Curve to Mesh to scale the profile at each point, and by other nodes
  // that read the radius attribute.
  //
  // Inputs:
  //   Curve     - source geometry with curve component
  //   Selection - bool field on CURVE_POINT domain (which points to modify)
  //   Radius    - float field (new radius value)
  //
  // Output:
  //   Curve     - modified geometry

  registry.addNode('geo', 'set_curve_radius', {
    label: 'Set Curve Radius',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Radius', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { radius: 0.005 },
    props: [
      { key: 'radius', label: 'Radius', type: 'float', min: 0, max: 100, step: 0.001 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [geo || new GeometrySet()] };
      }

      const result = geo.copy();
      const curve = result.curve;
      const elements = curve.buildElements(DOMAIN.CURVE_POINT);

      // Evaluate selection
      const selectionInput = inputs['Selection'];
      let selection = null;
      if (selectionInput != null) {
        selection = isField(selectionInput)
          ? selectionInput.evaluateAll(elements)
          : new Array(elements.length).fill(!!selectionInput);
      }

      // Evaluate radius field
      const radiusInput = inputs['Radius'] ?? values.radius;
      const radii = isField(radiusInput)
        ? radiusInput.evaluateAll(elements)
        : new Array(elements.length).fill(
            typeof radiusInput === 'number' ? radiusInput : values.radius
          );

      // Apply radius to each control point
      let globalIdx = 0;
      for (const spline of curve.splines) {
        if (!spline.radii) {
          spline.radii = new Array(spline.positions.length).fill(1);
        }
        for (let i = 0; i < spline.positions.length; i++) {
          if (selection && !selection[globalIdx]) {
            globalIdx++;
            continue;
          }
          spline.radii[i] = radii[globalIdx] ?? values.radius;
          globalIdx++;
        }
      }

      return { outputs: [result] };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SET CURVE TILT
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Blender reference: node_geo_set_curve_tilt.cc
  //
  // Sets the tilt attribute on curve control points. Tilt rotates the curve's
  // normal around the tangent, affecting how profiles are oriented when using
  // Curve to Mesh or when computing the Frenet frame.
  //
  // Inputs:
  //   Curve     - source geometry with curve component
  //   Selection - bool field on CURVE_POINT domain (which points to modify)
  //   Tilt      - float field (tilt angle in radians)
  //
  // Output:
  //   Curve     - modified geometry

  registry.addNode('geo', 'set_curve_tilt', {
    label: 'Set Curve Tilt',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Tilt', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { tilt: 0 },
    props: [
      { key: 'tilt', label: 'Tilt', type: 'float', min: -6.28318, max: 6.28318, step: 0.01745 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [geo || new GeometrySet()] };
      }

      const result = geo.copy();
      const curve = result.curve;
      const elements = curve.buildElements(DOMAIN.CURVE_POINT);

      // Evaluate selection
      const selectionInput = inputs['Selection'];
      let selection = null;
      if (selectionInput != null) {
        selection = isField(selectionInput)
          ? selectionInput.evaluateAll(elements)
          : new Array(elements.length).fill(!!selectionInput);
      }

      // Evaluate tilt field
      const tiltInput = inputs['Tilt'] ?? values.tilt;
      const tilts = isField(tiltInput)
        ? tiltInput.evaluateAll(elements)
        : new Array(elements.length).fill(
            typeof tiltInput === 'number' ? tiltInput : values.tilt
          );

      // Apply tilt to each control point
      let globalIdx = 0;
      for (const spline of curve.splines) {
        if (!spline.tilts) {
          spline.tilts = new Array(spline.positions.length).fill(0);
        }
        for (let i = 0; i < spline.positions.length; i++) {
          if (selection && !selection[globalIdx]) {
            globalIdx++;
            continue;
          }
          spline.tilts[i] = tilts[globalIdx] ?? values.tilt;
          globalIdx++;
        }
      }

      return { outputs: [result] };
    },
  });

  // ── resample_curve ──────────────────────────────────────────────────────
  registry.addNode('geo', 'resample_curve', {
    label: 'Resample Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Count', type: SocketType.INT },
      { name: 'Length', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { mode: 'COUNT', count: 10, length: 0.1 },
    props: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['COUNT', 'LENGTH'] },
      { key: 'count', label: 'Count', type: 'int', min: 2, max: 1000, step: 1 },
      { key: 'length', label: 'Length', type: 'float', min: 0.001, max: 100, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'] ?? null;
      if (!geo || !geo.curve) {
        return { outputs: [geo || new GeometrySet()] };
      }

      const mode = values.mode;
      const count = resolveScalar(inputs['Count'] ?? values.count, values.count);
      const desiredLength = resolveScalar(inputs['Length'] ?? values.length, values.length);

      const result = geo.copy();
      const curve = result.curve;

      for (let si = 0; si < curve.splines.length; si++) {
        const spline = curve.splines[si];
        let resampleCount;

        if (mode === 'COUNT') {
          resampleCount = Math.max(2, Math.round(count));
        } else {
          // LENGTH mode: compute spline length, divide by desired length
          const splineLen = curve.splineLength(si, 64);
          resampleCount = Math.max(2, Math.round(splineLen / Math.max(0.001, desiredLength)) + 1);
        }

        // Resample positions
        const newPositions = curve.resampleSpline(si, resampleCount);

        // Build new radii array by interpolating
        const newRadii = new Array(resampleCount);
        const newTilts = new Array(resampleCount);
        for (let i = 0; i < resampleCount; i++) {
          const t = i / (resampleCount - 1);
          newRadii[i] = curve.evaluateSplineRadius(si, t);
          // Interpolate tilts similarly
          if (spline.tilts && spline.tilts.length > 1) {
            const f = t * (spline.tilts.length - 1);
            const idx = Math.min(Math.floor(f), spline.tilts.length - 2);
            const frac = f - idx;
            newTilts[i] = spline.tilts[idx] + (spline.tilts[idx + 1] - spline.tilts[idx]) * frac;
          } else {
            newTilts[i] = spline.tilts ? (spline.tilts[0] || 0) : 0;
          }
        }

        // Replace spline data
        spline.positions = newPositions;
        spline.radii = newRadii;
        spline.tilts = newTilts;
        spline.type = 'POLY'; // Resampled curves become polylines
        spline.handleLeft = null;
        spline.handleRight = null;
      }

      return { outputs: [result] };
    },
  });

  // ── sample_curve ────────────────────────────────────────────────────────
  registry.addNode('geo', 'sample_curve', {
    label: 'Sample Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Factor', type: SocketType.FLOAT },
      { name: 'Length', type: SocketType.FLOAT },
      { name: 'Curve Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Position', type: SocketType.VECTOR },
      { name: 'Tangent', type: SocketType.VECTOR },
      { name: 'Normal', type: SocketType.VECTOR },
      { name: 'Rotation', type: SocketType.VECTOR },
    ],
    defaults: { mode: 'FACTOR', factor: 0.5, curveIndex: 0 },
    props: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['FACTOR', 'LENGTH'] },
      { key: 'factor', label: 'Factor', type: 'float', min: 0, max: 1, step: 0.01 },
      { key: 'curveIndex', label: 'Curve Index', type: 'int', min: 0, max: 100, step: 1 },
    ],
    evaluate(values, inputs) {
      const zero = { x: 0, y: 0, z: 0 };
      const geo = inputs['Curve'] ?? null;
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [zero, zero, zero, zero] };
      }

      const curve = geo.curve;
      const splineIdx = Math.min(
        resolveScalar(inputs['Curve Index'] ?? values.curveIndex, 0),
        curve.splineCount - 1
      );
      let t;

      if (values.mode === 'FACTOR') {
        const factor = resolveScalar(inputs['Factor'] ?? values.factor, values.factor);
        t = Math.max(0, Math.min(1, factor));
      } else {
        const desiredLen = resolveScalar(inputs['Length'] ?? 0, 0);
        const totalLen = curve.splineLength(splineIdx, 64);
        t = totalLen > 0 ? Math.max(0, Math.min(1, desiredLen / totalLen)) : 0;
      }

      const position = curve.evaluateSpline(splineIdx, t);
      const tangent = curve.evaluateSplineTangent(splineIdx, t);

      // Compute Frenet frame
      const { normal, binormal } = computeFrenetFrame(tangent, null);

      // Rotation: Euler XYZ from rotation matrix [normal, binormal, tangent]
      const rotation = _matToEulerXYZ(normal, binormal, tangent);

      return { outputs: [position, tangent, normal, rotation] };
    },
  });

  // ── curve_to_mesh ───────────────────────────────────────────────────────
  registry.addNode('geo', 'curve_to_mesh', {
    label: 'Curve to Mesh',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Profile Curve', type: SocketType.GEOMETRY },
      { name: 'Fill Caps', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { fillCaps: false },
    props: [
      { key: 'fillCaps', label: 'Fill Caps', type: 'bool' },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'] ?? null;
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [new GeometrySet()] };
      }

      const fillCaps = inputs['Fill Caps'] ?? values.fillCaps;
      const profileGeo = inputs['Profile Curve'] ?? null;
      const curve = geo.curve;

      // Get profile points
      let profilePoints = null;
      let profileCyclic = false;
      if (profileGeo && profileGeo.curve && profileGeo.curve.splineCount > 0) {
        const profileSpline = profileGeo.curve.splines[0];
        profilePoints = profileSpline.positions;
        profileCyclic = profileSpline.cyclic || false;
      }

      const mesh = new MeshComponent();
      const hasProfile = profilePoints && profilePoints.length > 1;

      for (let si = 0; si < curve.splines.length; si++) {
        const spline = curve.splines[si];
        const resolution = spline.resolution || 12;
        const sampleCount = Math.max(2, spline.positions.length * resolution);

        if (!hasProfile) {
          // No profile: create a polyline mesh (vertices + edges, no faces)
          const vertOffset = mesh.positions.length;
          for (let i = 0; i < sampleCount; i++) {
            const t = i / (sampleCount - 1);
            const pos = curve.evaluateSpline(si, t);
            mesh.positions.push(pos);
          }
          for (let i = 0; i < sampleCount - 1; i++) {
            mesh.edges.push([vertOffset + i, vertOffset + i + 1]);
          }
          if (spline.cyclic && sampleCount > 2) {
            mesh.edges.push([vertOffset + sampleCount - 1, vertOffset]);
          }
        } else {
          // Sweep profile along curve
          const vertOffset = mesh.positions.length;
          const profileCount = profilePoints.length;
          let prevNormal = null;

          // Build frames and place profile at each sample
          for (let i = 0; i < sampleCount; i++) {
            const t = i / (sampleCount - 1);
            const pos = curve.evaluateSpline(si, t);
            const tang = normalize(curve.evaluateSplineTangent(si, t));
            const radius = curve.evaluateSplineRadius(si, t);

            const frame = computeFrenetFrame(tang, prevNormal);
            prevNormal = frame.normal;

            // Place profile points at this position, oriented by the frame
            for (let j = 0; j < profileCount; j++) {
              const pp = profilePoints[j];
              // Transform profile point by frame: pos + pp.x * normal + pp.y * binormal + pp.z * tangent
              mesh.positions.push({
                x: pos.x + (pp.x * frame.normal.x + pp.y * frame.binormal.x + pp.z * tang.x) * radius,
                y: pos.y + (pp.x * frame.normal.y + pp.y * frame.binormal.y + pp.z * tang.y) * radius,
                z: pos.z + (pp.x * frame.normal.z + pp.y * frame.binormal.z + pp.z * tang.z) * radius,
              });
            }
          }

          // Build quad faces connecting adjacent profile rings
          const ringCount = profileCyclic ? profileCount : profileCount - 1;
          for (let i = 0; i < sampleCount - 1; i++) {
            for (let j = 0; j < ringCount; j++) {
              const nextJ = (j + 1) % profileCount;
              const a = vertOffset + i * profileCount + j;
              const b = vertOffset + i * profileCount + nextJ;
              const c = vertOffset + (i + 1) * profileCount + nextJ;
              const d = vertOffset + (i + 1) * profileCount + j;

              mesh.faceVertCounts.push(4);
              mesh.cornerVerts.push(a, b, c, d);
              // Edges for each quad
              mesh.edges.push([a, b]);
              mesh.edges.push([a, d]);
            }
          }

          // Last ring edges
          for (let j = 0; j < ringCount; j++) {
            const nextJ = (j + 1) % profileCount;
            const a = vertOffset + (sampleCount - 1) * profileCount + j;
            const b = vertOffset + (sampleCount - 1) * profileCount + nextJ;
            mesh.edges.push([a, b]);
          }

          // Handle cyclic main curve: connect last ring to first ring
          if (spline.cyclic && sampleCount > 2) {
            for (let j = 0; j < ringCount; j++) {
              const nextJ = (j + 1) % profileCount;
              const a = vertOffset + (sampleCount - 1) * profileCount + j;
              const b = vertOffset + (sampleCount - 1) * profileCount + nextJ;
              const c = vertOffset + nextJ;
              const d = vertOffset + j;

              mesh.faceVertCounts.push(4);
              mesh.cornerVerts.push(a, b, c, d);
            }
          }

          // Fill Caps: add cap faces at start and end if profile is closed
          if (fillCaps && profileCyclic && !spline.cyclic) {
            // Start cap (reversed winding)
            mesh.faceVertCounts.push(profileCount);
            for (let j = profileCount - 1; j >= 0; j--) {
              mesh.cornerVerts.push(vertOffset + j);
            }

            // End cap
            const endOffset = vertOffset + (sampleCount - 1) * profileCount;
            mesh.faceVertCounts.push(profileCount);
            for (let j = 0; j < profileCount; j++) {
              mesh.cornerVerts.push(endOffset + j);
            }
          }
        }
      }

      const result = new GeometrySet();
      result.mesh = mesh;
      return { outputs: [result] };
    },
  });

  // ── curve_length ─────────────────────────────────────────────────────────
  // Blender ref: node_geo_curve_length.cc
  // Returns the total arc length of all splines in the curve.

  registry.addNode('geo', 'curve_length', {
    label: 'Curve Length',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    outputs: [
      { name: 'Length', type: SocketType.FLOAT },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [0] };
      }
      let total = 0;
      for (let si = 0; si < geo.curve.splineCount; si++) {
        total += geo.curve.splineLength(si, 64);
      }
      return { outputs: [total] };
    },
  });

  // ── spline_parameter ─────────────────────────────────────────────────────
  // Blender ref: node_geo_input_spline_parameter.cc
  // Outputs per-point factor (0..1) and per-point length along the spline.
  // Domain: CURVE_POINT

  registry.addNode('geo', 'spline_parameter', {
    label: 'Spline Parameter',
    category: 'CURVE',
    inputs: [],
    outputs: [
      { name: 'Factor', type: SocketType.FLOAT },
      { name: 'Length', type: SocketType.FLOAT },
      { name: 'Index', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate() {
      // Factor field: returns parameter t (0..1) for each control point
      const factorField = new Field('float', (el) => {
        return el.parameter ?? 0;
      });
      // Length field: returns cumulative length to this point (approximate)
      const lengthField = new Field('float', (el) => {
        // Approximate: parameter * total spline length
        // For exact arc-length we'd need the curve, but this is per-element
        // A proper implementation would need access to the geometry context
        return el.parameter ?? 0;
      });
      // Spline index field
      const indexField = new Field('int', (el) => {
        return el.splineIndex ?? 0;
      });
      return { outputs: [factorField, lengthField, indexField] };
    },
  });

  // ── mesh_to_curve ────────────────────────────────────────────────────────
  // Blender ref: node_geo_mesh_to_curve.cc
  // Converts mesh edges into poly curves. Each connected chain of edges
  // becomes one spline. Selection field filters which edges to convert.

  registry.addNode('geo', 'mesh_to_curve', {
    label: 'Mesh to Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Mesh'];
      if (!geo || !geo.mesh || geo.mesh.edgeCount === 0) {
        return { outputs: [new GeometrySet()] };
      }

      const mesh = geo.mesh;

      // Evaluate selection on edge domain
      const selectionInput = inputs['Selection'];
      let edgeSelection = null;
      if (selectionInput != null) {
        const elements = mesh.buildElements(DOMAIN.EDGE);
        edgeSelection = isField(selectionInput)
          ? selectionInput.evaluateAll(elements)
          : new Array(elements.length).fill(!!selectionInput);
      }

      // Build adjacency: vertex → list of (edge_idx, other_vertex)
      const adj = new Map();
      const selectedEdges = [];
      for (let ei = 0; ei < mesh.edges.length; ei++) {
        if (edgeSelection && !edgeSelection[ei]) continue;
        selectedEdges.push(ei);
        const [a, b] = mesh.edges[ei];
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push({ edge: ei, vertex: b });
        adj.get(b).push({ edge: ei, vertex: a });
      }

      // Walk edge chains to form splines
      const usedEdges = new Set();
      const curve = new CurveComponent();

      for (const startEdge of selectedEdges) {
        if (usedEdges.has(startEdge)) continue;
        const [startA, startB] = mesh.edges[startEdge];

        // Walk from startA following the chain
        const chain = [startA];
        usedEdges.add(startEdge);
        let current = startB;
        chain.push(current);

        // Continue walking forward
        let walking = true;
        while (walking) {
          walking = false;
          const neighbors = adj.get(current) || [];
          for (const nb of neighbors) {
            if (!usedEdges.has(nb.edge)) {
              usedEdges.add(nb.edge);
              current = nb.vertex;
              chain.push(current);
              walking = true;
              break;
            }
          }
        }

        // Also try walking backward from startA
        current = startA;
        walking = true;
        while (walking) {
          walking = false;
          const neighbors = adj.get(current) || [];
          for (const nb of neighbors) {
            if (!usedEdges.has(nb.edge)) {
              usedEdges.add(nb.edge);
              current = nb.vertex;
              chain.unshift(current);
              walking = true;
              break;
            }
          }
        }

        // Check if cyclic (first == last vertex)
        const cyclic = chain.length > 2 && chain[0] === chain[chain.length - 1];
        if (cyclic) chain.pop();

        // Build spline from vertex positions
        const positions = chain.map(vi => ({
          x: mesh.positions[vi].x,
          y: mesh.positions[vi].y,
          z: mesh.positions[vi].z,
        }));

        curve.splines.push({
          type: 'POLY',
          positions,
          handleLeft: null,
          handleRight: null,
          radii: new Array(positions.length).fill(1),
          tilts: new Array(positions.length).fill(0),
          cyclic,
          resolution: 12,
        });
      }

      const result = new GeometrySet();
      result.curve = curve;
      return { outputs: [result] };
    },
  });

  // ── curve_trim ───────────────────────────────────────────────────────────
  // Blender ref: node_geo_curve_trim.cc
  // Trims each spline to a sub-range defined by start/end factors or lengths.

  registry.addNode('geo', 'curve_trim', {
    label: 'Trim Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Start', type: SocketType.FLOAT },
      { name: 'End', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { mode: 'FACTOR', start: 0, end: 1 },
    props: [
      { key: 'mode', label: 'Mode', type: 'select', options: [
        { value: 'FACTOR', label: 'Factor' },
        { value: 'LENGTH', label: 'Length' },
      ]},
      { key: 'start', label: 'Start', type: 'float', min: 0, max: 10000, step: 0.01 },
      { key: 'end', label: 'End', type: 'float', min: 0, max: 10000, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [geo || new GeometrySet()] };
      }

      const mode = values.mode || 'FACTOR';
      const startVal = resolveScalar(inputs['Start'] ?? values.start, values.start);
      const endVal = resolveScalar(inputs['End'] ?? values.end, values.end);

      const result = new GeometrySet();
      const outCurve = new CurveComponent();

      for (let si = 0; si < geo.curve.splines.length; si++) {
        let tStart, tEnd;
        if (mode === 'FACTOR') {
          tStart = Math.max(0, Math.min(1, startVal));
          tEnd = Math.max(0, Math.min(1, endVal));
        } else {
          const totalLen = geo.curve.splineLength(si, 64);
          tStart = totalLen > 0 ? Math.max(0, Math.min(1, startVal / totalLen)) : 0;
          tEnd = totalLen > 0 ? Math.max(0, Math.min(1, endVal / totalLen)) : 1;
        }
        if (tStart > tEnd) { const tmp = tStart; tStart = tEnd; tEnd = tmp; }

        // Resample the trimmed range
        const sampleCount = Math.max(2, Math.round(
          (tEnd - tStart) * Math.max(geo.curve.splines[si].positions.length, 12)
        ));
        const positions = [];
        const radii = [];
        const tilts = [];
        for (let i = 0; i < sampleCount; i++) {
          const t = tStart + (i / (sampleCount - 1)) * (tEnd - tStart);
          positions.push(geo.curve.evaluateSpline(si, t));
          radii.push(geo.curve.evaluateSplineRadius(si, t));
          // Interpolate tilt
          const spline = geo.curve.splines[si];
          if (spline.tilts && spline.tilts.length > 1) {
            const f = t * (spline.tilts.length - 1);
            const idx = Math.min(Math.floor(f), spline.tilts.length - 2);
            const frac = f - idx;
            tilts.push(spline.tilts[idx] + (spline.tilts[idx + 1] - spline.tilts[idx]) * frac);
          } else {
            tilts.push(0);
          }
        }

        outCurve.splines.push({
          type: 'POLY',
          positions,
          handleLeft: null,
          handleRight: null,
          radii,
          tilts,
          cyclic: false,
          resolution: geo.curve.splines[si].resolution || 12,
        });
      }

      result.curve = outCurve;
      return { outputs: [result] };
    },
  });

  // ── set_spline_cyclic ────────────────────────────────────────────────────
  // Blender ref: node_geo_set_spline_cyclic.cc

  registry.addNode('geo', 'set_spline_cyclic', {
    label: 'Set Spline Cyclic',
    category: 'CURVE',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Cyclic', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { cyclic: false },
    props: [
      { key: 'cyclic', label: 'Cyclic', type: 'bool' },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [geo || new GeometrySet()] };
      }

      const result = geo.copy();
      const elements = result.curve.buildElements(DOMAIN.SPLINE);

      const selectionInput = inputs['Selection'];
      let selection = null;
      if (selectionInput != null) {
        selection = isField(selectionInput)
          ? selectionInput.evaluateAll(elements)
          : new Array(elements.length).fill(!!selectionInput);
      }

      const cyclicInput = inputs['Cyclic'] ?? values.cyclic;
      const cyclicVals = isField(cyclicInput)
        ? cyclicInput.evaluateAll(elements)
        : new Array(elements.length).fill(!!cyclicInput);

      for (let i = 0; i < result.curve.splines.length; i++) {
        if (selection && !selection[i]) continue;
        result.curve.splines[i].cyclic = !!cyclicVals[i];
      }

      return { outputs: [result] };
    },
  });

  // ── set_spline_resolution ────────────────────────────────────────────────
  // Blender ref: node_geo_set_spline_resolution.cc

  registry.addNode('geo', 'set_spline_resolution', {
    label: 'Set Spline Resolution',
    category: 'CURVE',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Resolution', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { resolution: 12 },
    props: [
      { key: 'resolution', label: 'Resolution', type: 'int', min: 1, max: 256, step: 1 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [geo || new GeometrySet()] };
      }

      const result = geo.copy();
      const elements = result.curve.buildElements(DOMAIN.SPLINE);

      const selectionInput = inputs['Selection'];
      let selection = null;
      if (selectionInput != null) {
        selection = isField(selectionInput)
          ? selectionInput.evaluateAll(elements)
          : new Array(elements.length).fill(!!selectionInput);
      }

      const resInput = inputs['Resolution'] ?? values.resolution;
      const resVals = isField(resInput)
        ? resInput.evaluateAll(elements)
        : new Array(elements.length).fill(
            typeof resInput === 'number' ? resInput : values.resolution
          );

      for (let i = 0; i < result.curve.splines.length; i++) {
        if (selection && !selection[i]) continue;
        result.curve.splines[i].resolution = Math.max(1, Math.round(resVals[i] ?? 12));
      }

      return { outputs: [result] };
    },
  });

  // ── Fill Curve ──────────────────────────────────────────────────────────
  // Blender: node_geo_curve_fill.cc
  // "Generate a mesh on the XY plane with faces on the inside of input curves"
  //
  // Input: Curve (geometry)
  // Output: Mesh (geometry)
  // Property: Mode (Triangulated, Ngons)
  //
  // NOTE: Full CDT (Constrained Delaunay Triangulation) is complex to implement
  // in pure JS. We implement a simplified fan triangulation from the centroid.
  // This works correctly for convex and simple concave curves but does not
  // handle self-intersecting or complex multi-curve fill scenarios.
  // DOCUMENTED LIMITATION: Complex CDT fill not implemented.

  registry.addNode('geo', 'fill_curve', {
    label: 'Fill Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { mode: 'TRIANGULATED' },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'TRIANGULATED', label: 'Triangulated' },
          { value: 'NGONS', label: 'N-Gons' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [new GeometrySet()] };
      }

      const result = new GeometrySet();
      const mesh = new MeshComponent();
      const mode = values.mode || 'TRIANGULATED';

      for (let si = 0; si < geo.curve.splines.length; si++) {
        const spline = geo.curve.splines[si];
        const pts = spline.positions;
        if (pts.length < 3) continue;

        const vertStart = mesh.positions.length;

        // Add vertices (project to XY plane as Blender does)
        for (const p of pts) {
          mesh.positions.push({ x: p.x, y: p.y, z: 0 });
        }

        const n = pts.length;

        if (mode === 'NGONS') {
          // Single n-gon face
          mesh.faceVertCounts.push(n);
          for (let i = 0; i < n; i++) {
            mesh.cornerVerts.push(vertStart + i);
          }
        } else {
          // Fan triangulation from first vertex
          for (let i = 1; i < n - 1; i++) {
            mesh.faceVertCounts.push(3);
            mesh.cornerVerts.push(vertStart, vertStart + i, vertStart + i + 1);
          }
        }

        // Add edges
        for (let i = 0; i < n; i++) {
          mesh.edges.push([vertStart + i, vertStart + (i + 1) % n]);
        }
      }

      if (mesh.positions.length > 0) {
        result.mesh = mesh;
      }
      return { outputs: [result] };
    },
  });

  // ── Fillet Curve ────────────────────────────────────────────────────────
  // Blender: node_geo_curve_fillet.cc
  // "Round corners by generating circular arcs on each control point"
  //
  // Inputs: Curve, Radius (float field, 0.25), Count (int field, 1, poly mode only)
  // Output: Curve
  // Property: Mode (Bezier, Poly)
  //
  // We implement Poly mode (adds intermediate points on arcs).

  registry.addNode('geo', 'fillet_curve', {
    label: 'Fillet Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Radius', type: SocketType.FLOAT },
      { name: 'Count', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { radius: 0.25, count: 1, mode: 'POLY' },
    props: [
      { key: 'radius', label: 'Radius', type: 'float', min: 0, max: 1000, step: 0.01 },
      { key: 'count', label: 'Count', type: 'int', min: 1, max: 1000, step: 1 },
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'BEZIER', label: 'Bezier' },
          { value: 'POLY', label: 'Poly' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      }

      const radiusInput = inputs['Radius'];
      const countInput = inputs['Count'];
      const radius = radiusInput != null ? resolveScalar(radiusInput, values.radius) : values.radius;
      const count = countInput != null ? Math.max(1, Math.round(resolveScalar(countInput, values.count))) : values.count;

      if (radius <= 0) return { outputs: [geo.copy()] };

      const result = geo.copy();

      for (let si = 0; si < result.curve.splines.length; si++) {
        const spline = result.curve.splines[si];
        const pts = spline.positions;
        const n = pts.length;
        if (n < 3) continue;

        const newPositions = [];
        const newRadii = [];
        const newTilts = [];

        for (let i = 0; i < n; i++) {
          const prev = pts[(i + n - 1) % n];
          const curr = pts[i];
          const next = pts[(i + 1) % n];

          // Check if this is an interior point (or cyclic)
          const isEndpoint = !spline.cyclic && (i === 0 || i === n - 1);

          if (isEndpoint) {
            newPositions.push({ x: curr.x, y: curr.y, z: curr.z });
            newRadii.push(spline.radii ? spline.radii[i] : 1);
            newTilts.push(spline.tilts ? spline.tilts[i] : 0);
            continue;
          }

          // Compute directions
          const d1x = prev.x - curr.x, d1y = prev.y - curr.y, d1z = prev.z - curr.z;
          const d2x = next.x - curr.x, d2y = next.y - curr.y, d2z = next.z - curr.z;
          const l1 = Math.sqrt(d1x * d1x + d1y * d1y + d1z * d1z) || 1;
          const l2 = Math.sqrt(d2x * d2x + d2y * d2y + d2z * d2z) || 1;
          const n1x = d1x / l1, n1y = d1y / l1, n1z = d1z / l1;
          const n2x = d2x / l2, n2y = d2y / l2, n2z = d2z / l2;

          // Clamp radius to not exceed edge lengths
          const maxR = Math.min(l1, l2) * 0.5;
          const r = Math.min(radius, maxR);

          // Generate arc points
          for (let j = 0; j <= count; j++) {
            const t = j / count;
            // Interpolate along the two direction vectors
            const px = curr.x + r * (n1x * (1 - t) + n2x * t);
            const py = curr.y + r * (n1y * (1 - t) + n2y * t);
            const pz = curr.z + r * (n1z * (1 - t) + n2z * t);
            newPositions.push({ x: px, y: py, z: pz });
            newRadii.push(spline.radii ? spline.radii[i] : 1);
            newTilts.push(spline.tilts ? spline.tilts[i] : 0);
          }
        }

        spline.positions = newPositions;
        spline.radii = newRadii;
        spline.tilts = newTilts;
        spline.handleLeft = null;
        spline.handleRight = null;
        spline.type = 'POLY';
      }

      return { outputs: [result] };
    },
  });
}

// ── Euler Helper ────────────────────────────────────────────────────────────

function _matToEulerXYZ(xAxis, yAxis, zAxis) {
  const m20 = xAxis.z;
  const ry = Math.asin(-Math.max(-1, Math.min(1, m20)));
  let rx, rz;
  if (Math.abs(m20) < 0.9999) {
    rx = Math.atan2(yAxis.z, zAxis.z);
    rz = Math.atan2(xAxis.y, xAxis.x);
  } else {
    rx = Math.atan2(-yAxis.x, yAxis.y);
    rz = 0;
  }
  return { x: rx, y: ry, z: rz };
}
