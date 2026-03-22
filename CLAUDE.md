# Browser-Nodes (Ethereal Amber Meadow) - Claude Instructions

## Project Overview

A browser-based Blender Geometry Nodes editor. This is a static HTML/CSS/JS site — `index.html` is the entry point. No build step required.

- **Run tests**: `npm test` (uses Node.js built-in test runner)
- **Run unit tests only**: `npm run test:unit`
- **Run integration tests only**: `npm run test:integration`
- **Serve locally**: Any static file server (e.g., `python -m http.server 8000`)

## Deployment

Deployed to GitHub Pages automatically on merge to `main` via `.github/workflows/deploy.yml`.

## Repository Structure

```
├── core/          # Core modules: field, geometry, graph, registry, utils
├── geo/           # Geometry node implementations (v2 primitives, operations, curves, etc.)
├── shader/        # Shader system: compiler, nodes, preview
├── ui/            # UI components: renderer, viewport
├── tests/         # Unit and integration tests
├── app.js         # Main application controller
├── index.html     # Entry point
├── style.css      # Dark-themed editor styles
└── package.json   # Test scripts (no dependencies)
```

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
  - Math utilities: `source/blender/blenlib/BLI_math_*.h`
  - Geometry types: `source/blender/blenkernel/intern/geometry_component_*.cc`
- If you cannot verify something from Blender's source, state that explicitly and ask the user

## Node Layout Rules (verified from Blender)

- Outputs are drawn at the TOP of the node body (sockets on right edge)
- Inputs are drawn BELOW the outputs (sockets on left edge)
- Each input and output gets its own row (they do NOT share rows)
- Order: Header → Outputs → Properties/Dropdowns → Inputs
- Nodes with mode dropdowns show/hide sockets based on the selected mode; hidden sockets keep their index but aren't drawn
- When a mode changes the output type (e.g., Random Value Float→Vector), the output socket type actually changes

## Dynamic Nodes

Some nodes have dynamic inputs/outputs based on property values (e.g., Random Value changes sockets based on data_type). Use `getInputs(values)`, `getOutputs(values)`, and `getProps(values)` methods on node definitions for this.

## Field Evaluation

Fields are lazy per-element functions evaluated against domain elements.

## Response Format

At the end of every response, provide a link to create a new PR for the current branch. Use this format:

```
[Create PR](https://github.com/Kelvination/Browser-Nodes/compare/<branch-name>?expand=1)
```

Replace `<branch-name>` with the actual branch you're working on.

