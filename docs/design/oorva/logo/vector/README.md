# Connected O vector masters

Exact vector versions of the owner-approved Connected O artwork in this folder's parent (`../oorva-symbol.png`, `../oorva-logo-light.png`).

| File | Source | Notes |
|---|---|---|
| `oorva-symbol.svg` | `../oorva-symbol.png` | Symbol only, `#173D39`, tight viewBox |
| `oorva-logo-horizontal-light.svg` | `../oorva-logo-light.png` | Symbol + `oorva` wordmark + tagline, single colour `#173D39` (tagline darkened from the PNG's slate for contrast on ivory) |
| `reference-vs-vector.png` | rendered with `@resvg/resvg-js` 2.6.2 | Left: approved PNG; right: these SVGs |

Provenance: vectorised with potrace 2.1.8 (threshold 140, turdSize 8, optTolerance 0.2) from the owner's own approved Connected O artwork listed in `../manifest.json`. No third-party artwork was used. These are the geometry masters for O01L; dark, mono, stacked and wordmark-only variants are recolours/crops of these paths.

## Drop-in app masters (`app-assets/`)

The nine files in `app-assets/` are the exact doc 18 §A.4.1 SVG masters, with the same names and canvases as `app/assets/brand/`. Copy them there verbatim.

| File | Canvas | Content |
|---|---|---|
| `oorva-symbol.svg` | 256×256 | Symbol, ink fitted to the central 208 square, forest `#173D39` |
| `oorva-wordmark-light.svg` / `-dark.svg` | 1024×256 | Wordmark only (forest / ivory `#F7F5EF`) |
| `logo-horizontal-light.svg` / `-dark.svg` | 1440×400 | Symbol + wordmark in the approved relative placement; no tagline (tagline stays live Inter text) |
| `logo-horizontal-mono-black.svg` / `-mono-ivory.svg` | 1440×400 | Same geometry, `#000000` / `#F7F5EF` |
| `logo-stacked-light.svg` / `-dark.svg` | 720×720 | Symbol centred above wordmark |

Symbol, wordmark and tagline were separated from the traced `../oorva-logo-light.png` by sub-path bounding boxes; the standalone symbol comes from `../oorva-symbol.png`. All are outlined paths only: no raster, font or external reference. `app-assets-contact-sheet.png` shows every variant against the approved PNG, including 48/32/20 px symbol renders.
