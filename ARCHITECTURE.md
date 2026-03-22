# Architecture

> Technical reference for the ethereal-amber-meadow geometry & shader node editor.

---

## System Overview

A Blender-inspired node-based editor for geometry and shader graphs, running entirely in the browser. Geometry nodes operate on real mesh/curve/instance data (not descriptors). Shader nodes compile to GLSL for real-time preview.

```
User edits graph (ui/renderer.js)
  ↓
NodeGraph.evaluate() walks dependency tree (core/graph.js)
  ↓
Each node calls evaluate(values, inputs) from registry (core/registry.js)
  ↓
Geometry nodes produce GeometrySet objects (core/geometry.js)
  Fields evaluate lazily per-element (core/field.js)
  ↓
converter.js converts GeometrySet → Three.js objects
  ↓
viewport.js renders in 3D
```

---

## Module Map

```
core/
  registry.js      Node type registry (singleton). Holds all node definitions keyed by graph type.
  graph.js         Generic graph model: nodes, connections, evaluation, undo, serialization.
  field.js         Lazy per-element field evaluation. Position/Normal/Index fields, composition helpers.
  geometry.js      Real geometry: GeometrySet, MeshComponent, CurveComponent, InstancesComponent.
                   Also contains primitive factory functions (createMeshCube, createCurveCircle, etc.)
  utils.js         Noise functions (Perlin, Voronoi, value), seeded PRNG, interpolation.

geo/
  nodes_v2_primitives.js    14 nodes: mesh/curve primitives, value inputs, output
  nodes_v2_operations.js     6 nodes: set_position, transform, delete, join, instances
  nodes_v2_fields.js        10 nodes: position/normal/index fields, math, vector_math, map_range, compare, clamp
  nodes_v2_curves.js         3 nodes: resample_curve, sample_curve, curve_to_mesh
  builders.js               Legacy Three.js geometry builder (used by old pipeline, not by v2 nodes)
  converter.js              GeometrySet → Three.js conversion (the ONLY Three.js touchpoint for geometry)

shader/
  nodes.js                  All shader node definitions (auto-registers on import)
  compiler.js               Shader graph → GLSL (PBR-lite with Fresnel, GGX)
  preview.js                Real-time WebGL preview with orbit camera

ui/
  renderer.js               2D graph canvas: node drawing, connections, selection, pan/zoom
  viewport.js               3D viewport: Three.js scene, camera, grid, geometry rendering

tests/
  unit/                     Tests for registry, field, geometry, graph modules
  integration/              Full pipeline tests: node registration → evaluation → output
```

---

## Core Concepts

### GeometrySet

Top-level container matching Blender's `GeometrySet`. Can hold mesh, curve, and instances simultaneously.

```
GeometrySet
  ├── MeshComponent    positions[], edges[], faceVertCounts[], cornerVerts[]
  │                    + per-domain AttributeMaps (point, edge, face, corner)
  ├── CurveComponent   splines[] with positions, radii, tilts, cyclic flag
  │                    + per-domain AttributeMaps (curve_point, spline)
  └── InstancesComponent  transforms[] + references[] to source geometry
```

Methods: `copy()`, `join(other)`, `domainSize(domain)`, `buildElements(domain)`.

### Fields

Fields are lazy per-element data producers (matching Blender's field system). Instead of returning a single value, field-producing nodes return a `Field` object that evaluates per-element when consumed.

**Producers:** `position`, `normal`, `index` nodes return Fields.
**Propagators:** `math`, `vector_math`, `compare`, `clamp`, `map_range` detect Field inputs and return Fields.
**Consumers:** `set_position`, `delete_geometry` call `resolveField()` to evaluate per-element.

```javascript
// A Field wraps a per-element function
const f = new Field('float', (element) => element.index * 2);
f.evaluateAt({ index: 5, count: 10, position: {...}, normal: {...} }); // → 10
f.evaluateAll(elements); // → [0, 2, 4, 6, ...]
```

### Node Definition Structure

Every node registered via `registry.addNode(graphType, nodeId, def)` must provide:

```javascript
{
  label: 'Human Name',
  category: 'CATEGORY_ID',
  inputs: [{ name: 'Input Name', type: SocketType.FLOAT }],
  outputs: [{ name: 'Output Name', type: SocketType.GEOMETRY }],
  defaults: { key: defaultValue },
  props: [{ key: 'key', label: 'Label', type: 'float|int|bool|select', ... }],
  evaluate(values, inputs) {
    // values = node's own property values (from defaults + user edits)
    // inputs = connected upstream outputs, keyed by input socket name
    return { outputs: [result1, result2, ...] };
  }
}
```

---

## Registered Geometry Nodes (33 total)

### Primitives (`nodes_v2_primitives.js`)

| Node ID | Label | Inputs | Outputs |
|---------|-------|--------|---------|
| `mesh_grid` | Grid | Size X/Y, Vertices X/Y | Geometry |
| `mesh_cube` | Cube | Size X/Y/Z, Vertices X/Y/Z | Geometry |
| `mesh_cylinder` | Cylinder | Vertices, Radius, Depth, Fill Type | Geometry |
| `mesh_uv_sphere` | UV Sphere | Segments, Rings, Radius | Geometry |
| `mesh_ico_sphere` | Ico Sphere | Radius, Subdivisions | Geometry |
| `mesh_cone` | Cone | Vertices, Radius Top/Bottom, Depth, Fill | Geometry |
| `mesh_torus` | Torus | Major/Minor Segments, Major/Minor Radius | Geometry |
| `curve_line` | Curve Line | Start, End (vectors) | Geometry |
| `curve_circle` | Curve Circle | Resolution, Radius | Geometry |
| `value_float` | Float | — | Float |
| `value_int` | Integer | — | Int |
| `value_vector` | Vector | — | Vector |
| `value_bool` | Boolean | — | Bool |
| `output` | Group Output | Geometry | — |

### Operations (`nodes_v2_operations.js`)

| Node ID | Label | Key Behavior |
|---------|-------|-------------|
| `set_position` | Set Position | Field-based per-vertex position + offset |
| `transform_geometry` | Transform | TRS with Euler rotation on real geometry |
| `delete_geometry` | Delete Geometry | Field-based per-element deletion by domain |
| `join_geometry` | Join Geometry | Merges two GeometrySets |
| `instance_on_points` | Instance on Points | Creates instances at point positions |
| `realize_instances` | Realize Instances | Bakes instances into real geometry |

### Fields & Math (`nodes_v2_fields.js`)

| Node ID | Label | Key Behavior |
|---------|-------|-------------|
| `position` | Position | Returns per-vertex position Field |
| `normal` | Normal | Returns per-vertex normal Field |
| `index` | Index | Returns per-element index Field |
| `separate_xyz` | Separate XYZ | Vector → X, Y, Z (field-aware) |
| `combine_xyz` | Combine XYZ | X, Y, Z → Vector (field-aware) |
| `math` | Math | 37 operations, 3 inputs, clamp option, field-aware |
| `vector_math` | Vector Math | 26 operations, dual output (vector + float), field-aware |
| `map_range` | Map Range | LINEAR/STEPPED/SMOOTH/SMOOTHER, clamp, field-aware |
| `compare` | Compare | 6 comparison ops with threshold, field-aware |
| `clamp` | Clamp | MINMAX/RANGE modes, field-aware |

### Curves (`nodes_v2_curves.js`)

| Node ID | Label | Key Behavior |
|---------|-------|-------------|
| `resample_curve` | Resample Curve | COUNT or LENGTH mode, replaces control points |
| `sample_curve` | Sample Curve | FACTOR or LENGTH mode, returns position/tangent/normal |
| `curve_to_mesh` | Curve to Mesh | Frenet frame sweep with profile, cap filling |

---

## Development Practices

### Adding a New Geometry Node

1. Choose the correct module: primitives, operations, fields, or curves.
2. Register via `registry.addNode('geo', 'node_id', { ... })`.
3. Return `GeometrySet` for geometry outputs, `Field` for field outputs.
4. If any input could be a Field, use `isField()` / `resolveField()` from `core/field.js`.
5. Add a test in `tests/integration/node-pipeline.test.js`.
6. Update `GEOMETRY_NODES_CHECKLIST.md`.

### Testing

```bash
npm test                  # All tests (113 tests)
npm run test:unit         # Unit tests only (registry, field, geometry, graph)
npm run test:integration  # Integration tests only (full pipeline)
```

Tests use Node.js built-in test runner (`node:test`). No external dependencies.

### Key Rules

- Geometry nodes operate on **real data** — actual vertex positions, spline control points, face indices.
- Field nodes return **lazy Field objects**, not evaluated values.
- Three.js is ONLY used in `geo/converter.js` and `ui/viewport.js` — never in node logic.
- The `output` node is **singular** (only one per graph).
- Node `evaluate()` receives `values` (own properties) and `inputs` (connected upstream outputs keyed by socket name).

---

## Shader System

41 shader nodes registered in `shader/nodes.js`, compiled to GLSL by `shader/compiler.js`.

Key nodes: `principled_bsdf`, `emission`, `mix_shader`, `noise_texture_shader`, `voronoi_texture_shader`, `shader_output`.

The shader pipeline is independent from geometry — it has its own graph, evaluation, and rendering path.

---

## Socket Types & Colors

| Type | Color | Coercions |
|------|-------|-----------|
| `geometry` | `#69f0ae` | None |
| `float` | `#90a4ae` | ↔ int, → bool |
| `int` | `#4fc3f7` | ↔ float, → bool |
| `vector` | `#7c4dff` | None |
| `bool` | `#ffab40` | → float, → int |
| `color` | `#ffd54f` | None |
| `shader` | `#4caf50` | None |
