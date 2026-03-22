# Roadmap

> Iteration plan for the geometry & shader node editor.

---

## Current State (March 2026)

- **33 geometry nodes** implemented with real data model (v2 architecture)
- **41 shader nodes** with GLSL compilation and real-time preview
- **Field evaluation system** working for position, normal, index, math, and consumer nodes
- **113 passing tests** (unit + integration)
- Legacy monolithic `geo/nodes.js` deleted — all geometry nodes live in modular `nodes_v2_*.js` files

---

## Iteration 1: Restore Previously Implemented Nodes

The v2 refactor implemented 33 nodes from scratch with real geometry. The old `geo/nodes.js` had 84 nodes (many with incomplete implementations). Re-implement the 51 missing nodes using the new architecture.

### Priority: High-Use Nodes First

**Mesh Operations** (11 nodes to restore):
- [ ] `extrude_mesh` — requires real topology modification (new faces along normals)
- [ ] `subdivide_mesh` — flat subdivision on real mesh data
- [ ] `subdivision_surface` — Catmull-Clark on real mesh data
- [ ] `triangulate` — convert quads/ngons to triangles
- [ ] `scale_elements` — per-face/edge centroid-relative scaling
- [ ] `flip_faces` — reverse winding order
- [ ] `split_edges` — edge splitting with field selection
- [ ] `merge_by_distance` — vertex welding by distance threshold
- [ ] `mesh_boolean` — CSG operations (needs external library or custom impl)
- [ ] `dual_mesh` — face-to-vertex dual with boundary handling
- [ ] `mesh_to_points` — extract points from mesh elements

**Curve Primitives** (3 nodes):
- [ ] `curve_spiral` — 3D spiral with radius/height parameters
- [ ] `curve_arc` — radius and 3-point modes
- [ ] `curve_star` — alternating inner/outer radius

**Curve Operations** (5 nodes):
- [ ] `fill_curve` — triangulate curve interior
- [ ] `curve_to_points` — sample points along curve with tangent/normal outputs
- [ ] `fillet_curve` — round corners (poly mode)
- [ ] `trim_curve` — cut curve by factor/length range
- [ ] `reverse_curve` — reverse control point order

**Instance Operations** (3 nodes):
- [ ] `rotate_instances` — apply rotation to instance transforms
- [ ] `scale_instances` — apply scale to instance transforms
- [ ] `translate_instances` — apply translation to instance transforms

**Input/Utility** (6 nodes):
- [ ] `viewer` — pass-through for debugging
- [ ] `scene_time` — seconds/frame outputs
- [ ] `random_value` — per-element random with seed
- [ ] `boolean_math` — AND/OR/NOT/XOR
- [ ] `switch` — geometry switch on boolean
- [ ] `mesh_line` — line of vertices

**Geometry Read** (6 nodes):
- [ ] `edge_angle` — per-edge dihedral angle field
- [ ] `edge_neighbors` — per-edge face count field
- [ ] `face_area` — per-face area field
- [ ] `face_neighbors` — per-face neighbor count field
- [ ] `vertex_neighbors` — per-vertex neighbor count field
- [ ] `distribute_points_on_faces` — area-weighted point scattering

**Material/Color** (5 nodes):
- [ ] `set_material` — apply material properties
- [ ] `noise_texture` — Perlin noise with octaves
- [ ] `voronoi_texture` — cell noise with distance metrics
- [ ] `white_noise` — hash-based random
- [ ] `color_ramp` — gradient mapping

### Approach

Each restored node should:
1. Operate on real `GeometrySet` data (not descriptors)
2. Support field inputs where applicable (use `isField()` / `resolveField()`)
3. Have at least one test in `tests/integration/`
4. Be registered in the appropriate `nodes_v2_*.js` module

### When to Create New Modules

If a category grows beyond ~15 nodes, split it. Candidates:
- `nodes_v2_mesh_ops.js` — mesh-specific operations (extrude, subdivide, boolean, etc.)
- `nodes_v2_textures.js` — noise, voronoi, gradients, etc.

---

## Iteration 2: Mesh Topology Operations

The hardest nodes require real topology modification — adding/removing vertices, edges, and faces while maintaining consistency.

### Core Infrastructure

- [ ] Edge adjacency data structure (half-edge or edge-face map)
- [ ] Robust face triangulation (ear clipping or CDT for concave polygons)
- [ ] Vertex merging with attribute interpolation

### Topology Nodes

- [ ] `extrude_mesh` — face/edge/vertex extrusion with proper side face generation
- [ ] `mesh_boolean` — CSG union/intersection/difference (consider csg.js or custom BSP)
- [ ] `subdivide_mesh` — flat topology split (midpoint insertion)
- [ ] `subdivision_surface` — Catmull-Clark smooth subdivision
- [ ] `bevel` — edge beveling (not yet in checklist, common request)

---

## Iteration 3: Complete Field System

Extend field evaluation to all domains and node types.

### Field Improvements

- [ ] Per-face field evaluation (face domain elements)
- [ ] Per-edge field evaluation (edge domain elements)
- [ ] Per-spline field evaluation (spline domain elements)
- [ ] Field-based attribute capture (`capture_attribute` node)
- [ ] `accumulate_field` — prefix sum with group support
- [ ] `evaluate_at_index` — sample field at specific element
- [ ] Domain interpolation (point ↔ face ↔ corner)

### Attribute System

- [ ] Named attribute storage and retrieval
- [ ] `store_named_attribute` / `remove_named_attribute` nodes
- [ ] Attribute transfer between domains
- [ ] UV coordinate attributes (per-corner FLOAT2)

---

## Iteration 4: Advanced Curve & Instance Support

### Curves

- [ ] Bezier curve evaluation with handle types
- [ ] NURBS curve support
- [ ] `subdivide_curve` — add control points
- [ ] `set_curve_radius` / `set_curve_tilt` — per-point attributes
- [ ] `set_spline_cyclic` / `set_spline_resolution`
- [ ] Curve topology nodes (curve_of_point, points_of_curve, etc.)

### Instances

- [ ] Instance rotation/scale/transform read nodes
- [ ] `instances_to_points` — extract instance positions
- [ ] Nested instance support
- [ ] Per-instance attribute propagation on realize

---

## Iteration 5: Shader System Improvements

### Missing Shader Nodes

- [ ] Additional blend modes for mix_color (18+ Blender modes)
- [ ] RGB Curves with interactive curve editor
- [ ] Volume shader support
- [ ] Displacement output on Material Output
- [ ] SSS approximation

### Shader Quality

- [ ] Improved PBR (full Cook-Torrance BRDF)
- [ ] Environment mapping / IBL
- [ ] Shadow mapping
- [ ] Multi-light support
- [ ] Normal map tangent space computation

---

## Iteration 6: Editor UX

### Graph Editor

- [ ] Node group support (encapsulate subgraphs)
- [ ] Reroute nodes
- [ ] Frame/comment nodes
- [ ] Copy/paste nodes
- [ ] Node search with fuzzy matching
- [ ] Multi-select drag

### Viewport

- [ ] Wireframe overlay toggle
- [ ] Vertex/edge/face count display
- [ ] Selection highlighting
- [ ] Multiple object support
- [ ] Grid snapping

### General

- [ ] Export to glTF/OBJ
- [ ] Import geometry
- [ ] Undo visualization (undo tree)
- [ ] Performance profiling overlay

---

## Non-Goals

These are explicitly out of scope:
- Full Blender feature parity (248 geometry nodes, 94 shader nodes)
- Physics simulation
- Animation system / keyframes
- Multi-user collaboration
- Server-side rendering
