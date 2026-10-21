# SyscallGuard desktop app

The dashboard is an Electron desktop app with its own window, app identity, icon, native menus and an embedded mock demonstration. Existing dashboard design, filtering, settings, exports and stage modes remain available.

## Run from source

In this `dashboard/` directory, install dependencies once:

```bash
npm ci
```

Start the complete demo with one command:

```bash
npm run demo
```

This builds the renderer and launches Electron with an in-process, loopback-only mock feed. It requires **no Python terminal, VM or separately started bridge**. The UI explicitly labels demo telemetry; the default story sends 14 allowed requests for every blocked attempt. Dedicated Python stage/stretch scenarios provide the attack rehearsal scenes. Closing the app stops its feed and timers.

For the fullscreen stage demo:

```bash
npm run demo -- --kiosk
```

For a real bridge later:

```bash
npm start -- --bridge=ws://VM-IP:8765
```

The launch argument overrides `SG_BRIDGE_URL`; the real default is `ws://127.0.0.1:8765`. `--fullscreen` and `--kiosk` are supported. The renderer retains context isolation, sandboxing and disabled Node integration.

## Run the built Linux app

The generated release files are in `release/` (ignored by Git). The AppImage was launched and its bundled renderer, local fonts, logo, favicon variants and embedded feed were verified; evidence is in `artifacts/desktop-app-check.json`. All 17 tests passed.

Release files:

- `SyscallGuard-0.1.0-x86_64.AppImage`: portable executable. Mark it executable if your file manager requests that, then open it.
- `linux-unpacked/syscallguard`: directly runnable packaged binary; keep its entire adjacent folder intact.

Double-clicking a packaged app starts the labelled demo by default while the backend tracks are unfinished. Pass `--bridge=ws://VM-IP:8765` or set `SG_BRIDGE_URL` to use the real feed; `--live` selects the default localhost real bridge. Explicit `--demo` always selects the mock feed.

```bash
./release/linux-unpacked/syscallguard
./release/linux-unpacked/syscallguard --kiosk
./release/linux-unpacked/syscallguard --bridge=ws://VM-IP:8765
```

The package includes Electron, Node, local fonts, assets and the mock feed. It does not need Node/npm/Python installed to run. AppImage runtime/FUSE support varies by Linux distribution; the unpacked folder avoids the AppImage mount requirement. No VM or guard is bundled.

## Build a release

```bash
npm run package:linux
```

For just the unpacked desktop folder:

```bash
npm run package:dir
```

The build uses the installed Electron distribution. Initial setup/packaging may download official packaging helpers; the resulting app runs offline. Nothing is published or uploaded. The configuration also identifies Windows/macOS icon formats, but only Linux x64 artifacts are built and tested here; native installers for other platforms require their own build/signing environments.

## Logo and icons

Change `branding/mark.svg`, then run:

```bash
npm run branding
npm run build
```

This regenerates matching SVG/PNG/favicons/ICO/ICNS from one editable vector source. See [branding/README.md](branding/README.md) for the asset map, source artwork, prompts and rebranding details.

## Verification

```bash
npm test
```

The suite covers prior dashboard behavior, mock stretch visuals' state/validation, embedded server recovery/cleanup and icon formats. Network integration tests require permission to bind loopback ports in restricted sandboxes. The desktop feed is read-only, limited to loopback, and shuts down with the app.

Physical projector checks, real kernel enforcement and the VM zero-byte proof remain separate acceptance work. The app does not claim that the mock demo proves enforcement.

Packaging/native APIs follow [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) and the pinned [electron-builder v26 configuration](https://www.electron.build/v26/docs/configuration/).

Both the desktop demo and default Python mock repeat a 60-second normal-traffic scenario: 28 allowed connections and two blocked attempts (at 28.2s and 55.2s), with every 15th request blocked. All destinations and processes are simulated. The separate Python stage/stretch scenarios remain available for attack rehearsals.
