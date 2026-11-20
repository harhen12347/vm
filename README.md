# Aether Desktop

## Prism 3D slicer

Open the three-tool launcher at:

- `/` or `http://localhost:3000/` - app launcher
- `/desktop/` - Aether Desktop
- `/cad.html` - CAD Converter
- `/slicer.html` - Prism 3D Slicer

Run the browser tools with:

```bash
npm run dev
```

Open `http://localhost:3000`. The slicer imports STL, OBJ, PLY, AMF, 3MF, DAE, GLTF, and GLB meshes; GLTF
files must embed their buffers and images. It supports object transforms, worker-based contour slicing,
layer previews, estimates, and profile-gated generic G-code export. It does not export FlashForge G/GX,
UltiMaker UFP, G-code gzip, FPP, or 3MF projects. These are deliberately unavailable until their actual
format exporters exist. The native editable project format is `.prism`; 3MF currently imports as mesh data.

The versioned [`src/printer-database.json`](src/printer-database.json) contains 634 visible Cura printer
definitions and nine machine models from the vendor-maintained
[FlashForge/Orca-Flashforge](https://github.com/FlashForge/Orca-Flashforge) profiles. Its total is 645
profiles, including the bundled custom templates. Cura sources come from
[Ultimaker/Cura](https://github.com/Ultimaker/Cura).
Every imported record retains its upstream commit and source URL. Missing facts and unresolved G-code
macros are shown as warnings; profiles with unknown origins, incomplete slicing dimensions, or unsupported
machine-code placeholders cannot be sliced/exported. No bundled printer has been physically tested by
this application. Cura-derived third-party definitions are limited to those in the upstream Cura tree;
the FlashForge set is limited to the models in FlashForge's current public profile bundle.

Profile data is derived from Cura (LGPL-3.0) and FlashForge Orca (AGPL-3.0); see the linked upstream
repositories for their license texts and attribution. The profile data does not include upstream slicer
code.

To refresh the bundled profiles from current upstream checkouts:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/Ultimaker/Cura.git ../Cura
git -C ../Cura sparse-checkout set resources/definitions resources/extruders
npm run import:cura-printers -- ../Cura
git clone --depth 1 --filter=blob:none --sparse https://github.com/FlashForge/Orca-Flashforge.git ../Orca-Flashforge
git -C ../Orca-Flashforge sparse-checkout set resources/profiles
npm run import:flashforge-printers -- ../Orca-Flashforge
```

Users can create, edit, import, and export JSON printer profiles from the Printer tab. Custom profiles are
saved in browser storage; imported machine definitions are read-only and can be copied into a custom
profile. The SLDPRT converter remains at `/cad` (or `/cad.html` on the static site), and the desktop
simulator remains at `/desktop`.

Aether is a Windows 11-inspired desktop **simulator** built with Electron. It opens as a native desktop app and uses Electron's real Chromium engine for web browsing, but it does not boot or emulate a separate operating system.

## Static browser tools

The SLDPRT-to-STL converter runs entirely in your browser. Select or drop up to 50 `.SLDPRT` files
(128 MB each) and download the resulting binary STL files. Your CAD files are not uploaded. GitHub Pages
serves the slicer from the repository root and the converter at `/cad.html`:
[harhen12347.github.io/vm](https://harhen12347.github.io/vm/).

To update the Pages files after editing the converter:

```bash
npm install
npm run publish:web
```

Commit and push the generated root files to publish updates. The full Aether desktop simulator remains
available as an optional local server with `npm run serve`.
To preview the full desktop simulator in a browser, start its optional local server with `npm run serve`.

The Electron native desktop build provides integrated Chromium tabs:

```bash
npm start
```

On Linux, Electron may need the system libraries listed in [Electron's Linux prerequisites](https://www.electronjs.org/docs/latest/tutorial/linux).

`npm run check` checks JavaScript syntax; `npm test` runs the headless virtual-filesystem tests.

## Included

- Boot and sign-in screens, a desktop, Start menu, taskbar, clock, notification panel, power menu, and draggable/minimizable/maximizable app windows.
- File Explorer and Notepad backed by a persistent virtual filesystem. Files are stored in Electron's per-user app-data folder as `aether-files.json`, not in the host filesystem. Desktop, Documents, Downloads, and Pictures are created on first launch.
- Calculator, a drawing canvas that saves and opens PNGs in the virtual Pictures folder, Personalization/System settings, Task Manager, and an App Store catalog of the bundled apps.
- A local CAD Converter that batch-converts up to 50 `.SLDPRT` files to binary STL, with per-file downloads. Files are limited to 128 MB each and are processed on the app host, not uploaded to a third-party service. Conversion uses the [Apache-2.0 `sldprt` project](https://github.com/blussyya/solidworks-converters) and may fail for unsupported or damaged parts.
- A Chromium webview with Google Search, HTTP(S) browsing, navigation controls, and multiple tabs in the Electron build. In the web version, pages open in sandboxed browser tabs inside the desktop; sites that prohibit embedding can be opened in a regular browser with the ↗ button. Internet access requires a network connection.
- Terminal commands for navigating and managing the virtual filesystem. Its `python` command supports arithmetic expressions, simple assignments, and `print(...)`; it is a deliberately small simulator, **not** a system Python interpreter.
- CPU and memory figures read from the host operating system. Restart and shutdown affect the simulated desktop session only; they do not restart or power off the computer.

## What this is not

Aether is not a bootable virtual machine, a host-file manager, or a full operating system. Its desktop apps and filesystem are simulated inside Electron. Web pages run in Chromium, and host CPU/memory information is real. A genuine VM would require an operating-system disk image and a hypervisor such as QEMU/KVM or VirtualBox; neither QEMU nor VirtualBox is installed in the inspected environment.