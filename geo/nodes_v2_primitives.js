/**
 * geo/nodes_v2_primitives.js - Primitive geometry nodes (mesh, curve, input, output).
 */

import { SocketType } from '../core/registry.js';
import {
  GeometrySet,
  CurveComponent,
  createMeshGrid,
  createMeshCube,
  createMeshCylinder,
  createMeshUVSphere,
  createMeshIcoSphere,
  createMeshCone,
  createMeshTorus,
  createCurveLine,
  createCurveCircle,
} from '../core/geometry.js';

export function registerPrimitiveNodes(registry) {
  // ── Categories ──────────────────────────────────────────────────────────
  registry.addCategory('geo', 'MESH_PRIMITIVES', { name: 'Mesh Primitives', color: '#4CAF50', icon: '⬡' });
  registry.addCategory('geo', 'CURVE_PRIMITIVES', { name: 'Curve Primitives', color: '#FFC107', icon: '〰' });
  registry.addCategory('geo', 'INPUT', { name: 'Input', color: '#78909C', icon: '↓' });
  registry.addCategory('geo', 'OUTPUT', { name: 'Output', color: '#EF5350', icon: '↑' });

  // ── Mesh Primitives ─────────────────────────────────────────────────────

  registry.addNode('geo', 'mesh_grid', {
    label: 'Grid',
    category: 'MESH_PRIMITIVES',
    inputs: [
      { name: 'Size X', type: SocketType.FLOAT },
      { name: 'Size Y', type: SocketType.FLOAT },
      { name: 'Vertices X', type: SocketType.INT },
      { name: 'Vertices Y', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
      { name: 'UV Map', type: SocketType.VECTOR },
    ],
    defaults: { sizeX: 1, sizeY: 1, verticesX: 10, verticesY: 10 },
    props: [
      { key: 'sizeX', label: 'Size X', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'sizeY', label: 'Size Y', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'verticesX', label: 'Vertices X', type: 'int', min: 2, max: 100, step: 1 },
      { key: 'verticesY', label: 'Vertices Y', type: 'int', min: 2, max: 100, step: 1 },
    ],
    evaluate(values, inputs) {
      const sizeX = inputs['Size X'] ?? values.sizeX;
      const sizeY = inputs['Size Y'] ?? values.sizeY;
      const verticesX = inputs['Vertices X'] ?? values.verticesX;
      const verticesY = inputs['Vertices Y'] ?? values.verticesY;
      const gs = new GeometrySet();
      gs.mesh = createMeshGrid(sizeX, sizeY, verticesX, verticesY);
      return { outputs: [gs, null] };
    },
  });

  registry.addNode('geo', 'mesh_cube', {
    label: 'Cube',
    category: 'MESH_PRIMITIVES',
    inputs: [
      { name: 'Size X', type: SocketType.FLOAT },
      { name: 'Size Y', type: SocketType.FLOAT },
      { name: 'Size Z', type: SocketType.FLOAT },
      { name: 'Vertices X', type: SocketType.INT },
      { name: 'Vertices Y', type: SocketType.INT },
      { name: 'Vertices Z', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { sizeX: 1, sizeY: 1, sizeZ: 1, verticesX: 2, verticesY: 2, verticesZ: 2 },
    props: [
      { key: 'sizeX', label: 'Size X', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'sizeY', label: 'Size Y', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'sizeZ', label: 'Size Z', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'verticesX', label: 'Vertices X', type: 'int', min: 2, max: 100, step: 1 },
      { key: 'verticesY', label: 'Vertices Y', type: 'int', min: 2, max: 100, step: 1 },
      { key: 'verticesZ', label: 'Vertices Z', type: 'int', min: 2, max: 100, step: 1 },
    ],
    evaluate(values, inputs) {
      const sizeX = inputs['Size X'] ?? values.sizeX;
      const sizeY = inputs['Size Y'] ?? values.sizeY;
      const sizeZ = inputs['Size Z'] ?? values.sizeZ;
      const verticesX = inputs['Vertices X'] ?? values.verticesX;
      const verticesY = inputs['Vertices Y'] ?? values.verticesY;
      const verticesZ = inputs['Vertices Z'] ?? values.verticesZ;
      const gs = new GeometrySet();
      gs.mesh = createMeshCube(sizeX, sizeY, sizeZ, verticesX, verticesY, verticesZ);
      return { outputs: [gs] };
    },
  });

  registry.addNode('geo', 'mesh_cylinder', {
    label: 'Cylinder',
    category: 'MESH_PRIMITIVES',
    inputs: [
      { name: 'Vertices', type: SocketType.INT },
      { name: 'Radius', type: SocketType.FLOAT },
      { name: 'Depth', type: SocketType.FLOAT },
      { name: 'Fill Type', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { vertices: 32, radius: 1, depth: 2, fillType: 'NGON' },
    props: [
      { key: 'vertices', label: 'Vertices', type: 'int', min: 3, max: 128, step: 1 },
      { key: 'radius', label: 'Radius', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'depth', label: 'Depth', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'fillType', label: 'Fill Type', type: 'select', options: ['NGON', 'TRIFAN', 'NONE'] },
    ],
    evaluate(values, inputs) {
      const vertices = inputs['Vertices'] ?? values.vertices;
      const radius = inputs['Radius'] ?? values.radius;
      const depth = inputs['Depth'] ?? values.depth;
      const fillType = inputs['Fill Type'] ?? values.fillType;
      const gs = new GeometrySet();
      gs.mesh = createMeshCylinder(vertices, radius, depth, fillType);
      return { outputs: [gs] };
    },
  });

  registry.addNode('geo', 'mesh_uv_sphere', {
    label: 'UV Sphere',
    category: 'MESH_PRIMITIVES',
    inputs: [
      { name: 'Segments', type: SocketType.INT },
      { name: 'Rings', type: SocketType.INT },
      { name: 'Radius', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { segments: 32, rings: 16, radius: 1 },
    props: [
      { key: 'segments', label: 'Segments', type: 'int', min: 3, max: 128, step: 1 },
      { key: 'rings', label: 'Rings', type: 'int', min: 2, max: 128, step: 1 },
      { key: 'radius', label: 'Radius', type: 'float', min: 0.01, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const segments = inputs['Segments'] ?? values.segments;
      const rings = inputs['Rings'] ?? values.rings;
      const radius = inputs['Radius'] ?? values.radius;
      const gs = new GeometrySet();
      gs.mesh = createMeshUVSphere(segments, rings, radius);
      return { outputs: [gs] };
    },
  });

  registry.addNode('geo', 'mesh_ico_sphere', {
    label: 'Ico Sphere',
    category: 'MESH_PRIMITIVES',
    inputs: [
      { name: 'Subdivisions', type: SocketType.INT },
      { name: 'Radius', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { subdivisions: 2, radius: 1 },
    props: [
      { key: 'subdivisions', label: 'Subdivisions', type: 'int', min: 1, max: 6, step: 1 },
      { key: 'radius', label: 'Radius', type: 'float', min: 0.01, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const subdivisions = inputs['Subdivisions'] ?? values.subdivisions;
      const radius = inputs['Radius'] ?? values.radius;
      const gs = new GeometrySet();
      gs.mesh = createMeshIcoSphere(radius, subdivisions);
      return { outputs: [gs] };
    },
  });

  registry.addNode('geo', 'mesh_cone', {
    label: 'Cone',
    category: 'MESH_PRIMITIVES',
    inputs: [
      { name: 'Vertices', type: SocketType.INT },
      { name: 'Radius Top', type: SocketType.FLOAT },
      { name: 'Radius Bottom', type: SocketType.FLOAT },
      { name: 'Depth', type: SocketType.FLOAT },
      { name: 'Fill Type', type: SocketType.INT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { vertices: 32, radiusTop: 0, radiusBottom: 1, depth: 2, fillType: 'NGON' },
    props: [
      { key: 'vertices', label: 'Vertices', type: 'int', min: 3, max: 128, step: 1 },
      { key: 'radiusTop', label: 'Radius Top', type: 'float', min: 0, max: 100, step: 0.1 },
      { key: 'radiusBottom', label: 'Radius Bottom', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'depth', label: 'Depth', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'fillType', label: 'Fill Type', type: 'select', options: ['NGON', 'TRIFAN', 'NONE'] },
    ],
    evaluate(values, inputs) {
      const vertices = inputs['Vertices'] ?? values.vertices;
      const radiusTop = inputs['Radius Top'] ?? values.radiusTop;
      const radiusBottom = inputs['Radius Bottom'] ?? values.radiusBottom;
      const depth = inputs['Depth'] ?? values.depth;
      const fillType = inputs['Fill Type'] ?? values.fillType;
      const gs = new GeometrySet();
      gs.mesh = createMeshCone(vertices, radiusTop, radiusBottom, depth, fillType);
      return { outputs: [gs] };
    },
  });

  registry.addNode('geo', 'mesh_torus', {
    label: 'Torus',
    category: 'MESH_PRIMITIVES',
    inputs: [
      { name: 'Major Segments', type: SocketType.INT },
      { name: 'Minor Segments', type: SocketType.INT },
      { name: 'Major Radius', type: SocketType.FLOAT },
      { name: 'Minor Radius', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Mesh', type: SocketType.GEOMETRY },
    ],
    defaults: { majorSegments: 48, minorSegments: 12, majorRadius: 1, minorRadius: 0.25 },
    props: [
      { key: 'majorSegments', label: 'Major Segments', type: 'int', min: 3, max: 128, step: 1 },
      { key: 'minorSegments', label: 'Minor Segments', type: 'int', min: 3, max: 128, step: 1 },
      { key: 'majorRadius', label: 'Major Radius', type: 'float', min: 0.01, max: 100, step: 0.1 },
      { key: 'minorRadius', label: 'Minor Radius', type: 'float', min: 0.01, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const majorSegments = inputs['Major Segments'] ?? values.majorSegments;
      const minorSegments = inputs['Minor Segments'] ?? values.minorSegments;
      const majorRadius = inputs['Major Radius'] ?? values.majorRadius;
      const minorRadius = inputs['Minor Radius'] ?? values.minorRadius;
      const gs = new GeometrySet();
      gs.mesh = createMeshTorus(majorSegments, minorSegments, majorRadius, minorRadius);
      return { outputs: [gs] };
    },
  });

  // ── Curve Primitives ────────────────────────────────────────────────────

  registry.addNode('geo', 'curve_line', {
    label: 'Curve Line',
    category: 'CURVE_PRIMITIVES',
    inputs: [
      { name: 'Start', type: SocketType.VECTOR },
      { name: 'End', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { startX: 0, startY: 0, startZ: 0, endX: 0, endY: 0, endZ: 1 },
    props: [
      { key: 'startX', label: 'Start X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'startY', label: 'Start Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'startZ', label: 'Start Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endX', label: 'End X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endY', label: 'End Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endZ', label: 'End Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const startIn = inputs['Start'];
      const endIn = inputs['End'];
      const start = startIn ? { x: startIn.x || 0, y: startIn.y || 0, z: startIn.z || 0 }
        : { x: values.startX, y: values.startY, z: values.startZ };
      const end = endIn ? { x: endIn.x || 0, y: endIn.y || 0, z: endIn.z || 0 }
        : { x: values.endX, y: values.endY, z: values.endZ };
      const gs = new GeometrySet();
      gs.curve = createCurveLine(start, end);
      return { outputs: [gs] };
    },
  });

  registry.addNode('geo', 'curve_circle', {
    label: 'Curve Circle',
    category: 'CURVE_PRIMITIVES',
    inputs: [
      { name: 'Resolution', type: SocketType.INT },
      { name: 'Radius', type: SocketType.FLOAT },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: { resolution: 32, radius: 1 },
    props: [
      { key: 'resolution', label: 'Resolution', type: 'int', min: 3, max: 128, step: 1 },
      { key: 'radius', label: 'Radius', type: 'float', min: 0.01, max: 100, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const resolution = inputs['Resolution'] ?? values.resolution;
      const radius = inputs['Radius'] ?? values.radius;
      const gs = new GeometrySet();
      gs.curve = createCurveCircle(resolution, radius);
      return { outputs: [gs] };
    },
  });

  // ── Bezier Segment ──────────────────────────────────────────────────────
  // Blender ref: node_geo_curve_primitive_bezier_segment.cc
  // Creates a single Bezier segment from start/end positions and handles.

  registry.addNode('geo', 'bezier_segment', {
    label: 'Bezier Segment',
    category: 'CURVE_PRIMITIVES',
    inputs: [
      { name: 'Resolution', type: SocketType.INT },
      { name: 'Start', type: SocketType.VECTOR },
      { name: 'Start Handle', type: SocketType.VECTOR },
      { name: 'End Handle', type: SocketType.VECTOR },
      { name: 'End', type: SocketType.VECTOR },
    ],
    outputs: [
      { name: 'Curve', type: SocketType.GEOMETRY },
    ],
    defaults: {
      mode: 'POSITION', resolution: 16,
      startX: -1, startY: 0, startZ: 0,
      startHandleX: -0.5, startHandleY: 0.5, startHandleZ: 0,
      endHandleX: 0.5, endHandleY: 0.5, endHandleZ: 0,
      endX: 1, endY: 0, endZ: 0,
    },
    props: [
      { key: 'mode', label: 'Mode', type: 'select', options: [
        { value: 'POSITION', label: 'Position' },
        { value: 'OFFSET', label: 'Offset' },
      ]},
      { key: 'resolution', label: 'Resolution', type: 'int', min: 2, max: 256, step: 1 },
      { key: 'startX', label: 'Start X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'startY', label: 'Start Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'startZ', label: 'Start Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'startHandleX', label: 'Start Handle X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'startHandleY', label: 'Start Handle Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'startHandleZ', label: 'Start Handle Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endHandleX', label: 'End Handle X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endHandleY', label: 'End Handle Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endHandleZ', label: 'End Handle Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endX', label: 'End X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endY', label: 'End Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'endZ', label: 'End Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
    ],
    evaluate(values, inputs) {
      const resolution = Math.max(2, inputs['Resolution'] ?? values.resolution);
      const start = inputs['Start'] ?? { x: values.startX, y: values.startY, z: values.startZ };
      const end = inputs['End'] ?? { x: values.endX, y: values.endY, z: values.endZ };
      let startHandle = inputs['Start Handle'] ?? { x: values.startHandleX, y: values.startHandleY, z: values.startHandleZ };
      let endHandle = inputs['End Handle'] ?? { x: values.endHandleX, y: values.endHandleY, z: values.endHandleZ };

      // OFFSET mode: handles are relative to their control point
      if (values.mode === 'OFFSET') {
        startHandle = {
          x: start.x + startHandle.x,
          y: start.y + startHandle.y,
          z: start.z + startHandle.z,
        };
        endHandle = {
          x: end.x + endHandle.x,
          y: end.y + endHandle.y,
          z: end.z + endHandle.z,
        };
      }

      // Sample the cubic Bezier curve
      const positions = [];
      for (let i = 0; i < resolution; i++) {
        const t = i / (resolution - 1);
        const t2 = t * t;
        const t3 = t2 * t;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        positions.push({
          x: mt3 * start.x + 3 * mt2 * t * startHandle.x + 3 * mt * t2 * endHandle.x + t3 * end.x,
          y: mt3 * start.y + 3 * mt2 * t * startHandle.y + 3 * mt * t2 * endHandle.y + t3 * end.y,
          z: mt3 * start.z + 3 * mt2 * t * startHandle.z + 3 * mt * t2 * endHandle.z + t3 * end.z,
        });
      }

      const curve = new CurveComponent();
      curve.splines.push({
        type: 'POLY',
        positions,
        handleLeft: null,
        handleRight: null,
        radii: new Array(positions.length).fill(1),
        tilts: new Array(positions.length).fill(0),
        cyclic: false,
        resolution: 12,
      });

      const gs = new GeometrySet();
      gs.curve = curve;
      return { outputs: [gs] };
    },
  });

  // ── Input Nodes ─────────────────────────────────────────────────────────

  registry.addNode('geo', 'value_float', {
    label: 'Float',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Value', type: SocketType.FLOAT },
    ],
    defaults: { value: 0 },
    props: [
      { key: 'value', label: 'Value', type: 'float', min: -1000, max: 1000, step: 0.1 },
    ],
    evaluate(values) {
      return { outputs: [values.value] };
    },
  });

  registry.addNode('geo', 'value_int', {
    label: 'Integer',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Value', type: SocketType.INT },
    ],
    defaults: { value: 0 },
    props: [
      { key: 'value', label: 'Value', type: 'int', min: -1000, max: 1000, step: 1 },
    ],
    evaluate(values) {
      return { outputs: [values.value] };
    },
  });

  registry.addNode('geo', 'value_vector', {
    label: 'Vector',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Vector', type: SocketType.VECTOR },
    ],
    defaults: { x: 0, y: 0, z: 0 },
    props: [
      { key: 'x', label: 'X', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'y', label: 'Y', type: 'float', min: -1000, max: 1000, step: 0.1 },
      { key: 'z', label: 'Z', type: 'float', min: -1000, max: 1000, step: 0.1 },
    ],
    evaluate(values) {
      return { outputs: [{ x: values.x, y: values.y, z: values.z }] };
    },
  });

  registry.addNode('geo', 'value_bool', {
    label: 'Boolean',
    category: 'INPUT',
    inputs: [],
    outputs: [
      { name: 'Value', type: SocketType.BOOL },
    ],
    defaults: { value: false },
    props: [
      { key: 'value', label: 'Value', type: 'bool' },
    ],
    evaluate(values) {
      return { outputs: [values.value] };
    },
  });

  // ── Group Input Node ────────────────────────────────────────────────────
  //
  // Blender reference: node_group_input in node_group.cc
  //
  // In Blender, the Group Input node provides the inputs to a node group.
  // For a top-level geometry nodes modifier, it provides the mesh of the
  // object the modifier is applied to.
  //
  // In our standalone system (no host object), Group Input outputs an
  // empty geometry by default. This node is singular — only one per graph.
  // Additional typed outputs (Float, Vector, etc.) can be added to match
  // Blender's behavior of exposing group interface sockets.
  //
  // Output:
  //   Geometry - empty GeometrySet (or future: host geometry)

  registry.addNode('geo', 'group_input', {
    label: 'Group Input',
    category: 'INPUT',
    singular: true,
    inputs: [],
    outputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Value 1', type: SocketType.FLOAT },
      { name: 'Value 2', type: SocketType.FLOAT },
      { name: 'Value 3', type: SocketType.FLOAT },
      { name: 'Vector', type: SocketType.VECTOR },
      { name: 'Integer', type: SocketType.INT },
      { name: 'Boolean', type: SocketType.BOOL },
    ],
    defaults: {
      value1: 0, value2: 0, value3: 0,
      vecX: 0, vecY: 0, vecZ: 0,
      intVal: 0, boolVal: false,
    },
    props: [
      { key: 'value1', label: 'Value 1', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'value2', label: 'Value 2', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'value3', label: 'Value 3', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'vecX', label: 'Vector X', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'vecY', label: 'Vector Y', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'vecZ', label: 'Vector Z', type: 'float', min: -10000, max: 10000, step: 0.1 },
      { key: 'intVal', label: 'Integer', type: 'int', min: -10000, max: 10000, step: 1 },
      { key: 'boolVal', label: 'Boolean', type: 'bool' },
    ],
    evaluate(values) {
      return {
        outputs: [
          new GeometrySet(),
          values.value1 ?? 0,
          values.value2 ?? 0,
          values.value3 ?? 0,
          { x: values.vecX ?? 0, y: values.vecY ?? 0, z: values.vecZ ?? 0 },
          values.intVal ?? 0,
          !!values.boolVal,
        ],
      };
    },
  });

  // ── Output Node ─────────────────────────────────────────────────────────

  registry.addNode('geo', 'output', {
    label: 'Group Output',
    category: 'OUTPUT',
    singular: true,
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
    ],
    outputs: [],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      return { outputs: [], geometry: inputs['Geometry'] || null };
    },
  });

  // ── Viewer Node ───────────────────────────────────────────────────────
  //
  // Blender reference: node_geo_viewer.cc
  //
  // The Viewer node displays a geometry (or field evaluated on a geometry)
  // in the viewport as an overlay. It's a terminal node like Group Output
  // but doesn't affect the final output - it's purely for debugging.
  //
  // In Blender, connecting a field to the Value input colors the geometry
  // overlay by that field's value. We support passing the geometry through
  // for display in the 3D viewport.
  //
  // The graph evaluator explicitly finds and evaluates Viewer nodes even
  // though they're not connected to the output path.
  //
  // Inputs:
  //   Geometry - geometry to display
  //   Value    - optional field to color/visualize (stored but not rendered yet)
  //
  // Outputs: (none - terminal node)

  registry.addCategory('geo', 'VIEWER', { name: 'Viewer', color: '#78909C', icon: '👁' });

  registry.addNode('geo', 'viewer', {
    label: 'Viewer',
    category: 'VIEWER',
    inputs: [
      { name: 'Geometry', type: SocketType.GEOMETRY },
      { name: 'Value', type: SocketType.FLOAT },
    ],
    outputs: [],
    defaults: {},
    props: [],
    evaluate(values, inputs) {
      const geo = inputs['Geometry'] || null;
      // viewerGeometry is picked up by the graph evaluator
      return { outputs: [], viewerGeometry: geo };
    },
  });
}
