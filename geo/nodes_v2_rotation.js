/**
 * geo/nodes_v2_rotation.js - Rotation utility nodes.
 *
 * Nodes: align_euler_to_vector
 *
 * Reference: Blender source
 *   - source/blender/nodes/geometry/nodes/node_geo_align_rotation_to_vector.cc
 *   - source/blender/blenlib/BLI_math_rotation.h
 */

import { SocketType } from '../core/registry.js';
import { Field, isField, combineFields, resolveField } from '../core/field.js';
import { vecNormalize, vecCross, vecDot, vecLength } from '../core/utils.js';

/**
 * Compute Euler XYZ rotation from a 3x3 rotation matrix given as three
 * column vectors [xAxis, yAxis, zAxis].
 *
 * Blender convention:
 *   ry = asin(clamp(-m20, -1, 1))
 *   rx = atan2(m21, m22)
 *   rz = atan2(m10, m00)
 */
function mat3ToEulerXYZ(xCol, yCol, zCol) {
  const m20 = xCol.z;
  const ry = Math.asin(-Math.max(-1, Math.min(1, m20)));

  let rx, rz;
  if (Math.abs(m20) < 0.9999) {
    rx = Math.atan2(yCol.z, zCol.z);
    rz = Math.atan2(xCol.y, xCol.x);
  } else {
    rx = Math.atan2(-yCol.x, yCol.y);
    rz = 0;
  }

  return { x: rx, y: ry, z: rz };
}

/**
 * Construct a 3x3 rotation matrix from Euler XYZ angles.
 * Returns three column vectors [xCol, yCol, zCol].
 *
 * Blender reference: eul_to_mat3 in BLI_math_rotation.h
 */
function eulerXYZToMat3(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Combined rotation: Rz * Ry * Rx (Blender's XYZ Euler convention)
  return {
    xCol: {
      x: cy * cz,
      y: cy * sz,
      z: -sy,
    },
    yCol: {
      x: sx * sy * cz - cx * sz,
      y: sx * sy * sz + cx * cz,
      z: sx * cy,
    },
    zCol: {
      x: cx * sy * cz + sx * sz,
      y: cx * sy * sz - sx * cz,
      z: cx * cy,
    },
  };
}

/**
 * Multiply a 3x3 matrix (three column vectors) by a vector.
 */
function mat3MulVec(mat, v) {
  return {
    x: mat.xCol.x * v.x + mat.yCol.x * v.y + mat.zCol.x * v.z,
    y: mat.xCol.y * v.x + mat.yCol.y * v.y + mat.zCol.y * v.z,
    z: mat.xCol.z * v.x + mat.yCol.z * v.y + mat.zCol.z * v.z,
  };
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerRotationNodes(registry) {
  registry.addCategory('geo', 'ROTATION', { name: 'Rotation', color: '#AB47BC', icon: '↻' });

  // ═══════════════════════════════════════════════════════════════════════════
  // ALIGN EULER TO VECTOR
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Blender reference: node_geo_align_rotation_to_vector.cc
  //
  // Rotates the input Euler rotation so that the specified local axis
  // (X, Y, or Z) points in the direction of the given vector.
  //
  // Pivot Axis:
  //   AUTO - freely rotate to align the axis to the vector
  //   X/Y/Z - constrain rotation to only rotate around the specified pivot
  //
  // Factor: blend between original and aligned rotation (0=original, 1=aligned)
  //
  // Algorithm (AUTO pivot):
  //   1. Get the current direction of the specified axis from the rotation matrix
  //   2. Compute the rotation that takes that axis direction to the target vector
  //   3. Apply that rotation to the full rotation matrix
  //   4. Extract Euler angles from the result
  //
  // Algorithm (constrained pivot):
  //   1. Project the target vector onto the plane perpendicular to the pivot axis
  //   2. Compute the angle between the current axis direction (projected) and target
  //   3. Rotate around the pivot axis by that angle
  //
  // Inputs:
  //   Rotation - Euler XYZ vector (input rotation)
  //   Factor   - blend factor (float, 0-1)
  //   Vector   - target direction vector
  //
  // Output:
  //   Rotation - aligned Euler XYZ vector

  registry.addNode('geo', 'align_euler_to_vector', {
    label: 'Align Euler to Vector',
    category: 'ROTATION',
    inputs: [
      { name: 'Rotation', type: SocketType.VECTOR },
      { name: 'Factor', type: SocketType.FLOAT },
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Rotation', type: SocketType.VECTOR },
    ],
    defaults: { axis: 'Z', pivot: 'AUTO', factor: 1 },
    props: [
      {
        key: 'axis', label: 'Axis', type: 'select',
        options: [
          { value: 'X', label: 'X' },
          { value: 'Y', label: 'Y' },
          { value: 'Z', label: 'Z' },
        ],
      },
      {
        key: 'pivot', label: 'Pivot Axis', type: 'select',
        options: [
          { value: 'AUTO', label: 'Auto' },
          { value: 'X', label: 'X' },
          { value: 'Y', label: 'Y' },
          { value: 'Z', label: 'Z' },
        ],
      },
      { key: 'factor', label: 'Factor', type: 'float', min: 0, max: 1, step: 0.01 },
    ],
    evaluate(values, inputs) {
      const rotInput = inputs['Rotation'] ?? { x: 0, y: 0, z: 0 };
      const factorInput = inputs['Factor'] ?? values.factor;
      const vecInput = inputs['Vector'] ?? { x: 0, y: 0, z: 1 };

      const axis = values.axis || 'Z';
      const pivot = values.pivot || 'AUTO';

      const rotIsField = isField(rotInput);
      const facIsField = isField(factorInput);
      const vecIsField = isField(vecInput);

      if (!rotIsField && !facIsField && !vecIsField) {
        const result = _alignEulerToVector(rotInput, factorInput, vecInput, axis, pivot);
        return { outputs: [result] };
      }

      const resultField = new Field('vector', (el) => {
        const rot = rotIsField ? rotInput.evaluateAt(el) : rotInput;
        const fac = facIsField ? factorInput.evaluateAt(el) : factorInput;
        const vec = vecIsField ? vecInput.evaluateAt(el) : vecInput;
        return _alignEulerToVector(rot, fac, vec, axis, pivot);
      });

      return { outputs: [resultField] };
    },
  });
}

/**
 * Core alignment algorithm.
 *
 * @param {Object} euler - Input Euler rotation {x, y, z} (radians)
 * @param {number} factor - Blend factor (0 = original, 1 = fully aligned)
 * @param {Object} targetVec - Target direction vector {x, y, z}
 * @param {string} axis - Which local axis to align ('X', 'Y', 'Z')
 * @param {string} pivot - Pivot constraint ('AUTO', 'X', 'Y', 'Z')
 * @returns {Object} Aligned Euler rotation {x, y, z}
 */
function _alignEulerToVector(euler, factor, targetVec, axis, pivot) {
  const target = vecNormalize(targetVec);
  if (vecLength(targetVec) < 0.0001) {
    return { x: euler.x ?? 0, y: euler.y ?? 0, z: euler.z ?? 0 };
  }

  const mat = eulerXYZToMat3(euler.x ?? 0, euler.y ?? 0, euler.z ?? 0);

  // Get the current direction of the specified local axis
  let axisCol;
  switch (axis) {
    case 'X': axisCol = mat.xCol; break;
    case 'Y': axisCol = mat.yCol; break;
    case 'Z': default: axisCol = mat.zCol; break;
  }

  if (pivot === 'AUTO') {
    // Freely rotate to align axis to target vector
    const aligned = _rotateAxisToTarget(mat, axisCol, target, axis);
    const alignedEuler = mat3ToEulerXYZ(aligned.xCol, aligned.yCol, aligned.zCol);

    // Blend with factor
    return {
      x: (euler.x ?? 0) + ((alignedEuler.x - (euler.x ?? 0)) * factor),
      y: (euler.y ?? 0) + ((alignedEuler.y - (euler.y ?? 0)) * factor),
      z: (euler.z ?? 0) + ((alignedEuler.z - (euler.z ?? 0)) * factor),
    };
  }

  // Constrained pivot: rotate only around the specified pivot axis
  const pivotDir = {
    x: pivot === 'X' ? 1 : 0,
    y: pivot === 'Y' ? 1 : 0,
    z: pivot === 'Z' ? 1 : 0,
  };

  // Get the world-space pivot axis direction from the rotation matrix
  const worldPivot = mat3MulVec(mat, pivotDir);

  // Project both the current axis direction and target onto the plane
  // perpendicular to the pivot axis
  const currentProj = _projectToPlane(axisCol, worldPivot);
  const targetProj = _projectToPlane(target, worldPivot);

  if (vecLength(currentProj) < 0.0001 || vecLength(targetProj) < 0.0001) {
    return { x: euler.x ?? 0, y: euler.y ?? 0, z: euler.z ?? 0 };
  }

  const currentNorm = vecNormalize(currentProj);
  const targetNorm = vecNormalize(targetProj);

  // Compute angle between projected vectors
  let angle = Math.acos(Math.max(-1, Math.min(1, vecDot(currentNorm, targetNorm))));
  const crossVec = vecCross(currentNorm, targetNorm);
  if (vecDot(crossVec, worldPivot) < 0) angle = -angle;

  angle *= factor;

  // Apply rotation around pivot axis
  const rotMat = _axisAngleToMat3(worldPivot, angle);
  const newMat = _mat3Mul(rotMat, mat);
  return mat3ToEulerXYZ(newMat.xCol, newMat.yCol, newMat.zCol);
}

/**
 * Rotate a matrix so that `currentAxis` aligns with `target`.
 * Uses the rotation that takes currentAxis to target, applied to the full matrix.
 */
function _rotateAxisToTarget(mat, currentAxis, target, axisName) {
  const currentNorm = vecNormalize(currentAxis);
  const targetNorm = vecNormalize(target);

  const dot = Math.max(-1, Math.min(1, vecDot(currentNorm, targetNorm)));

  // If vectors are already aligned (or anti-aligned)
  if (dot > 0.9999) return mat;
  if (dot < -0.9999) {
    // 180 degree rotation: pick any perpendicular axis
    const perp = Math.abs(currentNorm.x) < 0.9
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 1, z: 0 };
    const rotAxis = vecNormalize(vecCross(currentNorm, perp));
    const rotMat = _axisAngleToMat3(rotAxis, Math.PI);
    return _mat3Mul(rotMat, mat);
  }

  // Rotation axis = cross(current, target), angle = acos(dot)
  const rotAxis = vecNormalize(vecCross(currentNorm, targetNorm));
  const angle = Math.acos(dot);
  const rotMat = _axisAngleToMat3(rotAxis, angle);
  return _mat3Mul(rotMat, mat);
}

/**
 * Project vector onto plane perpendicular to normal.
 */
function _projectToPlane(v, normal) {
  const n = vecNormalize(normal);
  const d = vecDot(v, n);
  return {
    x: v.x - d * n.x,
    y: v.y - d * n.y,
    z: v.z - d * n.z,
  };
}

/**
 * Build a rotation matrix from an axis and angle (Rodrigues' formula).
 *
 * Blender reference: axis_angle_to_mat3 in BLI_math_rotation.h
 */
function _axisAngleToMat3(axis, angle) {
  const n = vecNormalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  return {
    xCol: {
      x: t * n.x * n.x + c,
      y: t * n.x * n.y + s * n.z,
      z: t * n.x * n.z - s * n.y,
    },
    yCol: {
      x: t * n.x * n.y - s * n.z,
      y: t * n.y * n.y + c,
      z: t * n.y * n.z + s * n.x,
    },
    zCol: {
      x: t * n.x * n.z + s * n.y,
      y: t * n.y * n.z - s * n.x,
      z: t * n.z * n.z + c,
    },
  };
}

/**
 * Multiply two 3x3 matrices (each represented as {xCol, yCol, zCol}).
 * Result = A * B
 */
function _mat3Mul(a, b) {
  return {
    xCol: mat3MulVec(a, b.xCol),
    yCol: mat3MulVec(a, b.yCol),
    zCol: mat3MulVec(a, b.zCol),
  };
}
