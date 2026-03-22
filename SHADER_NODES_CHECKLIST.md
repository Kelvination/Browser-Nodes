# Shader Nodes Checklist

> Blender Shader Nodes (4.4) implementation status. Checked items are registered in `shader/nodes.js` with working `evaluate()` functions that produce GLSL output via `shader/compiler.js`.

---

## Maintenance

**When implementing a node:**
1. Register it in `shader/nodes.js` via `registry.addNodes('shader', { ... })`
2. Ensure `evaluate()` returns a shader descriptor compatible with `shader/compiler.js`
3. Add the node to the shader graph category if needed
4. Check it off below and update the count

---

## Progress Summary

<!-- UPDATE THESE COUNTS AFTER EVERY SESSION -->
- **Implemented:** 41 / 94
- **Remaining:** 53
- **Last updated:** 2026-02-10

---

## Output

- [x] Material Output (as `shader_output`)
- [ ] World Output
- [ ] Light Output
- [ ] AOV Output

## Shader (BSDFs & Materials)

- [x] Principled BSDF (partial -- Base Color, Metallic, Roughness, Normal inputs)
- [x] Emission
- [x] Mix Shader
- [x] Diffuse BSDF (as `diffuse_bsdf`)
- [x] Glossy BSDF (as `glossy_bsdf`)
- [x] Glass BSDF (as `glass_bsdf`)
- [x] Transparent BSDF (as `transparent_bsdf`)
- [x] Translucent BSDF (as `translucent_bsdf`)
- [ ] Subsurface Scattering
- [ ] Refraction BSDF
- [x] Add Shader (as `add_shader`)
- [ ] Principled Volume
- [ ] Volume Absorption
- [ ] Volume Scatter
- [ ] Toon BSDF
- [ ] Hair BSDF
- [ ] Principled Hair BSDF
- [x] Holdout (as `holdout`)
- [x] Background (as `background`)
- [ ] Sheen BSDF (4.0+)
- [ ] Metallic BSDF (4.3+)
- [ ] Ray Portal BSDF (4.2+)
- [ ] Specular BSDF (EEVEE legacy)

## Input

- [x] Fresnel
- [x] Texture Coordinate
- [x] Color (as `color_value`)
- [x] Value (Float) (as `shader_value`)
- [ ] Attribute
- [x] Geometry (as `shader_geometry`)
- [ ] Object Info
- [ ] Camera Data
- [x] Light Path (as `light_path`)
- [x] Layer Weight (as `layer_weight`)
- [ ] UV Map
- [ ] Tangent
- [ ] Wireframe
- [ ] Ambient Occlusion
- [ ] Bevel
- [ ] Color Attribute
- [ ] Curves Info (Hair Info)
- [ ] Particle Info
- [ ] Point Info
- [ ] Volume Info

## Texture

- [x] Noise Texture (as `noise_texture_shader`)
- [x] Voronoi Texture (as `voronoi_texture_shader`)
- [ ] Image Texture
- [ ] Environment Texture
- [x] Checker Texture (as `checker_texture_shader`)
- [x] Gradient Texture (as `gradient_texture_shader`)
- [x] Brick Texture (as `brick_texture_shader`)
- [x] Wave Texture (as `wave_texture_shader`)
- [x] Magic Texture (as `magic_texture_shader`)
- [x] White Noise Texture (as `white_noise_texture_shader`)
- [ ] Sky Texture
- [ ] IES Texture
- [ ] Point Density
- [ ] Gabor Texture (4.2+)

## Color

- [x] Mix Color
- [ ] RGB Curves
- [x] Hue/Saturation/Value (as `hue_saturation_value`)
- [x] Brightness/Contrast (as `brightness_contrast`)
- [x] Gamma (as `gamma`)
- [x] Invert Color (as `invert_color`)
- [ ] Light Falloff

## Vector

- [x] Mapping
- [x] Normal Map (as `normal_map`)
- [x] Bump (as `bump`)
- [ ] Displacement
- [ ] Normal
- [ ] Vector Curves
- [ ] Vector Rotate
- [ ] Vector Transform
- [ ] Vector Displacement

## Converter

- [x] Math (as `shader_math` -- same operations as geo Math)
- [x] Vector Math (as `shader_vector_math` -- same operations as geo Vector Math)
- [x] Color Ramp
- [x] Separate Color
- [x] Combine Color
- [x] Combine XYZ (as `shader_combine_xyz`)
- [ ] Separate XYZ
- [ ] Map Range
- [ ] Clamp
- [ ] Mix (Float/Vector/Color)
- [ ] Float Curve
- [ ] RGB to BW
- [ ] Shader to RGB
- [ ] Blackbody
- [ ] Wavelength

## Script

- [ ] Script Node (OSL -- Cycles only)

## Group

- [ ] Group Input
- [ ] Group Output
- [ ] Node Group (custom/linked)

