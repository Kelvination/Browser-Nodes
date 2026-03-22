/**
 * geo/nodes_v2_operations.js - Geometry operation and instance nodes.
 *
 * Nodes: set_position, transform_geometry, delete_geometry,
 *        join_geometry, instance_on_points, realize_instances
 */

import { SocketType } from '../core/registry.js';
import {
  GeometrySet,
  MeshComponent,
  CurveComponent,
  InstancesComponent,
  DOMAIN,
  applyTransform,
  rotateEulerXYZ,
} from '../core/geometry.js';
import { Field, isField, resolveField, resolveScalar, resolveSelection } from '../core/field.js';

export function registerOperationNodes(registry) {
  // ── Categories ──────────────────────────────────────────────────────────
  registry.addCategory('geo', 'GEOMETRY', { name: 'Geometry', color: '#26A69A', icon: '⊞' });
  registry.addCategory('geo', 'TRANSFORM', { name: 'Transform', color: '#AB47BC', icon: '↻' });
  registry.addCategory('geo', 'INSTANCE', { name: 'Instances', color: '#FF7043', icon: '⊕' });

  // ── 1. Set Position ────────────────────────────────────────────────────
  // KEY node demonstrating the architecture fix: operates on REAL geometry.
  // Evaluates field inputs against actual vertex/control-point elements.

  registry.addNode('geo', 'set_position', {
    label: 'Set Position',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Position', type: SocketType.VECTOR },
      { name: 'Offset', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { domain: 'POINT' },
    props: [
      { key: 'domain', label: 'Domain', type: 'select', options: [
        { value: 'POINT', label: 'Point' },
        { value: 'FACE', label: 'Face' },
        { value: 'EDGE', label: 'Edge' },
        { value: 'CURVE_POINT', label: 'Spline Point' },
      ]},
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      const result = geo.copy();

      const selectionInput = inputs['Selection'];
      const posField = inputs['Position'];
      const offsetField = inputs['Offset'];

      // ── Process mesh vertices ──────────────────────────────────────
      if (result.mesh && result.mesh.vertexCount > 0) {
        const elements = result.mesh.buildElements(DOMAIN.POINT);

        const selection = resolveSelection(selectionInput, elements);

        // Evaluate position field
        if (posField != null) {
          const positions = isField(posField)
            ? posField.evaluateAll(elements)
            : new Array(elements.length).fill(posField);
          for (let i = 0; i < result.mesh.positions.length; i++) {
            if (selection && !selection[i]) continue;
            if (positions[i] != null) {
              result.mesh.positions[i] = {
                x: positions[i].x ?? 0,
                y: positions[i].y ?? 0,
                z: positions[i].z ?? 0,
              };
            }
          }
        }

        // Evaluate offset field — ADD to current positions
        if (offsetField != null) {
          // Re-build elements after position changes so offset evaluates against updated positions
          const updatedElements = result.mesh.buildElements(DOMAIN.POINT);
          const offsets = isField(offsetField)
            ? offsetField.evaluateAll(updatedElements)
            : new Array(updatedElements.length).fill(offsetField);
          for (let i = 0; i < result.mesh.positions.length; i++) {
            if (selection && !selection[i]) continue;
            if (offsets[i] != null) {
              result.mesh.positions[i] = {
                x: result.mesh.positions[i].x + (offsets[i].x ?? 0),
                y: result.mesh.positions[i].y + (offsets[i].y ?? 0),
                z: result.mesh.positions[i].z + (offsets[i].z ?? 0),
              };
            }
          }
        }
      }

      // ── Process curve control points ───────────────────────────────
      if (result.curve && result.curve.splineCount > 0) {
        const elements = result.curve.buildElements(DOMAIN.CURVE_POINT);

        const selection = resolveSelection(selectionInput, elements);

        // Flatten all spline positions into a single indexable list
        const allPositions = [];
        for (const spline of result.curve.splines) {
          for (const pos of spline.positions) {
            allPositions.push(pos);
          }
        }

        if (posField != null) {
          const positions = isField(posField)
            ? posField.evaluateAll(elements)
            : new Array(elements.length).fill(posField);
          for (let i = 0; i < allPositions.length; i++) {
            if (selection && !selection[i]) continue;
            if (positions[i] != null) {
              allPositions[i].x = positions[i].x ?? 0;
              allPositions[i].y = positions[i].y ?? 0;
              allPositions[i].z = positions[i].z ?? 0;
            }
          }
        }

        if (offsetField != null) {
          const updatedElements = result.curve.buildElements(DOMAIN.CURVE_POINT);
          const offsets = isField(offsetField)
            ? offsetField.evaluateAll(updatedElements)
            : new Array(updatedElements.length).fill(offsetField);
          for (let i = 0; i < allPositions.length; i++) {
            if (selection && !selection[i]) continue;
            if (offsets[i] != null) {
              allPositions[i].x += offsets[i].x ?? 0;
              allPositions[i].y += offsets[i].y ?? 0;
              allPositions[i].z += offsets[i].z ?? 0;
            }
          }
        }
      }

      return { outputs: [result] };
    },
  });

  // ── 2. Transform Geometry ──────────────────────────────────────────────

  registry.addNode('geo', 'transform_geometry', {
    label: 'Transform Geometry',
    category: 'TRANSFORM',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Translation', type: SocketType.VECTOR },
      { name: 'Rotation', type: SocketType.VECTOR },
      { name: 'Scale', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: {
      translateX: 0, translateY: 0, translateZ: 0,
      rotateX: 0, rotateY: 0, rotateZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
    },
    props: [
      { key: 'translateX', label: 'Translate X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'translateY', label: 'Translate Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'translateZ', label: 'Translate Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'rotateX', label: 'Rotate X', type: 'float', min: -6.28318, max: 6.28318, step: 0.01745 },
      { key: 'rotateY', label: 'Rotate Y', type: 'float', min: -6.28318, max: 6.28318, step: 0.01745 },
      { key: 'rotateZ', label: 'Rotate Z', type: 'float', min: -6.28318, max: 6.28318, step: 0.01745 },
      { key: 'scaleX', label: 'Scale X', type: 'float', min: -100, max: 100, step: 0.1 },
      { key: 'scaleY', label: 'Scale Y', type: 'float', min: -100, max: 100, step: 0.1 },
      { key: 'scaleZ', label: 'Scale Z', type: 'float', min: -100, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      const result = geo.copy();

      // Build translation, rotation, scale vectors from inputs or props
      const transInput = inputs['Translation'];
      const translation = transInput
        ? { x: transInput.x ?? 0, y: transInput.y ?? 0, z: transInput.z ?? 0 }
        : { x: values.translateX, y: values.translateY, z: values.translateZ };

      const rotInput = inputs['Rotation'];
      const rotation = rotInput
        ? { x: rotInput.x ?? 0, y: rotInput.y ?? 0, z: rotInput.z ?? 0 }
        : { x: values.rotateX, y: values.rotateY, z: values.rotateZ };

      const scaleInput = inputs['Scale'];
      const scale = scaleInput
        ? { x: scaleInput.x ?? 1, y: scaleInput.y ?? 1, z: scaleInput.z ?? 1 }
        : { x: values.scaleX, y: values.scaleY, z: values.scaleZ };

      // Transform mesh positions
      if (result.mesh && result.mesh.vertexCount > 0) {
        for (let i = 0; i < result.mesh.positions.length; i++) {
          result.mesh.positions[i] = applyTransform(
            result.mesh.positions[i], translation, rotation, scale
          );
        }
      }

      // Transform curve control points (and bezier handles)
      if (result.curve && result.curve.splineCount > 0) {
        for (const spline of result.curve.splines) {
          for (let i = 0; i < spline.positions.length; i++) {
            spline.positions[i] = applyTransform(
              spline.positions[i], translation, rotation, scale
            );
          }
          // Transform bezier handles too
          if (spline.handleLeft) {
            for (let i = 0; i < spline.handleLeft.length; i++) {
              spline.handleLeft[i] = applyTransform(
                spline.handleLeft[i], translation, rotation, scale
              );
            }
          }
          if (spline.handleRight) {
            for (let i = 0; i < spline.handleRight.length; i++) {
              spline.handleRight[i] = applyTransform(
                spline.handleRight[i], translation, rotation, scale
              );
            }
          }
        }
      }

      // Transform instance positions
      if (result.instances && result.instances.instanceCount > 0) {
        for (let i = 0; i < result.instances.transforms.length; i++) {
          const t = result.instances.transforms[i];
          t.position = applyTransform(t.position, translation, rotation, scale);
        }
      }

      return { outputs: [result] };
    },
  });

  // ── 3. Delete Geometry ─────────────────────────────────────────────────

  registry.addNode('geo', 'delete_geometry', {
    label: 'Delete Geometry',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Selection', type: SocketType.BOOL },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: { domain: 'POINT', mode: 'all' },
    props: [
      { key: 'domain', label: 'Domain', type: 'select', options: ['POINT', 'EDGE', 'FACE'] },
      { key: 'mode', label: 'Mode', type: 'select', options: ['all', 'all_but_selected'] },
    ],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };
      const result = geo.copy();

      const selectionInput = inputs['Selection'];
      if (selectionInput == null) return { outputs: [result] };

      const domain = values.domain || 'POINT';
      const mode = values.mode || 'all';

      if (!result.mesh || result.mesh.vertexCount === 0) {
        return { outputs: [result] };
      }

      const mesh = result.mesh;

      if (domain === 'POINT') {
        const elements = mesh.buildElements(DOMAIN.POINT);
        const selValues = resolveSelection(selectionInput, elements)
          || new Array(elements.length).fill(true);

        // Determine which vertices to keep
        const keepVertex = new Array(mesh.vertexCount).fill(false);
        for (let i = 0; i < mesh.vertexCount; i++) {
          const selected = !!selValues[i];
          if (mode === 'all') {
            keepVertex[i] = !selected; // remove selected
          } else {
            keepVertex[i] = selected;  // keep only selected
          }
        }

        // Build old-to-new vertex index map
        const newIndex = new Array(mesh.vertexCount).fill(-1);
        const keptIndices = [];
        let newIdx = 0;
        for (let i = 0; i < mesh.vertexCount; i++) {
          if (keepVertex[i]) {
            newIndex[i] = newIdx++;
            keptIndices.push(i);
          }
        }

        // Rebuild positions
        mesh.positions = keptIndices.map(i => mesh.positions[i]);
        mesh.pointAttrs.filter(keptIndices);

        // Rebuild edges - keep only edges where both verts survive
        const newEdges = [];
        for (const edge of mesh.edges) {
          if (newIndex[edge[0]] >= 0 && newIndex[edge[1]] >= 0) {
            newEdges.push([newIndex[edge[0]], newIndex[edge[1]]]);
          }
        }
        mesh.edges = newEdges;

        // Rebuild faces - keep only faces where all verts survive
        const newFaceVertCounts = [];
        const newCornerVerts = [];
        let cornerIdx = 0;
        for (let fi = 0; fi < mesh.faceVertCounts.length; fi++) {
          const count = mesh.faceVertCounts[fi];
          const faceCorners = mesh.cornerVerts.slice(cornerIdx, cornerIdx + count);
          cornerIdx += count;

          const allSurvive = faceCorners.every(vi => newIndex[vi] >= 0);
          if (allSurvive) {
            newFaceVertCounts.push(count);
            for (const vi of faceCorners) {
              newCornerVerts.push(newIndex[vi]);
            }
          }
        }
        mesh.faceVertCounts = newFaceVertCounts;
        mesh.cornerVerts = newCornerVerts;
        mesh.invalidateCornerOffsets();

      } else if (domain === 'FACE') {
        const elements = mesh.buildElements(DOMAIN.FACE);
        const selValues = resolveSelection(selectionInput, elements)
          || new Array(elements.length).fill(true);

        // Determine which faces and corners to keep
        const newFaceVertCounts = [];
        const newCornerVerts = [];
        const keptFaceIndices = [];
        const keptCornerIndices = [];
        let cornerIdx = 0;
        for (let fi = 0; fi < mesh.faceVertCounts.length; fi++) {
          const count = mesh.faceVertCounts[fi];
          const faceCorners = mesh.cornerVerts.slice(cornerIdx, cornerIdx + count);

          const selected = !!selValues[fi];
          const keep = mode === 'all' ? !selected : selected;
          if (keep) {
            newFaceVertCounts.push(count);
            newCornerVerts.push(...faceCorners);
            keptFaceIndices.push(fi);
            for (let ci = 0; ci < count; ci++) {
              keptCornerIndices.push(cornerIdx + ci);
            }
          }
          cornerIdx += count;
        }

        mesh.faceVertCounts = newFaceVertCounts;
        mesh.cornerVerts = newCornerVerts;
        mesh.faceAttrs.filter(keptFaceIndices);
        mesh.cornerAttrs.filter(keptCornerIndices);
        mesh.invalidateCornerOffsets();

        // Positions and edges remain (only faces removed)

      } else if (domain === 'EDGE') {
        const elements = mesh.buildElements(DOMAIN.EDGE);
        const selValues = resolveSelection(selectionInput, elements)
          || new Array(elements.length).fill(true);

        const keptEdgeIndices = [];
        const newEdges = [];
        for (let i = 0; i < mesh.edges.length; i++) {
          const selected = !!selValues[i];
          const keep = mode === 'all' ? !selected : selected;
          if (keep) {
            newEdges.push(mesh.edges[i]);
            keptEdgeIndices.push(i);
          }
        }
        mesh.edges = newEdges;
        mesh.edgeAttrs.filter(keptEdgeIndices);
      }

      return { outputs: [result] };
    },
  });

  // ── 4. Join Geometry ───────────────────────────────────────────────────

  registry.addNode('geo', 'join_geometry', {
    label: 'Join Geometry',
    category: 'GEOMETRY',
    inputs: [
      { name: 'Geometry 1', type: SocketType.GEOMETRY },
      { name: 'Geometry 2', type: SocketType.GEOMETRY },
      { name: 'Geometry 3', type: SocketType.GEOMETRY },
      { name: 'Geometry 4', type: SocketType.GEOMETRY },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const result = new GeometrySet();

      if (inputs['Geometry 1']) result.join(inputs['Geometry 1']);
      if (inputs['Geometry 2']) result.join(inputs['Geometry 2']);
      if (inputs['Geometry 3']) result.join(inputs['Geometry 3']);
      if (inputs['Geometry 4']) result.join(inputs['Geometry 4']);

      return { outputs: [result] };
    },
  });

  // ── 5. Instance on Points ──────────────────────────────────────────────

  registry.addNode('geo', 'instance_on_points', {
    label: 'Instance on Points',
    category: 'INSTANCE',
    inputs: [
      { name: 'Points', type: SocketType.GEOMETRY },
      { name: 'Instance', type: SocketType.GEOMETRY },
      { name: 'Pick Instance', type: SocketType.BOOL },
      { name: 'Selection', type: SocketType.BOOL },
      { name: 'Rotation', type: SocketType.VECTOR },
      { name: 'Scale', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Instances', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const pointsGeo = inputs['Points'];
      const instanceGeo = inputs['Instance'];
      if (!pointsGeo) return { outputs: [new GeometrySet()] };

      // Gather point positions from mesh or curve
      let pointPositions = [];
      let elements = [];

      if (pointsGeo.mesh && pointsGeo.mesh.vertexCount > 0) {
        pointPositions = pointsGeo.mesh.positions;
        elements = pointsGeo.mesh.buildElements(DOMAIN.POINT);
      } else if (pointsGeo.curve && pointsGeo.curve.splineCount > 0) {
        pointPositions = pointsGeo.curve.getAllPositions();
        elements = pointsGeo.curve.buildElements(DOMAIN.CURVE_POINT);
      }

      if (pointPositions.length === 0) return { outputs: [new GeometrySet()] };

      const selectionInput = inputs['Selection'];
      const rotationInput = inputs['Rotation'];
      const scaleInput = inputs['Scale'];

      // Evaluate fields against elements
      const selection = resolveSelection(selectionInput, elements);

      let rotations = null;
      if (rotationInput != null) {
        rotations = isField(rotationInput)
          ? rotationInput.evaluateAll(elements)
          : new Array(elements.length).fill(rotationInput);
      }

      let scales = null;
      if (scaleInput != null) {
        scales = isField(scaleInput)
          ? scaleInput.evaluateAll(elements)
          : new Array(elements.length).fill(scaleInput);
      }

      const result = new GeometrySet();
      result.instances = new InstancesComponent();

      for (let i = 0; i < pointPositions.length; i++) {
        // Skip if selection is false
        if (selection && !selection[i]) continue;

        const pos = {
          x: pointPositions[i].x,
          y: pointPositions[i].y,
          z: pointPositions[i].z,
        };
        const rot = rotations
          ? { x: rotations[i]?.x ?? 0, y: rotations[i]?.y ?? 0, z: rotations[i]?.z ?? 0 }
          : { x: 0, y: 0, z: 0 };
        const scl = scales
          ? { x: scales[i]?.x ?? 1, y: scales[i]?.y ?? 1, z: scales[i]?.z ?? 1 }
          : { x: 1, y: 1, z: 1 };

        result.instances.addInstance(pos, rot, scl, instanceGeo || null);
      }

      return { outputs: [result] };
    },
  });

  // ── 6. Realize Instances ───────────────────────────────────────────────

  registry.addNode('geo', 'realize_instances', {
    label: 'Realize Instances',
    category: 'INSTANCE',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'];
      if (!geo) return { outputs: [new GeometrySet()] };

      if (!geo.instances || geo.instances.instanceCount === 0) {
        // No instances to realize, return a copy
        return { outputs: [geo.copy()] };
      }

      const result = new GeometrySet();

      // Include any non-instance components from input
      if (geo.mesh && geo.mesh.vertexCount > 0) {
        result.mesh = geo.mesh.copy();
      }
      if (geo.curve && geo.curve.splineCount > 0) {
        result.curve = geo.curve.copy();
      }

      // Realize each instance
      for (let i = 0; i < geo.instances.instanceCount; i++) {
        const transform = geo.instances.transforms[i];
        const refGeo = geo.instances.references[i];
        if (!refGeo) continue;

        const instanceCopy = refGeo.copy();
        const translation = transform.position;
        const rotation = transform.rotation;
        const scale = transform.scale;

        // Transform mesh positions
        if (instanceCopy.mesh && instanceCopy.mesh.vertexCount > 0) {
          for (let vi = 0; vi < instanceCopy.mesh.positions.length; vi++) {
            instanceCopy.mesh.positions[vi] = applyTransform(
              instanceCopy.mesh.positions[vi], translation, rotation, scale
            );
          }
        }

        // Transform curve control points
        if (instanceCopy.curve && instanceCopy.curve.splineCount > 0) {
          for (const spline of instanceCopy.curve.splines) {
            for (let pi = 0; pi < spline.positions.length; pi++) {
              spline.positions[pi] = applyTransform(
                spline.positions[pi], translation, rotation, scale
              );
            }
            if (spline.handleLeft) {
              for (let pi = 0; pi < spline.handleLeft.length; pi++) {
                spline.handleLeft[pi] = applyTransform(
                  spline.handleLeft[pi], translation, rotation, scale
                );
              }
            }
            if (spline.handleRight) {
              for (let pi = 0; pi < spline.handleRight.length; pi++) {
                spline.handleRight[pi] = applyTransform(
                  spline.handleRight[pi], translation, rotation, scale
                );
              }
            }
          }
        }

        // Join the realized instance into the result
        result.join(instanceCopy);
      }

      return { outputs: [result] };
    },
  });
}
