# Activity Visualizer

Synchronized 3D GPS activity motion graphics and additive heatmaps rendered locally in the browser with Three.js and WebGL—inspired by [AlFontal/strava-home-runs](https://github.com/AlFontal/strava-home-runs), with no Blender or server-side processing required.

All uploaded archives, GPS tracks, and rendering stay 100% client-side in your browser.

---

## Features

- **100% Local Strava Archive Parsing**: Drag and drop a Strava bulk export `.zip` (including `activities.csv` metadata) or individual `.fit`, `.fit.gz`, `.gpx`, `.gpx.gz`, `.tcx`, and `.tcx.gz` files.
- **Synchronized Race Playback**: Replay all matching activities simultaneously from `00:00:00` with adjustable playback speed (`15x`–`360x`), scrubbing, and a live Finish-Time Distribution histogram HUD showing running/finished counts and combined distance.
- **3D Terrain & Street Network Integration** *(no API keys required)*:
  - Real-world elevation relief sampled from AWS Mapzen Terrarium DEM tiles (falling back to GPS elevation when offline).
  - Basemap styles: **Studio**, **3D Relief**, **Dark Map** (ArcGIS World Dark Gray), **Light Map** (ArcGIS World Light Gray), **Satellite** (ArcGIS World Imagery), **Grid**, and **Minimal**.
  - Universal **+ Streets** overlay powered by OpenStreetMap Overpass street vectors and ArcGIS World Transportation layers, styled to match each basemap.
- **Additive Heatmaps & Custom Markers**:
  - Toggle between glowing **Heatmap** trails and solid **Ribbon** tracks, with independent **Line Color**, **Marker Color**, trail width, glow intensity, finish-pulse animation, and custom image sprite markers.
- **Spatial & Activity Filters**:
  - **Home Origin** latitude/longitude coordinates, interactive **Pick on Map**, auto-detection, and configurable start radius filter.
  - Filters for **Sport** (All, Run + Trail Run, or detected sports), **Min/Max Distance (km)**, **Min/Max Time (min)**, **Max Speed (km/h)** to exclude GPS glitches, and an interactive **Activity Dates** distribution timeline scrubber.
- **PNG & WebM Export**: Capture high-resolution PNG snapshots or record synchronized 3D WebM video animations directly from the HUD with composited telemetry overlays.

---

## Getting Started

### Prerequisites

- Node.js 20+ (CI uses Node 22)
- npm (or Bun)

### Local Development

```bash
npm install
npm run dev
```

The dev server starts on port `3000`. Note that `vite.config.ts` sets `base: '/Activity-Visualizer/'` for GitHub Pages deployment, so in local development open:

```
http://localhost:3000/Activity-Visualizer/
```

### Other Scripts

- `npm run build` — Builds the production bundle to `dist/`.
- `npm run preview` — Previews the production build locally.
- `npm run lint` — Runs TypeScript type checking (`tsc --noEmit`).

---

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause playback |
| `R` | Restart playback from `00:00:00` |
| `H` | Collapse / Expand the bottom control dock (also hides the home origin marker) |
| `Esc` | Close upload modal or cancel Pick Home mode |

---

## Default Sample Dataset

On startup, the app loads the bundled `.fit.gz` activity files in `src/activities/` (`6505938492.fit.gz`, `6507121972.fit.gz`, `6513248378.fit.gz`) as a ready-to-explore default scene. You can replace those files or upload your own Strava export at any time via the **Upload Strava ZIP** button or by dragging files onto the window.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite
- **3D Rendering**: Three.js (`OrbitControls`, `EffectComposer`, `UnrealBloomPass`)
- **File Parsing**: `jszip`, `pako`, `fit-file-parser`
- **Open Geo Data**: AWS Mapzen Terrarium DEM tiles, OpenStreetMap Overpass API, ArcGIS Online tile services
- **Deployment**: GitHub Actions workflow (`.github/workflows/deploy.yml`) targeting GitHub Pages
