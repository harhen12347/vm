# Aether Desktop

Aether is a Windows 11-inspired desktop **simulator** built with Electron. It opens as a native desktop app and uses Electron's real Chromium engine for web browsing, but it does not boot or emulate a separate operating system.

## Run it in a browser

Requirements: Node.js 20.0.0 or later and npm. Start the web version with:

```bash
npm install
npm run serve
```

Open `http://localhost:3000`. Set `PORT=8080 npm run serve` to choose another port. Virtual files are saved in `~/.aether-desktop/aether-files.json` and persist between server restarts.

The web version displays websites inside Aether Browser. Some sites block embedded pages; use the browser's ↗ button to open those pages in a regular browser. Electron is the optional native desktop build and provides integrated Chromium tabs:

```bash
npm start
```

On Linux, Electron may need the system libraries listed in [Electron's Linux prerequisites](https://www.electronjs.org/docs/latest/tutorial/linux).

`npm run check` checks JavaScript syntax; `npm test` runs the headless virtual-filesystem tests.

## Included

- Boot and sign-in screens, a desktop, Start menu, taskbar, clock, notification panel, power menu, and draggable/minimizable/maximizable app windows.
- File Explorer and Notepad backed by a persistent virtual filesystem. Files are stored in Electron's per-user app-data folder as `aether-files.json`, not in the host filesystem. Desktop, Documents, Downloads, and Pictures are created on first launch.
- Calculator, a drawing canvas that saves and opens PNGs in the virtual Pictures folder, Personalization/System settings, Task Manager, and an App Store catalog of the bundled apps.
- A Chromium webview with Google Search, HTTP(S) browsing, navigation controls, and multiple tabs in the Electron build. In the web version, pages open in sandboxed browser tabs inside the desktop; sites that prohibit embedding can be opened in a regular browser with the ↗ button. Internet access requires a network connection.
- Terminal commands for navigating and managing the virtual filesystem. Its `python` command supports arithmetic expressions, simple assignments, and `print(...)`; it is a deliberately small simulator, **not** a system Python interpreter.
- CPU and memory figures read from the host operating system. Restart and shutdown affect the simulated desktop session only; they do not restart or power off the computer.

## What this is not

Aether is not a bootable virtual machine, a host-file manager, or a full operating system. Its desktop apps and filesystem are simulated inside Electron. Web pages run in Chromium, and host CPU/memory information is real. A genuine VM would require an operating-system disk image and a hypervisor such as QEMU/KVM or VirtualBox; neither QEMU nor VirtualBox is installed in the inspected environment.