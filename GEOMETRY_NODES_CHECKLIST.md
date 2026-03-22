# Geometry Nodes Checklist

> Blender Geometry Nodes (4.4) implementation status. Checked items exist in the v2 modular architecture (`geo/nodes_v2_*.js`) with working `evaluate()` functions operating on real `GeometrySet` data.

---

## Maintenance

**When implementing a node:**
1. Register it in the appropriate `geo/nodes_v2_*.js` module via `registry.addNode('geo', ...)`
2. Ensure it operates on real geometry (`GeometrySet`, `MeshComponent`, `CurveComponent`)
3. Support field inputs where applicable (`isField()` / `resolveField()`)
4. Add a test in `tests/integration/node-pipeline.test.js`
5. Check it off below and update the count

---

## Progress Summary

- **Implemented:** 33 / 248
- **Remaining:** 215
- **Last updated:** 2026-03-18

---

## Output

- [x] Group Output (`output`)
- [ ] Viewer

## Input -- Constant

- [x] Value / Float (`value_float`)
- [x] Integer (`value_int`)
- [x] Vector (`value_vector`)
- [x] Boolean (`value_bool`)
- [ ] Color
- [ ] Rotation
- [ ] String
- [ ] Material
- [ ] Image
- [ ] Special Characters

## Input -- Scene

- [ ] Scene Time
- [ ] Object Info
- [ ] Collection Info
- [ ] Self Object
- [ ] Is Viewport
- [ ] Active Camera
- [ ] Camera Info
- [ ] Image Info

## Input -- Gizmo (4.3+)

- [ ] Dial Gizmo
- [ ] Linear Gizmo
- [ ] Transform Gizmo

## Geometry -- Read

- [x] Position (`position`)
- [x] Normal (`normal`)
- [x] Index (`index`)
- [ ] ID
- [ ] Named Attribute
- [ ] Radius

## Geometry -- Write

- [x] Set Position (`set_position`)
- [ ] Set ID
- [ ] Set Geometry Name

## Geometry -- Sample

- [ ] Geometry Proximity
- [ ] Raycast
- [ ] Sample Index
- [ ] Sample Nearest
- [ ] Index of Nearest

## Geometry -- Operations

- [x] Transform Geometry (`transform_geometry`)
- [x] Join Geometry (`join_geometry`)
- [x] Delete Geometry (`delete_geometry`)
- [ ] Separate Geometry
- [ ] Bounding Box
- [ ] Merge by Distance
- [ ] Convex Hull
- [ ] Duplicate Elements
- [ ] Sort Elements
- [ ] Geometry to Instance
- [ ] Separate Components
- [ ] Split to Instances
- [ ] Bake

## Mesh Primitives

- [x] Cube (`mesh_cube`)
- [x] UV Sphere (`mesh_uv_sphere`)
- [x] Cylinder (`mesh_cylinder`)
- [x] Cone (`mesh_cone`)
- [x] Grid / Plane (`mesh_grid`)
- [x] Ico Sphere (`mesh_ico_sphere`)
- [x] Torus (`mesh_torus`) *(custom, not standard Blender)*
- [ ] Mesh Line
- [ ] Mesh Circle

## Mesh -- Operations

- [ ] Extrude Mesh
- [ ] Subdivision Surface
- [ ] Subdivide Mesh
- [ ] Mesh Boolean
- [ ] Scale Elements
- [ ] Triangulate
- [ ] Dual Mesh
- [ ] Flip Faces
- [ ] Split Edges
- [ ] Mesh to Points
- [ ] Mesh to Curve
- [ ] Mesh to Volume
- [ ] Edge Paths to Curves
- [ ] Edge Paths to Selection
- [ ] Sample Nearest Surface
- [ ] Sample UV Surface

## Mesh -- Read

- [ ] Set Shade Smooth
- [ ] Edge Angle
- [ ] Edge Neighbors
- [ ] Edge Vertices
- [ ] Edges to Face Groups
- [ ] Face Area
- [ ] Face Group Boundaries
- [ ] Face Neighbors
- [ ] Is Edge Smooth
- [ ] Is Face Planar
- [ ] Is Face Smooth
- [ ] Mesh Island
- [ ] Shortest Edge Paths
- [ ] Vertex Neighbors

## Mesh -- Write

- [ ] Set Sharp Edges
- [ ] Set Sharp Faces

## Mesh -- Topology

- [ ] Corners of Edge
- [ ] Corners of Face
- [ ] Corners of Vertex
- [ ] Edge of Corner
- [ ] Edges of Vertex
- [ ] Face of Corner
- [ ] Offset Corner in Face
- [ ] Vertex of Corner

## Mesh -- UV

- [ ] Pack UV Islands
- [ ] UV Unwrap

## Curve -- Primitives

- [x] Curve Circle (`curve_circle`)
- [x] Curve Line (`curve_line`)
- [ ] Spiral
- [ ] Arc
- [ ] Bezier Segment
- [ ] Quadratic Bezier
- [ ] Quadrilateral
- [ ] Star

## Curve -- Operations

- [x] Curve to Mesh (`curve_to_mesh`)
- [x] Resample Curve (`resample_curve`)
- [x] Sample Curve (`sample_curve`)
- [ ] Fill Curve
- [ ] Curve to Points
- [ ] Fillet Curve
- [ ] Trim Curve
- [ ] Reverse Curve
- [ ] Subdivide Curve
- [ ] Deform Curves on Surface
- [ ] Interpolate Curves

## Curve -- Read

- [ ] Curve Handle Positions
- [ ] Curve Length
- [ ] Curve Tangent
- [ ] Curve Tilt
- [ ] Endpoint Selection
- [ ] Handle Type Selection
- [ ] Is Spline Cyclic
- [ ] Spline Length
- [ ] Spline Parameter
- [ ] Spline Resolution

## Curve -- Write

- [ ] Set Curve Normal
- [ ] Set Curve Radius
- [ ] Set Curve Tilt
- [ ] Set Handle Positions
- [ ] Set Handle Type
- [ ] Set Spline Cyclic
- [ ] Set Spline Resolution
- [ ] Set Spline Type

## Curve -- Topology

- [ ] Curve of Point
- [ ] Offset Point in Curve
- [ ] Points of Curve

## Instances

- [x] Instance on Points (`instance_on_points`)
- [x] Realize Instances (`realize_instances`)
- [ ] Rotate Instances
- [ ] Scale Instances
- [ ] Translate Instances
- [ ] Instance Rotation
- [ ] Instance Scale
- [ ] Instance Transform
- [ ] Instances to Points
- [ ] Set Instance Transform

## Point

- [ ] Distribute Points on Faces
- [ ] Distribute Points in Volume
- [ ] Points
- [ ] Points to Curves
- [ ] Points to Vertices
- [ ] Points to Volume
- [ ] Set Point Radius

## Material

- [ ] Set Material
- [ ] Material Index
- [ ] Material Selection
- [ ] Replace Material
- [ ] Set Material Index

## Attribute

- [ ] Capture Attribute
- [ ] Attribute Statistic
- [ ] Domain Size
- [ ] Store Named Attribute
- [ ] Remove Named Attribute
- [ ] Blur Attribute

## Utilities -- Math

- [x] Math (`math`) — 37 operations, field-aware
- [x] Vector Math (`vector_math`) — 26 operations, field-aware
- [ ] Boolean Math
- [x] Clamp (`clamp`)
- [x] Map Range (`map_range`)
- [x] Compare (`compare`)
- [ ] Random Value
- [ ] Mix (Float/Vector/Color)
- [ ] Float Curve
- [ ] Float to Integer
- [ ] Integer Math (4.3+)

## Utilities -- Rotation

- [ ] Align Euler to Vector
- [ ] Align Rotation to Vector
- [ ] Axes to Rotation
- [ ] Axis Angle to Rotation
- [ ] Euler to Rotation
- [ ] Invert Rotation
- [ ] Rotate Rotation
- [ ] Rotate Vector
- [ ] Rotation to Axis Angle
- [ ] Rotation to Euler
- [ ] Rotation to Quaternion
- [ ] Quaternion to Rotation

## Utilities -- Matrix (4.2+)

- [ ] Combine Transform
- [ ] Invert Matrix
- [ ] Matrix Determinant (4.3+)
- [ ] Multiply Matrices
- [ ] Project Point
- [ ] Separate Transform
- [ ] Transform Direction
- [ ] Transform Point
- [ ] Transpose Matrix

## Utilities -- Vector

- [x] Separate XYZ (`separate_xyz`)
- [x] Combine XYZ (`combine_xyz`)
- [ ] Vector Curves
- [ ] Vector Rotate

## Utilities -- Field

- [ ] Accumulate Field
- [ ] Evaluate at Index
- [ ] Evaluate on Domain
- [ ] Interpolate Domain

## Utilities -- General

- [ ] Switch (Geometry)
- [ ] Index Switch
- [ ] Menu Switch
- [ ] Hash Value (4.3+)

## Color

- [ ] Color Ramp
- [ ] Combine Color
- [ ] Mix Color
- [ ] Separate Color

## Texture

- [ ] Noise Texture
- [ ] Voronoi Texture
- [ ] White Noise Texture
- [ ] Brick Texture
- [ ] Checker Texture
- [ ] Gradient Texture
- [ ] Image Texture
- [ ] Magic Texture
- [ ] Wave Texture

## Text

- [ ] String to Curves
- [ ] Join Strings
- [ ] Replace String
- [ ] Slice String
- [ ] String Length
- [ ] Value to String
- [ ] Find in String (4.4+)

## Volume

- [ ] Mesh to Volume
- [ ] Volume Cube
- [ ] Volume to Mesh

## Grease Pencil (4.3+)

- [ ] Curves to Grease Pencil
- [ ] Grease Pencil to Curves
- [ ] Merge Layers
- [ ] Set Grease Pencil Layer

## Simulation / Zones

- [ ] Simulation Zone
- [ ] Repeat Zone
- [ ] For Each Element Zone (4.3+)

## Tool Context (Operator Nodes)

- [ ] 3D Cursor
- [ ] Active Element
- [ ] Face Set
- [ ] Mouse Position
- [ ] Selection
- [ ] Set Face Set
- [ ] Set Selection
- [ ] Viewport Transform
- [ ] Warning (4.3+)

## Group

- [ ] Group Input
- [ ] Node Group (custom/linked)
