# Asset sources and licenses

Bike/rider meshes, stadium architecture, terrain, soft dust, jersey/helmet graphics, number plates, signage, minimaps and synthesized audio were created procedurally for this project. Four active original AI-generated raster textures supply sky, clay surface, audience detail and jersey fabric height. They require no purchased assets, asset server, account or third-party API. The supplied concept PNGs were used as visual references only and are not included as game assets or gameplay evidence.

- **Barlow / Barlow Condensed**: The Barlow Project Authors, copyright 2017. SIL Open Font License 1.1. Source: https://github.com/jpt/barlow . Bundled locally through `@fontsource/barlow@5.3.0` and `@fontsource/barlow-condensed@5.3.0`. Full notice: `public/licenses/Barlow-OFL.txt` (also copied into the production build).
- **Three.js**: Three.js authors, MIT. Source: https://github.com/mrdoob/three . Version 0.186.1. Full notice: `public/licenses/Three-MIT.txt`.
- Build/test tooling (Vite, TypeScript, tsx) remains subject to the license files in the pinned npm packages.

The fictional Afterglow title and stadium signage are original presentation elements. No motorcycle manufacturer branding or licensed rider likenesses are used.

## Original generated textures

Generated specifically for this project with the built-in image-generation tool on 21 October 2026:

- `public/art/dusk-sky-v3.png` — cooler dusk panorama (v2 retained for comparison) mapped onto the stadium sky dome.
- `public/art/dirt-clay-v2.png` — granular clay albedo and bump detail, tinted for each circuit.
- `public/art/crowd-v2.png` — audience texture mapped onto individual stepped seating rows behind 3D railings.

No external runtime requests are required. Full generation prompts and returned dimensions are in `output/art-review/prompts.md`. The audience uses textures, not individually animated human models. None of these textures is a supplied concept screenshot.

The v3 sky is an image-generation edit of v2, color-matched against the supplied stylized concept. Its original is `exec-7f71735f-e6db-4d05-b945-869a869e0c06.png` under the generated-images directory documented in the prompt log. New event screen graphics, cloth/pants/boot textures and sculpted plastics are code-generated.

On 22 October 2026, `public/art/jersey-height-v1.png` was generated with the built-in image tool and applied as a shared fabric bump map to the jersey and sleeves. The 1254 × 1254 original, prompt and provenance are recorded in `output/art-review/prompts.md`. It is a material texture, not a replacement gameplay image.
