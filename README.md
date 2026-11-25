# Aether Browser VM

Aether runs a real Ubuntu Desktop virtual machine on a Linux host and streams its display to Chrome using
QEMU VNC over WebSockets and noVNC. The browser client is React + TypeScript with Tailwind CSS; Node.js
manages the VM and shared files. The guest has its own persistent virtual disk, GNOME desktop, Firefox,
terminal, file manager, text editor, calculator, settings, and application launcher.

## Run the browser VM

The browser VM is at `/`. Existing tools remain available at:

- `/desktop/` - Aether Desktop
- `/cad.html` - CAD Converter
- `/slicer.html` - Prism 3D Slicer
- `/printer-config.html` - Printer Profile Studio
- `/gx-converter.html` - GX File Converter

Set `SITE_PASSWORD` in the server environment before starting the website. Do not commit the value;
`.env.example` is only a placeholder. In PowerShell, for example:

```powershell
$env:SITE_PASSWORD = Read-Host "Choose a site password"
npm install
npm run dev
```

The login is verified by the Node server. Protected responses require an in-memory server session stored
in an HttpOnly, SameSite=Strict cookie (Secure in production); sessions expire after 12 hours. Five failed
attempts per client are rate-limited for one hour. The requested three-digit password is weak; use a long,
random secret for real deployment. The server fails to start if `SITE_PASSWORD` is missing. Open
`http://localhost:3000`; Vite gates development requests
through the authenticated API server at `127.0.0.1:3001`, including the authenticated VNC WebSocket.
Install QEMU on the Linux host:

```bash
sudo apt install qemu-system-x86 qemu-utils
```

In the VM page, download the official Ubuntu 24.04.5 Desktop ISO (about 6.25 GB), boot the installer,
and install Ubuntu onto the 32 GB virtual disk. QEMU tries the virtual disk first and falls back to the
installer ISO when the disk has no bootable system, so subsequent starts boot the installed guest. The
guest uses 4 GB RAM and 2 CPU cores. The disk, guest applications, browser history, and files persist
under `~/.aether-desktop/ubuntu-vm/`. QEMU uses KVM when the host user has access to `/dev/kvm`;
otherwise it uses multi-threaded software emulation, which is still slower than KVM.
The guest has outbound internet through QEMU user-mode networking. The VM console is not exposed as a
public VNC port.

To exchange files with the host, upload them in the VM page, then mount the shared folder inside Ubuntu:

```bash
sudo mkdir -p /mnt/host
sudo mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host
```

Files in `/mnt/host` can be downloaded from the browser VM page. Transfers are limited to 128 MB per file.
Browser-side display preferences are saved in IndexedDB. GitHub Pages is public and does not include the QEMU
backend or server-side login; use the protected Node server for the full VM and password-protected site.

## Prism 3D slicer

The slicer imports STL, OBJ, PLY, AMF, 3MF, DAE, GLTF, and GLB meshes; GLTF
files must embed their buffers and images. Models can be selected from the object list or viewport,
moved numerically, rotated on each axis (with 90-degree shortcuts), and resized in millimetres with
optional proportional scaling. Transform controls are available as a viewport dock on narrow screens.
Slicing runs through CuraEngine WebAssembly and produces real G-code, layer previews, supports, and print
metadata. Printer output is gated on the selected profile's firmware flavor, extrusion mode, origin,
build plate, dimensions, and required commands. Verify generated G-code for the exact physical printer
before use. The native editable project format is `.prism`; version 1 projects are migrated when opened,
and 3MF currently imports as mesh data.

Only G-code has an implemented machine-output exporter. FlashForge G/GX, UltiMaker UFP, G-code gzip,
FPP, and 3MF project export remain unavailable. The current CuraEngine adapter supports one extruder,
rectangular build plates, and a limited set of Cura firmware flavors; other printer profiles remain
searchable but cannot be sliced until a compatible engine/output path is implemented.

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

Profile data is derived from Cura (LGPL-3.0) and FlashForge Orca (AGPL-3.0). Slicing uses
[`@toybox-labs/cura-wasm`](https://github.com/Cloud-CNC/cura-wasm), which includes CuraEngine and is
licensed under MIT/LGPL-3.0-or-later/AGPL-3.0-or-later; its license is shipped in
`vendor/cura-wasm/LICENSE`.

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

Aether's older Windows 11-inspired shell remains an optional Electron **simulator**; the browser VM is the
real Ubuntu guest streamed through noVNC.

## GX conversion and website hosting

The GX File Converter is available at `/gx-converter.html`. It extracts compatible G-code metadata and
reconstructs an STL from extrusion paths; it cannot recover original CAD geometry. Native FlashPrint FCFG
creation is not supported, so it only offers a separately named JSON metadata export.

The SLDPRT-to-STL converter runs entirely in your browser. Select or drop up to 50 `.SLDPRT` files
(128 MB each) and download the resulting binary STL files. Your CAD files are not uploaded. GitHub Pages can
serve the static browser tools, but it is public and cannot enforce server-side login or provide the VM APIs.
Use the authenticated Node server for those protected features.

The fourth launcher option, **Printer Profile Studio**, is at `/printer-config.html`. It edits and stores
profiles in browser local storage, imports and exports generic JSON, CSV, TXT, INI, and CFG, and offers
editable presets and filament starting ranges. Acceleration fields are validated as finite values from
10 to 100000 in increments of 10; invalid values block exports and can be explicitly rounded. GX settings
can be sent locally to the Studio for review without uploading the file. The Studio imports .fcfg bytes
through its native document parser, keeps the parsed document with the profile, and exports through that
document so unknown keys, original lines, and untouched metadata are retained. The supplied corpus contains
33 genuine files with 207 keys each and was used for byte-exact parse/export regression tests. Round-trips
byte-exact with 33 genuine files; not yet tested in FlashPrint itself. No machine ID to printer model mapping
is assumed; unknown Qt type IDs remain opaque. FlashPrint application open/save/re-export testing has not
been performed. Adventurer 5M build volume and nozzle choices are sourced from bundled FlashForge Orca
profiles; other unverified printer facts are labeled as such. Filament ranges are generic starting
references, not guaranteed manufacturer settings.

## Deploy to Render

The repository includes a Dockerfile and `render.yaml` for a persistent Render web service. Connect the
repository to Render's Blueprint deployment, then set the required `SITE_PASSWORD` secret in the Render
dashboard before deploying. The blueprint deliberately leaves this value unsynchronized and never stores
it in Git. Render needs the included QEMU packages, a persistent disk, and sufficient memory for the VM.
Future pushes to the connected repository can trigger automatic deployments. GitHub Pages can also serve the
static browser tools, but that deployment is public and does not use `SITE_PASSWORD`.

The browser VM can also be started with `npm run serve` after setting `SITE_PASSWORD`.

The Electron native desktop build provides integrated Chromium tabs:

```bash
npm start
```

On Linux, Electron may need the system libraries listed in [Electron's Linux prerequisites](https://www.electronjs.org/docs/latest/tutorial/linux).

`npm run check` checks JavaScript syntax and TypeScript; `npm test` runs application, VM, profile, and slicing tests.
`npm run build:browser` builds the React VM client. `npm run build:web` creates static files in `dist/`;
`npm run publish:web` publishes the GX converter and Printer Profile Studio assets to the repository root for GitHub Pages hosting.
Do not use this static publishing command when server-side password protection is required.

## Optional Electron simulator

- Boot and sign-in screens, a desktop, Start menu, taskbar, clock, notification panel, power menu, and draggable/minimizable/maximizable app windows.
- File Explorer and Notepad backed by a persistent virtual filesystem. Files are stored in Electron's per-user app-data folder as `aether-files.json`, not in the host filesystem. Desktop, Documents, Downloads, and Pictures are created on first launch.
- Calculator, a drawing canvas that saves and opens PNGs in the virtual Pictures folder, Personalization/System settings, Task Manager, and an App Store catalog of the bundled apps.
- A local CAD Converter that batch-converts up to 50 `.SLDPRT` files to binary STL, with per-file downloads. Files are limited to 128 MB each and are processed on the app host, not uploaded to a third-party service. Conversion uses the [Apache-2.0 `sldprt` project](https://github.com/blussyya/solidworks-converters) and may fail for unsupported or damaged parts.
- A Chromium webview with Google Search, HTTP(S) browsing, navigation controls, and multiple tabs in the Electron build. In the web version, pages open in sandboxed browser tabs inside the desktop; sites that prohibit embedding can be opened in a regular browser with the ↗ button. Internet access requires a network connection.
- Terminal commands for navigating and managing the virtual filesystem. Its `python` command supports arithmetic expressions, simple assignments, and `print(...)`; it is a deliberately small simulator, **not** a system Python interpreter.
- CPU and memory figures read from the host operating system. Restart and shutdown affect the simulated desktop session only; they do not restart or power off the computer.

## What this is not

Aether's optional Windows-inspired Electron shell is a simulator, not an operating system. The browser VM,
in contrast, runs Ubuntu itself under QEMU; it requires a Linux server host and a browser client.