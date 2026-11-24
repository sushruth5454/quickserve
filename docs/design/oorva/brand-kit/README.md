# Oorva — ready-to-use D brand kit

**Use these real files. Do not ask an implementing model to draw, trace or invent the logo.**
The existing selected Connected O and lowercase wordmark paths are retained exactly.
Only approved D colours and explicit export canvases/transforms are applied.

| Placement | Foreground | Background |
|---|---|---|
| Light in-app logo | #006D77 | White #FFFFFF |
| Dark in-app logo | #80D4D4 | #0C1B21 |
| App icon/adaptive foreground | White #FFFFFF | #006D77 |
| Monochrome | Pure black or pure white | Appropriate contrasting surface |

## What is supplied

- Genuine outlined SVG: symbol, wordmark-only, horizontal and stacked lockups; light/dark/black/white variants.
- Transparent PNG exports at @1x/@2x/@3x. Horizontal 360×100; wordmark 256×64; stacked 240×240; compact 32×32 base canvases.
- Native 1024×1024 opaque app icon, separate adaptive foreground/background/monochrome, transparent light/dark splash artwork.
- White-alpha-only 96×96 notification icon; 48×48 favicon and optional multi-resolution ICO.
- Exact launch image geometry/background data and a merge-only native config fragment.
- Four ready binding records/TypeScript declaration; per-file SHA256, alpha/canvas/profile and destination mapping.
- Light/dark preview boards and 1800 ms motion-reference GIFs. GIFs are **reference only**, not a splash movie to ship.

`manifest.json.requiredExistingContract` identifies the existing app's 9 SVG + 26 PNG paths.
Additional variants are optional, not new runtime dependencies.
`logo-horizontal-mono-ivory.svg` is a compatibility filename containing pure white in D;
`logo-horizontal-mono-white.svg` is the clearer canonical white name.

## Exact import procedure — current stage owners only

1. Read the updated doc 18/19 handoff and acquire the existing O01L/O01X/O05B file locks.
   If those stages already shipped, apply a narrow D adoption delta; do not reset/replay unrelated work.
   The coordinator verifies this kit's hashes/approval and records D03a/b as satisfied input gates;
   no further drawing or creative-choice approval is needed. Public/native release gates remain separate.
2. Verify each required bundle record's file hash against `manifest.json`.
   Copy only records where group=bundle AND requiredForExistingAppContract=true to their exact target.
   Do not bulk-copy every folder over the application.
3. Use `handoff/vector-provenance.json` and `supplied-export-manifest.json` as evidence.
   Preserve the actual application validation-manifest schema; do not overwrite it with a different schema.
4. Bind the four exact ready image paths/hashes from `handoff/binding-data.json`.
   `handoff/selected-brand-exports.ts.txt` supplies the exact declaration shape.
   If a maintainer re-encodes PNGs, update all affected hashes atomically.
5. O37A alone adopts the approved D palette/profile in its owned asset-tool assertions.
   O01X consumes that tested tooling SHA and edits only its own exports/manifest, not O37A's scripts.
   The current main exporter is hard-coded to forest/ivory; **no current resvg/Codespace/CI PASS is claimed**.
   Do not falsify renderer metadata, weaken safety tests or hand-draw artwork.
6. Only the native owner may copy group=native records to installed-app destinations.
   Merge `handoff/native-config-fragment.json` fields; never replace app IDs, scheme or unrelated plugins.
   Use `bundle/app/assets/brand/launch-geometry.json` for identical native/first-JS image canvas.
7. Run the existing targeted validation and approved private candidate checks before integration/activation.
   Brand/parent/OFF paths, public-rights and native/runtime release gates remain unchanged.

This kit has actual artifact verification, not application/native-device verification.
It authorizes no feature activation, production deployment, historical data edit or new legal claim.
Public trademark/asset clearance remains separate.
