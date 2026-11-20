# Prism Slicer Repair Note

## Changes

- Replaced the active approximate slicer path with CuraEngine WebAssembly. Engine errors stop the slice; they do not fall back to the old contour worker.
- Added a Cura adapter for transformed mesh serialization, printer/print-setting overrides, G-code validation and layer preview parsing, plus time and filament metadata.
- Corrected the former worker's print-time unit conversion and added regression tests for estimates, solid skins, retraction, profile limits, and relative extrusion.
- Added X/Y/Z rotation controls, world-space build-plate placement after transforms, and rotation persistence in Prism projects.
- Fixed Cura definition resolution for nested inherited settings and conditional G-code. Unsupported profiles/templates remain unavailable instead of being assigned guessed compatibility.
- Enabled Cura support generation through the existing support control. Printer format choices remain limited to implemented G-code export.

## Verification

- `npm install`
- `npm test` (30 tests passed)
- `npm run check`
- `npm run build:web`
- `npm run publish:web`
- Chromium workflow tested STL and OBJ import, selection, movement, rotation, printer selection, Cura slicing, layer preview, and G-code download. 3MF import and rotated build-plate placement were also tested. No browser console errors were observed.

## Limits

- This CuraEngine WASM package is based on an older CuraEngine build. The adapter currently enables one-extruder rectangular-bed profiles with supported firmware flavors and resolved required G-code; other profiles remain searchable but cannot be sliced.
- No physical printer test has been performed. Verify generated G-code before printing.
- G/GX, UFP, GZ, FPP, and 3MF project export are not implemented and are not offered.
- `npm audit` reports three moderate transitive advisories in `@toybox-labs/cura-wasm` through deprecated `unified-3d-loader` / `fast-xml-parser`; npm reports no automatic fix.
