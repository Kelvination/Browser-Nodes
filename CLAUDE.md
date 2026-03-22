# Ethereal Amber Meadow - Claude Instructions

## Blender Source Code Compliance

**CRITICAL: For every change to this project, you MUST compare it with Blender's actual source code.**

- Do NOT assume any node's functionality, layout, inputs, outputs, or behavior
- Do NOT improvise or make up how something should work
- Always verify against Blender's source code at https://github.com/blender/blender or the Blender manual at https://docs.blender.org/manual/en/latest/
- Key source paths in Blender:
  - Node definitions: `source/blender/nodes/`
  - Geometry nodes: `source/blender/nodes/geometry/nodes/`
  - Function nodes: `source/blender/nodes/function/nodes/`
  - Node drawing: `source/blender/editors/space_node/`
- If you cannot verify something from Blender's source, state that explicitly and ask the user

## Node Layout Rules (verified from Blender)

- Outputs are drawn at the TOP of the node body (sockets on right edge)
- Inputs are drawn BELOW the outputs (sockets on left edge)
- Each input and output gets its own row (they do NOT share rows)
- Order: Header → Outputs → Properties/Dropdowns → Inputs

## Dynamic Nodes

Some nodes have dynamic inputs/outputs based on property values (e.g., Random Value changes sockets based on data_type). Use `getInputs(values)`, `getOutputs(values)`, and `getProps(values)` methods on node definitions for this.
