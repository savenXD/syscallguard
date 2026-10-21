# SyscallGuard branding

The mark is an S-shaped signal circuit inside a protected shield. It follows the dashboard's black/white foundation; alert colors remain reserved for telemetry.

## Change the logo later

1. Edit **`branding/mark.svg`**. This is genuine, editable vector geometry; keep its `0 0 64 64` viewBox.
2. Edit `branding/brand.json` for the icon background/foreground and manifest metadata.
3. Run:

```bash
npm run branding
npm run build
```

Rebuild the desktop distribution with `npm run package:linux` when distributing a new icon. Restart the app to refresh its native icon; desktop environments can cache packaged icons by app identity/version.

Do not edit generated PNG/ICO/ICNS files individually. Their source and sizes are listed in `asset-manifest.json`. Asset generation is offline after `npm ci`, uses the development dependency `sharp`, and does not require Python or ImageMagick.

## Files

| Purpose | Output |
|---|---|
| Transparent mark, white | `public/branding/logo.svg`, `logo.png` (1024px) |
| Transparent mark, dark | `public/branding/logo-dark.svg`, `logo-dark.png` |
| App tile, vector | `public/branding/app-icon.svg` |
| App tile, raster | `public/branding/app-icon-{16,24,32,48,64,128,256,512,1024}.png` |
| Browser favicon | `public/branding/favicon.svg`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png` |
| Apple touch icon | `public/branding/apple-touch-icon.png` (180px) |
| Web/Android icons | `public/branding/android-chrome-{192,512}x{192,512}.png`, `site.webmanifest` |
| Linux/Electron native icon | `build/icons/icon.png`, size-specific PNGs |
| Windows native icon | `build/icons/icon.ico` (16–256px layers) |
| macOS native icon | `build/icons/icon.icns` (16–1024px layers) |
| Existing UI compatibility alias | `public/logo.svg` |

The header keeps its existing `logo.svg` path; the builder updates the alias from the same master. Favicons are wired in `index.html`. The Electron window and packager use `build/icons/`.

The manifest is supplied as an asset for future HTTP hosting. It is deliberately not linked from the file-based renderer, preserving the offline browser fallback without manifest-origin/CORS errors.

## Artwork provenance

The concept was produced with the built-in `image_gen` tool, then normalized into clean editable SVG geometry so small icons remain crisp. The generated reference is saved under `source/generated-concept-v1.png`; prompts and the production note are in `source/prompts.json`. The production SVG is not a raster image embedded in an SVG wrapper.
