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

  // ── Set Spline Type ─────────────────────────────────────────────────────
  // Blender: node_geo_curve_spline_type.cc
  // "Change the type of curves"
  // Inputs: Curve, Selection (bool field)
  // Property: spline_type (Catmull-Rom, Poly, Bezier, NURBS)

  registry.addNode('geo', 'set_spline_type', {
    label: 'Set Spline Type',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { spline_type: 'POLY' },
    props: [
      {
        key: 'spline_type', label: 'Type', type: 'select',
        options: [
          { value: 'CATMULL_ROM', label: 'Catmull Rom' },
          { value: 'POLY', label: 'Poly' },
          { value: 'BEZIER', label: 'Bezier' },
          { value: 'NURBS', label: 'NURBS' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve) return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      const result = geo.copy();
      const elements = result.curve.buildElements('SPLINE');
      const selection = inputs['Selection'];

      for (let si = 0; si < result.curve.splines.length; si++) {
        if (selection != null) {
          const sel = isField(selection) ? selection.evaluateAt(elements[si] || { index: si, count: result.curve.splines.length }) : selection;
          if (!sel) continue;
        }
        result.curve.splines[si].type = values.spline_type || 'POLY';
        // Clear handles when converting away from BEZIER
        if (values.spline_type !== 'BEZIER') {
          result.curve.splines[si].handleLeft = null;
          result.curve.splines[si].handleRight = null;
        }
      }
      return { outputs: [result] };
    },
  });

  // ── Curve Handle Positions (read) ──────────────────────────────────────
  // Blender: node_geo_input_curve_handles.cc
  // "Retrieve the position of each Bezier control point's handles"
  // Input: Relative (bool, default false)
  // Outputs: Left (vector field), Right (vector field)

  registry.addNode('geo', 'curve_handle_positions', {
    label: 'Curve Handle Positions',
    category: 'CURVE',
    inputs: [
      { name: 'Relative', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Left', type: SocketType.VECTOR },
      { name: 'Right', type: SocketType.VECTOR },
    ],
    defaults: {},
    props: [],
    evaluate() {
      // Would need Bezier curve context for actual handle positions
      return { outputs: [
        new Field('vector', () => ({ x: 0, y: 0, z: 0 })),
        new Field('vector', () => ({ x: 0, y: 0, z: 0 })),
      ]};
    },
  });

  // ── Points of Curve ────────────────────────────────────────────────────
  // Blender: node_geo_curve_topology_points_of_curve.cc
  // "Retrieve a point index within a curve"
  // Inputs: Curve Index (int field), Weights (float field), Sort Index (int field)
  // Outputs: Point Index (int field), Total (int field)

  registry.addNode('geo', 'points_of_curve', {
    label: 'Points of Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Curve Index', type: SocketType.INT },
      { name: 'Weights', type: SocketType.FLOAT },
      { name: 'Sort Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Point Index', type: SocketType.INT },
      { name: 'Total', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      return { outputs: [
        new Field('int', (el) => el.index),
        new Field('int', (el) => el.localCount ?? el.count ?? 0),
      ]};
    },
  });

  // ── Curve Quadrilateral ──────────────────────────────────────────────────
  // Blender: node_geo_curve_primitive_quadrilateral.cc
  // "Generate a polygon with four points"
  // Property: Mode (Rectangle, Parallelogram, Trapezoid, Kite, Points)

  registry.addNode('geo', 'curve_quadrilateral', {
    label: 'Quadrilateral',
    category: 'CURVE',
    inputs: [
      { name: 'Width', type: SocketType.FLOAT },
      { name: 'Height', type: SocketType.FLOAT },
      { name: 'Offset', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { width: 2.0, height: 2.0, offset: 1.0, mode: 'RECTANGLE' },
    props: [
      { key: 'width', label: 'Width', type: 'float', min: 0, max: 1000, step: 0.01 },
      { key: 'height', label: 'Height', type: 'float', min: 0, max: 1000, step: 0.01 },
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'RECTANGLE', label: 'Rectangle' },
          { value: 'PARALLELOGRAM', label: 'Parallelogram' },
          { value: 'TRAPEZOID', label: 'Trapezoid' },
          { value: 'KITE', label: 'Kite' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const w = inputs['Width'] ?? values.width;
      const h = inputs['Height'] ?? values.height;
      const off = inputs['Offset'] ?? values.offset;
      const hw = w / 2, hh = h / 2;

      let positions;
      switch (values.mode) {
        case 'PARALLELOGRAM':
          positions = [
            { x: -hw, y: -hh, z: 0 }, { x: hw, y: -hh, z: 0 },
            { x: hw + off, y: hh, z: 0 }, { x: -hw + off, y: hh, z: 0 },
          ];
          break;
        case 'TRAPEZOID':
          positions = [
            { x: -hw, y: -hh, z: 0 }, { x: hw, y: -hh, z: 0 },
            { x: hw * 0.5 + off, y: hh, z: 0 }, { x: -hw * 0.5 + off, y: hh, z: 0 },
          ];
          break;
        case 'KITE':
          positions = [
            { x: 0, y: -hh, z: 0 }, { x: hw, y: 0, z: 0 },
            { x: 0, y: hh, z: 0 }, { x: -hw, y: 0, z: 0 },
          ];
          break;
        default: // RECTANGLE
          positions = [
            { x: -hw, y: -hh, z: 0 }, { x: hw, y: -hh, z: 0 },
            { x: hw, y: hh, z: 0 }, { x: -hw, y: hh, z: 0 },
          ];
      }

      const result = new GeometrySet();
      const curve = new CurveComponent();
      curve.splines.push({
        type: 'POLY', positions,
        handleLeft: null, handleRight: null,
        radii: positions.map(() => 1), tilts: positions.map(() => 0),
        cyclic: true, resolution: 12,
      });
      result.curve = curve;
      return { outputs: [result] };
    },
  });

  // ── Curve Star ─────────────────────────────────────────────────────────
  // Blender: node_geo_curve_primitive_star.cc
  // "Generate a star pattern by connecting alternating points of two circles"
  //
  // Inputs: Points (int 8, min 3), Inner Radius (1.0), Outer Radius (2.0), Twist (0.0)
  // Outputs: Curve, Outer Points (bool field)

  registry.addNode('geo', 'curve_star', {
    label: 'Star',
    category: 'CURVE',
    inputs: [
      { name: 'Points', type: SocketType.INT },
      { name: 'Inner Radius', type: SocketType.FLOAT },
      { name: 'Outer Radius', type: SocketType.FLOAT },
      { name: 'Twist', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Outer Points', type: SocketType.BOOL },
    ],
    defaults: { points: 8, inner_radius: 1.0, outer_radius: 2.0, twist: 0.0 },
    props: [
      { key: 'points', label: 'Points', type: 'int', min: 3, max: 256, step: 1 },
    ],
    evaluate(values, inputs) {
      const n = inputs['Points'] != null ? Math.max(3, Math.round(inputs['Points'])) : values.points;
      const innerR = inputs['Inner Radius'] ?? values.inner_radius;
      const outerR = inputs['Outer Radius'] ?? values.outer_radius;
      const twist = inputs['Twist'] ?? values.twist;

      const positions = [];
      const totalPts = n * 2;
      for (let i = 0; i < totalPts; i++) {
        const isOuter = i % 2 === 0;
        const r = isOuter ? outerR : innerR;
        const angle = (i / totalPts) * Math.PI * 2 + (isOuter ? 0 : twist);
        positions.push({
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r,
          z: 0,
        });
      }

      const result = new GeometrySet();
      const curve = new CurveComponent();
      curve.splines.push({
        type: 'POLY', positions,
        handleLeft: null, handleRight: null,
        radii: positions.map(() => 1), tilts: positions.map(() => 0),
        cyclic: true, resolution: 12,
      });
      result.curve = curve;

      // Outer Points selection field
      const outerField = new Field('bool', (el) => el.index % 2 === 0);

      return { outputs: [result, outerField] };
    },
  });

  // ── Handle Type Selection ──────────────────────────────────────────────
  // Blender: node_geo_curve_handle_type_selection.cc
  // "Provide a selection based on handle type"
  // Output: Selection (bool field)
  // Properties: handle_type (Auto/Free/Vector/Align), mode (Left/Right)

  registry.addNode('geo', 'handle_type_selection', {
    label: 'Handle Type Selection',
    category: 'CURVE',
    inputs: [],
    outputs: [
      { name: 'Selection', type: SocketType.BOOL },
    ],
    defaults: { handle_type: 'AUTO', mode: 'LEFT_RIGHT' },
    props: [
      {
        key: 'handle_type', label: 'Handle Type', type: 'select',
        options: [
          { value: 'AUTO', label: 'Auto' },
          { value: 'FREE', label: 'Free' },
          { value: 'VECTOR', label: 'Vector' },
          { value: 'ALIGN', label: 'Align' },
        ],
      },
    ],
    evaluate() {
      // Would check handle types in curve context
      return { outputs: [new Field('bool', () => false)] };
    },
  });

  // ── Set Handle Positions ───────────────────────────────────────────────
  // Blender: node_geo_set_curve_handles.cc
  // "Set Bezier handle positions"
  //
  // Inputs: Curve, Selection, Position (vector field), Offset (vector field)
  // Output: Curve
  // Property: Mode (Left, Right)

  registry.addNode('geo', 'set_handle_positions', {
    label: 'Set Handle Positions',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Position', type: SocketType.VECTOR },
      { name: 'Offset', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { mode: 'LEFT' },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'LEFT', label: 'Left' },
          { value: 'RIGHT', label: 'Right' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo) return { outputs: [new GeometrySet()] };
      // Handle position modification requires Bezier curve context
      return { outputs: [geo.copy()] };
    },
  });

  // ── Curve of Point ─────────────────────────────────────────────────────
  // Blender: node_geo_curve_topology_curve_of_point.cc
  // "Retrieve the curve a control point is part of"
  //
  // Input: Point Index (int field)
  // Outputs: Curve Index (int field), Index in Curve (int field)

  registry.addNode('geo', 'curve_of_point', {
    label: 'Curve of Point',
    category: 'CURVE',
    inputs: [
      { name: 'Point Index', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Curve Index', type: SocketType.INT },
      { name: 'Index in Curve', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      // Would need curve context to determine which spline a point belongs to
      return { outputs: [
        new Field('int', (el) => el.splineIndex ?? 0),
        new Field('int', (el) => el.localIndex ?? el.index),
      ]};
    },
  });

  // ── Offset Point in Curve ──────────────────────────────────────────────
  // Blender: node_geo_offset_point_in_curve.cc
  // "Offset a control point index within its curve"
  //
  // Inputs: Point Index (int field), Offset (int field)
  // Outputs: Is Valid Offset (bool field), Point Index (int field)

  registry.addNode('geo', 'offset_point_in_curve', {
    label: 'Offset Point in Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Point Index', type: SocketType.INT },
      { name: 'Offset', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Is Valid Offset', type: SocketType.BOOL },
      { name: 'Point Index', type: SocketType.INT },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const offsetInput = inputs['Offset'];
      return { outputs: [
        new Field('bool', (el) => {
          const off = isField(offsetInput) ? offsetInput.evaluateAt(el) : (offsetInput ?? 0);
          const newIdx = (el.localIndex ?? el.index) + off;
          const count = el.localCount ?? el.count;
          return newIdx >= 0 && newIdx < count;
        }),
        new Field('int', (el) => {
          const off = isField(offsetInput) ? offsetInput.evaluateAt(el) : (offsetInput ?? 0);
          return el.index + off;
        }),
      ]};
    },
  });

  // ── Points to Curves ───────────────────────────────────────────────────
  // Blender: node_geo_points_to_curves.cc
  // "Split points into curves by group ID and order by weight"
  //
  // Inputs: Points (geometry), Curve Group ID (int field), Weight (float field)
  // Output: Curves (geometry)

  registry.addNode('geo', 'points_to_curves', {
    label: 'Points to Curves',
    category: 'CURVE',
    inputs: [
      { name: 'Points', type: SocketType.GEOMETRY },
      { name: 'Curve Group ID', type: SocketType.INT },
      { name: 'Weight', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Curves', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Points'];
      if (!geo || !geo.mesh || geo.mesh.vertexCount === 0) {
        return { outputs: [new GeometrySet()] };
      }

      // Simple implementation: create one spline from all points
      const result = new GeometrySet();
      const curve = new CurveComponent();
      const positions = geo.mesh.positions.map(p => ({ x: p.x, y: p.y, z: p.z }));

      curve.splines.push({
        type: 'POLY', positions,
        handleLeft: null, handleRight: null,
        radii: positions.map(() => 1), tilts: positions.map(() => 0),
        cyclic: false, resolution: 12,
      });
      result.curve = curve;
      return { outputs: [result] };
    },
  });

  // ── Curve Arc ────────────────────────────────────────────────────────────
  // Blender: node_geo_curve_primitive_arc.cc
  // "Generate a poly arc curve"
  //
  // Inputs (RADIUS mode): Resolution, Radius, Start Angle, Sweep Angle,
  //   Connect Center, Invert Arc
  // Output: Curve

  registry.addNode('geo', 'curve_arc', {
    label: 'Arc',
    category: 'CURVE',
    inputs: [
      { name: 'Resolution', type: SocketType.INT },
      { name: 'Radius', type: SocketType.FLOAT },
      { name: 'Start Angle', type: SocketType.FLOAT },
      { name: 'Sweep Angle', type: SocketType.FLOAT },
      { name: 'Connect Center', type: SocketType.BOOL },
      { name: 'Invert Arc', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: {
      resolution: 16, radius: 1.0,
      start_angle: 0, sweep_angle: 1.75 * Math.PI,
    },
    props: [
      { key: 'resolution', label: 'Resolution', type: 'int', min: 2, max: 256, step: 1 },
      { key: 'radius', label: 'Radius', type: 'float', min: 0, max: 1000, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const resolution = inputs['Resolution'] != null ? Math.max(2, Math.round(inputs['Resolution'])) : values.resolution;
      const radius = inputs['Radius'] != null ? inputs['Radius'] : values.radius;
      const startAngle = inputs['Start Angle'] != null ? inputs['Start Angle'] : values.start_angle;
      const sweepAngle = inputs['Sweep Angle'] != null ? inputs['Sweep Angle'] : values.sweep_angle;
      const connectCenter = inputs['Connect Center'] ?? false;
      const invertArc = inputs['Invert Arc'] ?? false;

      const sweep = invertArc ? -(2 * Math.PI - Math.abs(sweepAngle)) * Math.sign(sweepAngle || 1) : sweepAngle;

      const positions = [];
      const radii = [];
      const tilts = [];

      for (let i = 0; i < resolution; i++) {
        const t = i / (resolution - 1);
        const angle = startAngle + sweep * t;
        positions.push({
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          z: 0,
        });
        radii.push(1);
        tilts.push(0);
      }

      if (connectCenter) {
        positions.push({ x: 0, y: 0, z: 0 });
        radii.push(1);
        tilts.push(0);
      }

      const result = new GeometrySet();
      const curve = new CurveComponent();
      curve.splines.push({
        type: 'POLY',
        positions, handleLeft: null, handleRight: null,
        radii, tilts,
        cyclic: connectCenter,
        resolution: 12,
      });
      result.curve = curve;
      return { outputs: [result] };
    },
  });

  // ── Curve Spiral ───────────────────────────────────────────────────────
  // Blender: node_geo_curve_primitive_spiral.cc
  // "Generate a poly spiral curve"
  //
  // Inputs: Resolution (32), Rotations (2.0), Start Radius (1.0),
  //         End Radius (2.0), Height (2.0), Reverse (bool)
  // Output: Curve

  registry.addNode('geo', 'curve_spiral', {
    label: 'Spiral',
    category: 'CURVE',
    inputs: [
      { name: 'Resolution', type: SocketType.INT },
      { name: 'Rotations', type: SocketType.FLOAT },
      { name: 'Start Radius', type: SocketType.FLOAT },
      { name: 'End Radius', type: SocketType.FLOAT },
      { name: 'Height', type: SocketType.FLOAT },
      { name: 'Reverse', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: {
      resolution: 32, rotations: 2.0,
      start_radius: 1.0, end_radius: 2.0,
      height: 2.0,
    },
    props: [
      { key: 'resolution', label: 'Resolution', type: 'int', min: 1, max: 1024, step: 1 },
      { key: 'rotations', label: 'Rotations', type: 'float', min: 0, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const resolution = inputs['Resolution'] != null ? Math.max(1, Math.round(inputs['Resolution'])) : values.resolution;
      const rotations = inputs['Rotations'] != null ? inputs['Rotations'] : values.rotations;
      const startRadius = inputs['Start Radius'] != null ? inputs['Start Radius'] : values.start_radius;
      const endRadius = inputs['End Radius'] != null ? inputs['End Radius'] : values.end_radius;
      const height = inputs['Height'] != null ? inputs['Height'] : values.height;
      const reverse = inputs['Reverse'] ?? false;

      const totalPoints = Math.max(1, resolution);
      const positions = [];
      const radii = [];
      const tilts = [];

      for (let i = 0; i < totalPoints; i++) {
        const t = i / Math.max(1, totalPoints - 1);
        const angle = t * rotations * 2 * Math.PI * (reverse ? -1 : 1);
        const r = startRadius + (endRadius - startRadius) * t;
        positions.push({
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r,
          z: t * height - height / 2,
        });
        radii.push(1);
        tilts.push(0);
      }

      const result = new GeometrySet();
      const curve = new CurveComponent();
      curve.splines.push({
        type: 'POLY',
        positions, handleLeft: null, handleRight: null,
        radii, tilts,
        cyclic: false,
        resolution: 12,
      });
      result.curve = curve;
      return { outputs: [result] };
    },
  });

  // ── Set Curve Normal ───────────────────────────────────────────────────
  // Blender: node_geo_set_curve_normal.cc
  // "Set the normal evaluation mode for curves"
  //
  // Inputs: Curve, Selection (bool field)
  // Output: Curve
  // Property: Mode (Minimum Twist, Z-Up, Free)

  registry.addNode('geo', 'set_curve_normal', {
    label: 'Set Curve Normal',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { mode: 'MINIMUM_TWIST' },
    props: [
      {
        key: 'mode', label: 'Mode', type: 'select',
        options: [
          { value: 'MINIMUM_TWIST', label: 'Minimum Twist' },
          { value: 'Z_UP', label: 'Z Up' },
          { value: 'FREE', label: 'Free' },
        ],
      },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo) return { outputs: [new GeometrySet()] };
      // Normal mode affects rendering/evaluation but doesn't change geometry
      return { outputs: [geo.copy()] };
    },
  });

  // ── Subdivide Curve ──────────────────────────────────────────────────────
  // Blender: node_geo_curve_subdivide.cc
  // "Dividing each curve segment into a specified number of pieces"
  //
  // Inputs: Curve (geometry), Cuts (int field, default 1, min 0, max 1000)
  // Output: Curve

  registry.addNode('geo', 'subdivide_curve', {
    label: 'Subdivide Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Cuts', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { cuts: 1 },
    props: [
      { key: 'cuts', label: 'Cuts', type: 'int', min: 0, max: 1000, step: 1 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      }

      const cuts = inputs['Cuts'] != null
        ? Math.max(0, Math.round(resolveScalar(inputs['Cuts'], values.cuts)))
        : values.cuts;

      if (cuts === 0) return { outputs: [geo.copy()] };

      const result = geo.copy();

      for (let si = 0; si < result.curve.splines.length; si++) {
        const spline = result.curve.splines[si];
        const pts = spline.positions;
        const n = pts.length;
        if (n < 2) continue;

        const newPositions = [];
        const newRadii = [];
        const newTilts = [];
        const segCount = spline.cyclic ? n : n - 1;

        for (let i = 0; i < segCount; i++) {
          const p0 = pts[i];
          const p1 = pts[(i + 1) % n];
          const r0 = spline.radii ? spline.radii[i] : 1;
          const r1 = spline.radii ? spline.radii[(i + 1) % n] : 1;
          const t0 = spline.tilts ? spline.tilts[i] : 0;
          const t1 = spline.tilts ? spline.tilts[(i + 1) % n] : 0;

          newPositions.push({ x: p0.x, y: p0.y, z: p0.z });
          newRadii.push(r0);
          newTilts.push(t0);

          for (let c = 1; c <= cuts; c++) {
            const t = c / (cuts + 1);
            newPositions.push({
              x: p0.x + (p1.x - p0.x) * t,
              y: p0.y + (p1.y - p0.y) * t,
              z: p0.z + (p1.z - p0.z) * t,
            });
            newRadii.push(r0 + (r1 - r0) * t);
            newTilts.push(t0 + (t1 - t0) * t);
          }
        }

        // Add last point for non-cyclic
        if (!spline.cyclic) {
          newPositions.push({ x: pts[n - 1].x, y: pts[n - 1].y, z: pts[n - 1].z });
          newRadii.push(spline.radii ? spline.radii[n - 1] : 1);
          newTilts.push(spline.tilts ? spline.tilts[n - 1] : 0);
        }

        spline.positions = newPositions;
        spline.radii = newRadii;
        spline.tilts = newTilts;
        spline.handleLeft = null;
        spline.handleRight = null;
      }

      return { outputs: [result] };
    },
  });

  // ── Reverse Curve ──────────────────────────────────────────────────────
  // Blender: node_geo_curve_reverse.cc
  // "Change the direction of curves by swapping their start and end data"
  //
  // Inputs: Curve (geometry), Selection (bool field, default true)
  // Output: Curve

  registry.addNode('geo', 'reverse_curve', {
    label: 'Reverse Curve',
    category: 'CURVE',
    inputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Curve'];
      if (!geo || !geo.curve || geo.curve.splineCount === 0) {
        return { outputs: [geo ? geo.copy() : new GeometrySet()] };
      }

      const result = geo.copy();
      const elements = result.curve.buildElements('SPLINE');
      const selection = inputs['Selection'];

      for (let si = 0; si < result.curve.splines.length; si++) {
        // Check selection (per-spline)
        if (selection != null) {
          const sel = isField(selection)
            ? selection.evaluateAt(elements[si] || { index: si, count: result.curve.splines.length })
            : selection;
          if (!sel) continue;
        }

        const spline = result.curve.splines[si];
        spline.positions.reverse();
        if (spline.radii) spline.radii.reverse();
        if (spline.tilts) spline.tilts.reverse();
        if (spline.handleLeft && spline.handleRight) {
          // Swap and reverse handles
          const tempLeft = spline.handleRight.reverse();
          spline.handleRight = spline.handleLeft.reverse();
          spline.handleLeft = tempLeft;
        }
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
