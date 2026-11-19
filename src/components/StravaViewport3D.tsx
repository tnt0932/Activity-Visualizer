import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type {
  CameraPreset,
  ElevationGrid,
  ProjectedActivity,
  SceneSettings,
  SpatialBounds,
  StreetNetwork,
} from '../types/activity';
import {
  formatClockHMS,
  interpolateActivityAtTime,
  metersToLatLon,
  sampleElevationGrid,
} from '../utils/geo';
import { buildFinishHistogram } from '../utils/histogram';
import { type BasemapTileResult, latToMercatorY } from '../utils/openData';
import { PALETTES } from '../utils/palettes';

export interface StravaViewportHandle {
  captureSnapshot: (datasetTitle: string) => void;
  exportVideo: (
    datasetTitle: string,
    onProgress: (pct: number) => void,
  ) => Promise<void>;
  resetCamera: () => void;
}

interface StravaViewport3DProps {
  activities: ProjectedActivity[];
  bounds: SpatialBounds;
  elevationGrid: ElevationGrid;
  streetNetwork: StreetNetwork;
  basemapTiles: BasemapTileResult | null;
  streetOverlayTiles: BasemapTileResult | null;
  homeLat: number;
  homeLon: number;
  isPickingHome: boolean;
  showRadiusRing: boolean;
  showHomeMarker: boolean;
  settings: SceneSettings;
  elapsedSec: number;
  maxDurationSec: number;
  isPlaying: boolean;
  onTickTime: (nextSec: number) => void;
  onSetPlaying: (playing: boolean) => void;
  onPickHome: (lat: number, lon: number) => void;
}

interface TrailVisualEntry {
  activity: ProjectedActivity;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  totalSegments: number;
  sampleTimes: Float32Array;
  sprite: THREE.Sprite;
  glowSprite: THREE.Sprite;
  finishRing: THREE.Mesh;
}

// Pre-allocated math scratch objects for zero-GC render loop
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();

function detectSoftwareGl(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function createRibbonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.24, 'rgba(255,255,255,0.0)');
  grad.addColorStop(0.34, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.42, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.58, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.66, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.76, 'rgba(255,255,255,0.0)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function createBlueprintTexture(isLight: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = isLight ? '#ede9df' : '#090e1a';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = isLight ? 'rgba(30,41,59,0.08)' : 'rgba(56,189,248,0.09)';
  ctx.lineWidth = 1;
  const minor = size / 8;
  for (let i = 0; i <= 8; i++) {
    const p = i * minor;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  ctx.strokeStyle = isLight ? 'rgba(30,41,59,0.2)' : 'rgba(56,189,248,0.22)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  return tex;
}

function createBeaconTexture(coreHex: number, glowHex: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cGlow = new THREE.Color(glowHex);
  const cCore = new THREE.Color(coreHex);
  const cx = size / 2;
  const cy = size / 2;

  // Soft outer aura
  const aura = ctx.createRadialGradient(cx, cy, 4, cx, cy, size * 0.48);
  aura.addColorStop(
    0,
    `rgba(${Math.round(cCore.r * 255)}, ${Math.round(cCore.g * 255)}, ${Math.round(cCore.b * 255)}, 0.92)`,
  );
  aura.addColorStop(
    0.3,
    `rgba(${Math.round(cGlow.r * 255)}, ${Math.round(cGlow.g * 255)}, ${Math.round(cGlow.b * 255)}, 0.45)`,
  );
  aura.addColorStop(
    0.65,
    `rgba(${Math.round(cGlow.r * 255)}, ${Math.round(cGlow.g * 255)}, ${Math.round(cGlow.b * 255)}, 0.09)`,
  );
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, size, size);

  // Crisp precision core dot
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${Math.round(cCore.r * 255)}, ${Math.round(cCore.g * 255)}, ${Math.round(cCore.b * 255)})`;
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCircularImageTexture(
  img: HTMLImageElement,
  borderHex: number,
): THREE.CanvasTexture {
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.44;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const aspect = img.width / Math.max(1, img.height);
  let drawW = r * 2;
  let drawH = r * 2;
  if (aspect > 1) {
    drawW = drawH * aspect;
  } else {
    drawH = drawW / aspect;
  }
  ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  ctx.restore();

  // Crisp outer ring
  const col = new THREE.Color(borderHex);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 7;
  ctx.strokeStyle = `rgb(${Math.round(col.r * 255)}, ${Math.round(col.g * 255)}, ${Math.round(col.b * 255)})`;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function getCameraPresetTarget(
  preset: CameraPreset,
  centerX: number,
  centerZ: number,
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const target = new THREE.Vector3(centerX, 0, centerZ);
  if (preset === 'top') {
    return {
      pos: new THREE.Vector3(centerX, 175, centerZ + 14),
      target,
    };
  }
  if (preset === 'horizon') {
    return {
      pos: new THREE.Vector3(centerX - 65, 34, centerZ + 145),
      target,
    };
  }
  // Classic 'tilt' blender-style isometric perspective
  return {
    pos: new THREE.Vector3(centerX - 58, 98, centerZ + 122),
    target,
  };
}

/**
 * Composites the 3D WebGL frame + semantic Motion Graphics HUD onto a 2D canvas
 * for crisp PNG snapshots and WebM video exports.
 */
function drawExportHud(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  datasetTitle: string,
  activities: ProjectedActivity[],
  elapsedSec: number,
  maxDurationSec: number,
  isLight: boolean,
) {
  const pad = Math.round(width * 0.032);
  const { buckets, maxBucketTotal, stillRunning, finishedCount } =
    buildFinishHistogram(activities, elapsedSec, maxDurationSec, 18);

  const textPrimary = isLight ? '#0f172a' : '#f8fafc';
  const textMuted = isLight ? '#475569' : '#94a3b8';
  const accent = isLight ? '#c2410c' : '#fb923c';
  const barTrack = isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(248, 250, 252, 0.14)';
  const panelBg = isLight
    ? 'rgba(243, 240, 233, 0.82)'
    : 'rgba(7, 9, 14, 0.72)';

  ctx.save();
  // Subtle left HUD scrim
  ctx.fillStyle = panelBg;
  const boxW = Math.min(340, width * 0.34);
  const boxH = 198;
  ctx.beginPath();
  ctx.roundRect(pad - 12, pad - 10, boxW, boxH, 12);
  ctx.fill();

  // Title, count & combined total distance
  const totalKmVal =
    activities.reduce((sum, a) => sum + a.distanceM, 0) / 1000;
  const totalKmLabel =
    totalKmVal >= 1000
      ? `${Math.round(totalKmVal).toLocaleString()} km`
      : `${totalKmVal.toFixed(1)} km`;
  ctx.fillStyle = textMuted;
  ctx.font = '600 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `${datasetTitle} · ${activities.length} runs · ${totalKmLabel}`,
    pad,
    pad + 12,
  );

  // Elapsed Clock
  ctx.fillStyle = textPrimary;
  ctx.font = '700 38px "JetBrains Mono", monospace';
  ctx.fillText(formatClockHMS(elapsedSec), pad, pad + 54);

  // Still running counter
  ctx.fillStyle = accent;
  ctx.font = '600 15px "JetBrains Mono", monospace';
  ctx.fillText(`${stillRunning} Still Running`, pad, pad + 80);

  ctx.fillStyle = textMuted;
  ctx.font = '500 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`· ${finishedCount} Finished`, pad + 158, pad + 80);

  // Finish-time histogram bars
  const histX = pad;
  const histY = pad + 102;
  const histW = boxW - 24;
  const histH = 56;
  const gap = 3;
  const barW = (histW - gap * (buckets.length - 1)) / buckets.length;

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const x = histX + i * (barW + gap);
    const totalH = Math.max(2, (b.totalCount / maxBucketTotal) * histH);
    const doneH = (b.completedCount / maxBucketTotal) * histH;

    ctx.fillStyle = barTrack;
    ctx.fillRect(x, histY + histH - totalH, barW, totalH);

    if (doneH > 0) {
      ctx.fillStyle = accent;
      ctx.fillRect(x, histY + histH - doneH, barW, doneH);
    }
  }

  ctx.fillStyle = textMuted;
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.fillText('0m', histX, histY + histH + 14);
  const maxMinLabel = `${Math.round(maxDurationSec / 60)}m`;
  const mWidth = ctx.measureText(maxMinLabel).width;
  ctx.fillText(maxMinLabel, histX + histW - mWidth, histY + histH + 14);
  ctx.restore();
}

export const StravaViewport3D = forwardRef<
  StravaViewportHandle,
  StravaViewport3DProps
>(function StravaViewport3D(
  {
    activities,
    bounds,
    elevationGrid,
    streetNetwork,
    basemapTiles,
    streetOverlayTiles,
    homeLat,
    homeLon,
    isPickingHome,
    showRadiusRing,
    showHomeMarker,
    settings,
    elapsedSec,
    maxDurationSec,
    isPlaying,
    onTickTime,
    onSetPlaying,
    onPickHome,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglLost, setWebglLost] = useState(false);

  // Mutable refs so the WebGL loop never recreates when React state ticks
  const propsRef = useRef({
    activities,
    bounds,
    elevationGrid,
    streetNetwork,
    basemapTiles,
    streetOverlayTiles,
    homeLat,
    homeLon,
    isPickingHome,
    showRadiusRing,
    showHomeMarker,
    settings,
    elapsedSec,
    maxDurationSec,
    isPlaying,
    onTickTime,
    onSetPlaying,
    onPickHome,
  });
  propsRef.current = {
    activities,
    bounds,
    elevationGrid,
    streetNetwork,
    basemapTiles,
    streetOverlayTiles,
    homeLat,
    homeLon,
    isPickingHome,
    showRadiusRing,
    showHomeMarker,
    settings,
    elapsedSec,
    maxDurationSec,
    isPlaying,
    onTickTime,
    onSetPlaying,
    onPickHome,
  };

  // Three.js engine refs
  const engineRef = useRef<{
    isSoftwareGl: boolean;
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    composer: EffectComposer | null;
    bloomPass: UnrealBloomPass | null;
    terrainGroup: THREE.Group;
    streetsGroup: THREE.Group;
    homeGroup: THREE.Group;
    trailsGroup: THREE.Group;
    markersGroup: THREE.Group;
    radiusLoop: THREE.LineLoop | null;
    trailEntries: TrailVisualEntry[];
    terrainMaterialUniforms: {
      uContourStep: { value: number };
      uContourColor: { value: THREE.Color };
      uShowContours: { value: number };
    } | null;
    worldScale: number;
    centerX: number;
    centerZ: number;
    ribbonTex: THREE.CanvasTexture;
    beaconTex: THREE.CanvasTexture;
    basemapTex: THREE.CanvasTexture | null;
    streetOverlayTex: THREE.CanvasTexture | null;
    blueprintTex: THREE.CanvasTexture;
    customMarkerTex: THREE.CanvasTexture | null;
    cameraGoalPos: THREE.Vector3 | null;
    cameraGoalTarget: THREE.Vector3 | null;
    requestRender: () => void;
    renderImmediate: () => void;
    updateFrameState: (tSec: number) => void;
  } | null>(null);

  // 1. Initialize WebGLRenderer, Scene, Lighting, Post-processing once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const onContextRestored = () => {
      setWebglLost(false);
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    const initPalette = PALETTES[propsRef.current.settings.palette];
    scene.background = new THREE.Color(initPalette.backgroundHex);
    scene.fog = new THREE.FogExp2(initPalette.fogHex, 0.0022);

    // Mandatory studio environment reflection
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 1600);
    camera.position.set(-58, 98, 122);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.minDistance = 18;
    controls.maxDistance = 420;

    // 3-point warm/cool studio lighting rig
    const hemiLight = new THREE.HemisphereLight(0x94b8ff, 0x1a1e2e, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff3e0, 1.85);
    keyLight.position.set(110, 140, 80);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 420;
    keyLight.shadow.camera.left = -140;
    keyLight.shadow.camera.right = 140;
    keyLight.shadow.camera.top = 140;
    keyLight.shadow.camera.bottom = -140;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.65);
    rimLight.position.set(-120, 70, -100);
    scene.add(rimLight);

    // Scene hierarchy groups
    const terrainGroup = new THREE.Group();
    const streetsGroup = new THREE.Group();
    const homeGroup = new THREE.Group();
    const trailsGroup = new THREE.Group();
    const markersGroup = new THREE.Group();
    scene.add(terrainGroup, streetsGroup, homeGroup, trailsGroup, markersGroup);

    // Postprocessing EffectComposer with Bloom on hardware GPUs
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.52,
        0.45,
        0.78,
      );
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
    }

    const ribbonTex = createRibbonTexture();
    ribbonTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const beaconTex = createBeaconTexture(
      initPalette.markerHex,
      initPalette.trailBaseHex,
    );
    const blueprintTex = createBlueprintTexture(initPalette.isLight);

    const renderImmediate = () => {
      const curSettings = propsRef.current.settings;
      const isLightSurface =
        PALETTES[curSettings.palette].isLight ||
        curSettings.baseMapStyle === 'light-map';
      if (composer && !isSoftwareGl && !isLightSurface) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };

    const updateFrameState = (tSec: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const { elevationGrid: grid, settings: curSettings } = propsRef.current;
      const worldScale = engine.worldScale;

      for (let i = 0; i < engine.trailEntries.length; i++) {
        const entry = engine.trailEntries[i];
        const act = entry.activity;

        if (tSec <= 0) {
          entry.geometry.setDrawRange(0, 0);
          entry.sprite.visible = true;
          entry.glowSprite.visible = curSettings.markerGlow > 0.02;
          const p0 = act.points[0];
          const wx = p0.x * worldScale;
          const wz = p0.z * worldScale;
          const wy =
            (sampleElevationGrid(grid, p0.x, p0.z) - grid.minEle) *
              worldScale *
              curSettings.elevationExaggeration *
              1.35 +
            0.55;
          entry.sprite.position.set(wx, wy, wz);
          entry.glowSprite.position.set(wx, wy, wz);
          entry.finishRing.visible = false;
          continue;
        }

        // Binary search in resampled ribbon timestamps
        const times = entry.sampleTimes;
        const maxIdx = entry.totalSegments;
        let activeSegs = 0;
        if (tSec >= act.durationSec) {
          activeSegs = maxIdx;
        } else {
          let lo = 0;
          let hi = maxIdx;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (times[mid] <= tSec) lo = mid;
            else hi = mid - 1;
          }
          activeSegs = Math.max(1, lo);
        }

        entry.geometry.setDrawRange(0, activeSegs * 6);

        const sample = interpolateActivityAtTime(act, tSec);
        const wx = sample.x * worldScale;
        const wz = sample.z * worldScale;
        const groundEle = sampleElevationGrid(grid, sample.x, sample.z);
        const wy =
          (groundEle - grid.minEle) *
            worldScale *
            curSettings.elevationExaggeration *
            1.35 +
          0.65;

        if (sample.finished) {
          entry.sprite.visible = false;
          entry.glowSprite.visible = false;
          const sinceFinish = tSec - act.durationSec;
          if (curSettings.showFinishPulse && sinceFinish >= 0 && sinceFinish < 90) {
            const prog = sinceFinish / 90;
            entry.finishRing.visible = true;
            entry.finishRing.position.set(wx, wy - 0.25, wz);
            const s = 1 + prog * 4.5;
            entry.finishRing.scale.set(s, s, 1);
            (entry.finishRing.material as THREE.MeshBasicMaterial).opacity =
              (1 - prog) * 0.75;
          } else {
            entry.finishRing.visible = false;
          }
        } else {
          entry.sprite.visible = true;
          entry.sprite.position.set(wx, wy, wz);
          entry.glowSprite.visible = curSettings.markerGlow > 0.02;
          entry.glowSprite.position.set(wx, wy, wz);
          entry.finishRing.visible = false;
        }
      }
    };

    // Frame pacing & software WebGL guard
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;
    let lastTs = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const stepCameraAndOrbit = (dt: number) => {
      const engine = engineRef.current;
      if (!engine) return false;
      let moving = false;

      if (engine.cameraGoalPos && engine.cameraGoalTarget) {
        const lambda = 6.5;
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          engine.cameraGoalPos.x,
          lambda,
          dt,
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          engine.cameraGoalPos.y,
          lambda,
          dt,
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          engine.cameraGoalPos.z,
          lambda,
          dt,
        );
        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          engine.cameraGoalTarget.x,
          lambda,
          dt,
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          engine.cameraGoalTarget.y,
          lambda,
          dt,
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          engine.cameraGoalTarget.z,
          lambda,
          dt,
        );
        moving = true;
        if (
          camera.position.distanceToSquared(engine.cameraGoalPos) < 0.08 &&
          controls.target.distanceToSquared(engine.cameraGoalTarget) < 0.04
        ) {
          engine.cameraGoalPos = null;
          engine.cameraGoalTarget = null;
        }
      } else if (propsRef.current.settings.autoOrbit) {
        // Gentle orbital rotation around controls.target
        _vec3A.copy(camera.position).sub(controls.target);
        const angle = dt * 0.14;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = _vec3A.x * cos - _vec3A.z * sin;
        const nz = _vec3A.x * sin + _vec3A.z * cos;
        _vec3A.x = nx;
        _vec3A.z = nz;
        camera.position.copy(controls.target).add(_vec3A);
        moving = true;
      }

      controls.update();
      return moving;
    };

    const requestRender = () => {
      if (disposed || renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const dt = Math.min(0.1, (now - lastTs) / 1000);
        lastTs = now;
        const cameraAnimating = stepCameraAndOrbit(dt);
        renderImmediate();
        const done = () => {
          renderBusy = false;
          if (disposed) return;
          if (
            renderDirty ||
            cameraAnimating ||
            propsRef.current.isPlaying ||
            propsRef.current.settings.autoOrbit
          ) {
            if (propsRef.current.isPlaying) {
              scheduleContinuousLoop();
            } else {
              requestRender();
            }
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    let continuousActive = false;
    const tickContinuous = () => {
      if (disposed) return;
      const {
        isPlaying: playing,
        elapsedSec: curSec,
        maxDurationSec: maxSec,
        settings: curSettings,
        onTickTime: tickCb,
        onSetPlaying: setPlayingCb,
      } = propsRef.current;

      if (!playing && !engineRef.current?.cameraGoalPos && !curSettings.autoOrbit) {
        continuousActive = false;
        return;
      }

      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      if (playing && maxSec > 0) {
        const next = curSec + dt * curSettings.playbackSpeed;
        if (next >= maxSec) {
          updateFrameState(maxSec);
          tickCb(maxSec);
          setPlayingCb(false);
        } else {
          updateFrameState(next);
          tickCb(next);
        }
      }

      stepCameraAndOrbit(dt);
      renderImmediate();

      if (isSoftwareGl) {
        afterDraw(tickContinuous);
      } else {
        frameId = requestAnimationFrame(tickContinuous);
      }
    };

    const scheduleContinuousLoop = () => {
      if (continuousActive || disposed) return;
      continuousActive = true;
      lastTs = performance.now();
      if (isSoftwareGl) {
        afterDraw(tickContinuous);
      } else {
        frameId = requestAnimationFrame(tickContinuous);
      }
    };

    const handleControlsStart = () => {
      if (engineRef.current) {
        engineRef.current.cameraGoalPos = null;
        engineRef.current.cameraGoalTarget = null;
      }
    };
    const handleControlsChange = () => {
      if (!continuousActive) {
        requestRender();
      }
    };
    controls.addEventListener('start', handleControlsStart);
    controls.addEventListener('change', handleControlsChange);

    const handleResize = () => {
      if (!container || disposed) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
      if (bloomPass) bloomPass.resolution.set(w, h);
      if (!continuousActive) requestRender();
    };
    window.addEventListener('resize', handleResize);

    // Click-to-pick Home Origin on terrain
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!propsRef.current.isPickingHome) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const engine = engineRef.current;
      if (!engine) return;

      const rect = canvas.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      let hitPoint: THREE.Vector3 | null = null;
      const hits = raycaster.intersectObjects(terrainGroup.children, false);
      if (hits.length > 0) {
        hitPoint = hits[0].point;
      } else {
        const pt = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(groundPlane, pt)) {
          hitPoint = pt;
        }
      }

      if (hitPoint) {
        const mx = hitPoint.x / engine.worldScale;
        const mz = hitPoint.z / engine.worldScale;
        const { lat, lon } = metersToLatLon(
          mx,
          mz,
          propsRef.current.homeLat,
          propsRef.current.homeLon,
        );
        propsRef.current.onPickHome(lat, lon);
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);

    engineRef.current = {
      isSoftwareGl,
      renderer,
      scene,
      camera,
      controls,
      composer,
      bloomPass,
      terrainGroup,
      streetsGroup,
      homeGroup,
      trailsGroup,
      markersGroup,
      radiusLoop: null,
      trailEntries: [],
      terrainMaterialUniforms: null,
      worldScale: 0.05,
      centerX: 0,
      centerZ: 0,
      ribbonTex,
      beaconTex,
      basemapTex: null,
      streetOverlayTex: null,
      blueprintTex,
      customMarkerTex: null,
      cameraGoalPos: null,
      cameraGoalTarget: null,
      requestRender: () => {
        if (
          propsRef.current.isPlaying ||
          propsRef.current.settings.autoOrbit ||
          engineRef.current?.cameraGoalPos
        ) {
          scheduleContinuousLoop();
        } else {
          requestRender();
        }
      },
      renderImmediate,
      updateFrameState,
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      controls.removeEventListener('start', handleControlsStart);
      controls.removeEventListener('change', handleControlsChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);

      controls.dispose();
      ribbonTex.dispose();
      beaconTex.dispose();
      blueprintTex.dispose();
      engineRef.current?.basemapTex?.dispose();
      engineRef.current?.streetOverlayTex?.dispose();
      engineRef.current?.customMarkerTex?.dispose();
      composer?.dispose();
      renderer.dispose();
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
      engineRef.current = null;
    };
  }, []);

  // 2. Load custom marker sprite image whenever settings.customMarkerUrl changes
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const palette = PALETTES[settings.palette];
    if (!settings.customMarkerUrl) {
      if (engine.customMarkerTex) {
        engine.customMarkerTex.dispose();
        engine.customMarkerTex = null;
      }
      for (const entry of engine.trailEntries) {
        (entry.sprite.material as THREE.SpriteMaterial).map = engine.beaconTex;
        (entry.sprite.material as THREE.SpriteMaterial).color.setHex(0xffffff);
        (entry.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
      }
      engine.requestRender();
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled || !engineRef.current) return;
      const tex = createCircularImageTexture(img, palette.trailBaseHex);
      engine.customMarkerTex?.dispose();
      engine.customMarkerTex = tex;
      for (const entry of engine.trailEntries) {
        const mat = entry.sprite.material as THREE.SpriteMaterial;
        mat.map = tex;
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      }
      engine.requestRender();
    };
    img.src = settings.customMarkerUrl;

    return () => {
      cancelled = true;
    };
  }, [settings.customMarkerUrl, settings.palette]);

  // 3. Rebuild Terrain, Streets, Home Origin, and Trail Geometries when data or geometry settings change
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const palette = PALETTES[settings.palette];
    const mapStyle = settings.baseMapStyle;
    const isLightMap = mapStyle === 'light-map' || palette.isLight;
    const bgHex =
      mapStyle === 'light-map'
        ? 0xe8e4db
        : mapStyle === 'studio'
          ? palette.isLight
            ? 0xeeebe4
            : 0x030407
          : mapStyle === 'dark-map' ||
              mapStyle === 'satellite' ||
              mapStyle === 'satellite-streets'
            ? 0x07090e
            : palette.backgroundHex;

    engine.scene.background = new THREE.Color(bgHex);
    engine.scene.fog = new THREE.FogExp2(bgHex, 0.0021);

    // Keep HDR bloom threshold >= 0.94 so tone-mapped basemaps & satellite roads NEVER glow;
    // only HDR (toneMapped: false) trails and markers above 1.0 trigger bloom.
    if (engine.bloomPass) {
      const avgGlow = Math.max(settings.lineGlow, settings.markerGlow * 0.8);
      engine.bloomPass.strength = Math.max(0, (avgGlow - 0.15) * 0.38);
      engine.bloomPass.radius = 0.14 + Math.min(0.3, avgGlow * 0.09);
      engine.bloomPass.threshold = Math.max(0.94, 1.04 - avgGlow * 0.04);
    }

    const customTrailColor = new THREE.Color(settings.trailColor);
    const customMarkerColor = new THREE.Color(settings.markerColor);

    // Update beacon texture colors from independent marker & line colors
    engine.beaconTex.dispose();
    engine.beaconTex = createBeaconTexture(
      customMarkerColor.getHex(),
      customTrailColor.getHex(),
    );

    // Compute world scale & center
    const worldScale = 100 / Math.max(500, bounds.radiusM);
    const centerX = ((bounds.minX + bounds.maxX) / 2) * worldScale;
    const centerZ = ((bounds.minZ + bounds.maxZ) / 2) * worldScale;
    engine.worldScale = worldScale;
    engine.centerX = centerX;
    engine.centerZ = centerZ;

    // Clear previous groups cleanly
    const disposeGroup = (grp: THREE.Group) => {
      while (grp.children.length > 0) {
        const child = grp.children[0];
        grp.remove(child);
        child.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((m) => m.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        });
      }
    };

    disposeGroup(engine.terrainGroup);
    disposeGroup(engine.streetsGroup);
    disposeGroup(engine.homeGroup);
    disposeGroup(engine.trailsGroup);
    disposeGroup(engine.markersGroup);
    engine.radiusLoop = null;
    engine.trailEntries = [];
    if (engine.basemapTex) {
      engine.basemapTex.dispose();
      engine.basemapTex = null;
    }
    if (engine.streetOverlayTex) {
      engine.streetOverlayTex.dispose();
      engine.streetOverlayTex = null;
    }

    const elevScale = worldScale * settings.elevationExaggeration * 1.35;

    // --- A. 3D Topographic Terrain & Base Map Style ---
    if (settings.showTerrain && mapStyle !== 'minimal') {
      const { cols, rows, elevations, minEle, maxEle } = elevationGrid;
      const vertCount = cols * rows;
      const positions = new Float32Array(vertCount * 3);
      const colors = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);
      const rawEles = new Float32Array(vertCount);
      const indices: number[] = [];

      const isTileBasemap =
        (mapStyle === 'dark-map' ||
          mapStyle === 'light-map' ||
          mapStyle === 'satellite' ||
          mapStyle === 'satellite-streets') &&
        basemapTiles !== null;

      const cLow = new THREE.Color(
        mapStyle === 'studio'
          ? palette.isLight
            ? 0xe2ddd2
            : 0x04060a
          : palette.terrainLowHex,
      );
      const cHigh = new THREE.Color(
        mapStyle === 'studio'
          ? palette.isLight
            ? 0xf7f4ed
            : 0x10151f
          : palette.terrainHighHex,
      );
      const eleSpan = Math.max(1, maxEle - minEle);

      const latScale = 111320;
      const lonScale = 111320 * Math.cos((homeLat * Math.PI) / 180);

      for (let r = 0; r < rows; r++) {
        const vz = r / (rows - 1);
        const mz = bounds.minZ + vz * (bounds.maxZ - bounds.minZ);
        const lat = homeLat - mz / latScale;
        const mercY = latToMercatorY(lat);

        for (let c = 0; c < cols; c++) {
          const vx = c / (cols - 1);
          const mx = bounds.minX + vx * (bounds.maxX - bounds.minX);
          const lon = homeLon + mx / lonScale;
          const idx = r * cols + c;
          const rawEle = elevations[idx];
          const wy =
            mapStyle === 'blueprint' ? 0 : (rawEle - minEle) * elevScale;

          positions[idx * 3] = mx * worldScale;
          positions[idx * 3 + 1] = wy;
          positions[idx * 3 + 2] = mz * worldScale;
          rawEles[idx] = rawEle;

          if (isTileBasemap && basemapTiles) {
            uvs[idx * 2] =
              (lon - basemapTiles.minLon) /
              (basemapTiles.maxLon - basemapTiles.minLon);
            uvs[idx * 2 + 1] =
              (mercY - basemapTiles.mercMinY) /
              (basemapTiles.mercMaxY - basemapTiles.mercMinY);
          } else {
            uvs[idx * 2] = vx;
            uvs[idx * 2 + 1] = 1 - vz;
          }

          const t = Math.max(0, Math.min(1, (rawEle - minEle) / eleSpan));
          _vec3B.set(
            THREE.MathUtils.lerp(cLow.r, cHigh.r, t),
            THREE.MathUtils.lerp(cLow.g, cHigh.g, t),
            THREE.MathUtils.lerp(cLow.b, cHigh.b, t),
          );
          colors[idx * 3] = _vec3B.x;
          colors[idx * 3 + 1] = _vec3B.y;
          colors[idx * 3 + 2] = _vec3B.z;
        }
      }

      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          const b = a + 1;
          const d = (r + 1) * cols + c;
          const e = d + 1;
          indices.push(a, d, b, b, d, e);
        }
      }

      const terrainGeo = new THREE.BufferGeometry();
      terrainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      terrainGeo.setAttribute('aRawEle', new THREE.BufferAttribute(rawEles, 1));
      terrainGeo.setIndex(indices);
      terrainGeo.computeVertexNormals();

      let mapTexture: THREE.Texture | null = null;
      if (isTileBasemap && basemapTiles) {
        const tex = new THREE.CanvasTexture(basemapTiles.canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        engine.basemapTex = tex;
        mapTexture = tex;
      } else if (mapStyle === 'blueprint') {
        engine.blueprintTex.dispose();
        engine.blueprintTex = createBlueprintTexture(palette.isLight);
        engine.blueprintTex.anisotropy =
          engine.renderer.capabilities.getMaxAnisotropy();
        mapTexture = engine.blueprintTex;
      }

      const showContoursEffective =
        settings.showContours &&
        mapStyle !== 'satellite' &&
        mapStyle !== 'satellite-streets' &&
        mapStyle !== 'light-map';

      const contourUniforms = {
        uContourStep: { value: Math.max(5, Math.round(eleSpan / 14 / 5) * 5) },
        uContourColor: {
          value: new THREE.Color(
            mapStyle === 'studio'
              ? palette.isLight
                ? 0xc4bdb0
                : 0x141a24
              : palette.contourHex,
          ),
        },
        uShowContours: { value: showContoursEffective ? 1.0 : 0.0 },
      };
      engine.terrainMaterialUniforms = contourUniforms;

      const isSatStyle =
        mapStyle === 'satellite' || mapStyle === 'satellite-streets';
      const terrainTint = isSatStyle
        ? 0xc8ccd2
        : mapStyle === 'dark-map' || mapStyle === 'light-map'
          ? 0xe2e6ec
          : 0xffffff;

      const terrainMat = new THREE.MeshStandardMaterial({
        map: mapTexture,
        color: mapTexture ? terrainTint : undefined,
        vertexColors: !mapTexture,
        roughness: isSatStyle ? 0.99 : mapStyle === 'studio' ? 0.97 : 0.88,
        metalness: isSatStyle || mapStyle === 'studio' ? 0.0 : 0.04,
        envMapIntensity: isSatStyle ? 0.1 : mapStyle === 'studio' ? 0.08 : 0.6,
      });

      terrainMat.onBeforeCompile = (shader) => {
        shader.uniforms.uContourStep = contourUniforms.uContourStep;
        shader.uniforms.uContourColor = contourUniforms.uContourColor;
        shader.uniforms.uShowContours = contourUniforms.uShowContours;

        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nattribute float aRawEle;\nvarying float vRawEle;',
          )
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvRawEle = aRawEle;',
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform float uContourStep;\nuniform vec3 uContourColor;\nuniform float uShowContours;\nvarying float vRawEle;',
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            if (uShowContours > 0.5) {
              float cVal = vRawEle / uContourStep;
              float distToLine = abs(fract(cVal - 0.5) - 0.5) / max(fwidth(cVal), 0.0001);
              float lineMask = 1.0 - smoothstep(0.0, 1.35, distToLine);
              float majorVal = vRawEle / (uContourStep * 5.0);
              float majorDist = abs(fract(majorVal - 0.5) - 0.5) / max(fwidth(majorVal), 0.0001);
              float majorMask = 1.0 - smoothstep(0.0, 1.8, majorDist);
              float cAlpha = clamp(lineMask * 0.42 + majorMask * 0.72, 0.0, 0.85);
              diffuseColor.rgb = mix(diffuseColor.rgb, uContourColor, cAlpha);
            }`,
          );
      };

      const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
      terrainMesh.receiveShadow = !engine.isSoftwareGl;
      engine.terrainGroup.add(terrainMesh);
    }

    // --- B. Street Overlay Mesh (Raster Roads + Labels) & OSM Vectors ---
    if (
      settings.showStreets &&
      streetOverlayTiles &&
      (mapStyle === 'studio' ||
        mapStyle === 'relief' ||
        mapStyle === 'blueprint' ||
        mapStyle === 'minimal')
    ) {
      const { cols, rows, elevations, minEle } = elevationGrid;
      const vertCount = cols * rows;
      const ovPos = new Float32Array(vertCount * 3);
      const ovUvs = new Float32Array(vertCount * 2);
      const ovIndices: number[] = [];

      const latScale = 111320;
      const lonScale = 111320 * Math.cos((homeLat * Math.PI) / 180);
      const flatOverlay = mapStyle === 'minimal' || mapStyle === 'blueprint';

      for (let r = 0; r < rows; r++) {
        const vz = r / (rows - 1);
        const mz = bounds.minZ + vz * (bounds.maxZ - bounds.minZ);
        const lat = homeLat - mz / latScale;
        const mercY = latToMercatorY(lat);

        for (let c = 0; c < cols; c++) {
          const vx = c / (cols - 1);
          const mx = bounds.minX + vx * (bounds.maxX - bounds.minX);
          const lon = homeLon + mx / lonScale;
          const idx = r * cols + c;
          const rawEle = elevations[idx];
          const wy = flatOverlay ? 0.08 : (rawEle - minEle) * elevScale + 0.08;

          ovPos[idx * 3] = mx * worldScale;
          ovPos[idx * 3 + 1] = wy;
          ovPos[idx * 3 + 2] = mz * worldScale;

          ovUvs[idx * 2] =
            (lon - streetOverlayTiles.minLon) /
            (streetOverlayTiles.maxLon - streetOverlayTiles.minLon);
          ovUvs[idx * 2 + 1] =
            (mercY - streetOverlayTiles.mercMinY) /
            (streetOverlayTiles.mercMaxY - streetOverlayTiles.mercMinY);
        }
      }

      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c;
          const b = a + 1;
          const d = (r + 1) * cols + c;
          const e = d + 1;
          ovIndices.push(a, d, b, b, d, e);
        }
      }

      const ovGeo = new THREE.BufferGeometry();
      ovGeo.setAttribute('position', new THREE.BufferAttribute(ovPos, 3));
      ovGeo.setAttribute('uv', new THREE.BufferAttribute(ovUvs, 2));
      ovGeo.setIndex(ovIndices);

      const ovTex = new THREE.CanvasTexture(streetOverlayTiles.canvas);
      ovTex.colorSpace = THREE.SRGBColorSpace;
      ovTex.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
      ovTex.minFilter = THREE.LinearMipmapLinearFilter;
      ovTex.magFilter = THREE.LinearFilter;
      ovTex.generateMipmaps = true;
      ovTex.wrapS = THREE.ClampToEdgeWrapping;
      ovTex.wrapT = THREE.ClampToEdgeWrapping;
      engine.streetOverlayTex = ovTex;

      const streetTintHex =
        mapStyle === 'blueprint'
          ? palette.isLight
            ? 0x334155
            : 0x38bdf8
          : mapStyle === 'minimal'
            ? palette.id === 'cobalt'
              ? 0x3b6099
              : palette.id === 'emerald'
                ? 0x3b6e5c
                : palette.isLight
                  ? 0x8c8275
                  : 0x475569
            : palette.id === 'cobalt'
              ? 0x4b7ec4
              : palette.id === 'emerald'
                ? 0x4d9980
                : palette.isLight
                  ? 0x78716c
                  : 0x64748b;

      const streetOverlayOpacity =
        mapStyle === 'blueprint'
          ? 0.74
          : mapStyle === 'minimal'
            ? 0.62
            : palette.isLight
              ? 0.72
              : 0.78;

      const streetTintUniform = { value: new THREE.Color(streetTintHex) };
      const ovMat = new THREE.MeshBasicMaterial({
        map: ovTex,
        color: 0xffffff,
        transparent: true,
        opacity: streetOverlayOpacity,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      ovMat.customProgramCacheKey = () => 'street-tint-overlay';
      ovMat.onBeforeCompile = (shader) => {
        shader.uniforms.uStreetTint = streetTintUniform;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform vec3 uStreetTint;',
          )
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float pLum = pow(clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0), 0.4545);
            float roadMask = smoothstep(0.24, 0.56, pLum);
            diffuseColor.rgb = uStreetTint;
            diffuseColor.a *= roadMask;`,
          );
      };

      const ovMesh = new THREE.Mesh(ovGeo, ovMat);
      ovMesh.renderOrder = 1;
      engine.streetsGroup.add(ovMesh);
    }

    if (settings.showStreets && streetNetwork.polylines.length > 0) {
      const segPositions: number[] = [];
      for (const poly of streetNetwork.polylines) {
        for (let i = 0; i < poly.length - 1; i++) {
          const p0 = poly[i];
          const p1 = poly[i + 1];
          const y0 =
            mapStyle === 'minimal'
              ? 0.08
              : mapStyle === 'blueprint'
                ? 0.16
                : (sampleElevationGrid(elevationGrid, p0.x, p0.z) -
                    elevationGrid.minEle) *
                    elevScale +
                  0.18;
          const y1 =
            mapStyle === 'minimal'
              ? 0.08
              : mapStyle === 'blueprint'
                ? 0.16
                : (sampleElevationGrid(elevationGrid, p1.x, p1.z) -
                    elevationGrid.minEle) *
                    elevScale +
                  0.18;
          segPositions.push(
            p0.x * worldScale,
            y0,
            p0.z * worldScale,
            p1.x * worldScale,
            y1,
            p1.z * worldScale,
          );
        }
      }
      if (segPositions.length > 0) {
        const streetGeo = new THREE.BufferGeometry();
        streetGeo.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(segPositions, 3),
        );
        const vectorStreetColor =
          mapStyle === 'blueprint'
            ? palette.isLight
              ? 0x334155
              : 0x38bdf8
            : mapStyle === 'dark-map'
              ? 0x475569
              : mapStyle === 'light-map'
                ? 0x94a3b8
                : mapStyle === 'satellite' || mapStyle === 'satellite-streets'
                  ? 0xcbd5e1
                  : palette.streetHex;

        const streetMat = new THREE.LineBasicMaterial({
          color: vectorStreetColor,
          transparent: true,
          opacity:
            mapStyle === 'satellite-streets' ||
            (mapStyle === 'satellite' && settings.showStreets)
              ? 0.22
              : mapStyle === 'minimal'
                ? 0.36
                : mapStyle === 'blueprint'
                  ? 0.38
                  : mapStyle === 'dark-map'
                    ? 0.24
                    : mapStyle === 'light-map'
                      ? 0.28
                      : Math.max(0.32, palette.streetOpacity),
        });
        const streetLines = new THREE.LineSegments(streetGeo, streetMat);
        engine.streetsGroup.add(streetLines);
      }
    }

    // --- C. Composite Home Origin Beacon & Radius Ring ---
    const effectiveElevScale =
      mapStyle === 'minimal' || mapStyle === 'blueprint' ? 0 : elevScale;
    const homeGroundY =
      (sampleElevationGrid(elevationGrid, 0, 0) - elevationGrid.minEle) *
      effectiveElevScale;

    const plinthBase = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 2.2, 0.55, 24),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.45,
        metalness: 0.75,
      }),
    );
    plinthBase.position.set(0, homeGroundY + 0.275, 0);

    const plinthRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.14, 12, 32),
      new THREE.MeshStandardMaterial({
        color: palette.homeRingHex,
        emissive: palette.homeRingHex,
        emissiveIntensity: isLightMap ? 0.35 : 1.4,
        roughness: 0.2,
        metalness: 0.4,
      }),
    );
    plinthRing.rotation.x = Math.PI / 2;
    plinthRing.position.set(0, homeGroundY + 0.58, 0);

    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.28, 4.2, 16),
      new THREE.MeshStandardMaterial({
        color: palette.homeRingHex,
        emissive: palette.homeRingHex,
        emissiveIntensity: isLightMap ? 0.3 : 1.1,
        roughness: 0.25,
        metalness: 0.2,
      }),
    );
    spire.position.set(0, homeGroundY + 2.3, 0);
    engine.homeGroup.add(plinthBase, plinthRing, spire);
    engine.homeGroup.visible = propsRef.current.showHomeMarker;

    if (settings.useHomeFilter) {
      const radiusSegs = 72;
      const ringPts: THREE.Vector3[] = [];
      for (let i = 0; i < radiusSegs; i++) {
        const theta = (i / radiusSegs) * Math.PI * 2;
        const mx = Math.cos(theta) * settings.homeRadiusM;
        const mz = Math.sin(theta) * settings.homeRadiusM;
        const my =
          (sampleElevationGrid(elevationGrid, mx, mz) - elevationGrid.minEle) *
            effectiveElevScale +
          0.35;
        ringPts.push(new THREE.Vector3(mx * worldScale, my, mz * worldScale));
      }
      const radiusGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
      const radiusMat = new THREE.LineBasicMaterial({
        color: palette.homeRingHex,
        transparent: true,
        opacity: 0.55,
      });
      const radiusLoop = new THREE.LineLoop(radiusGeo, radiusMat);
      radiusLoop.visible = propsRef.current.showRadiusRing;
      engine.radiusLoop = radiusLoop;
      engine.homeGroup.add(radiusLoop);
    }

    // --- D. Activity Ribbon Trails + Active Markers + Glow Halos ---
    const isHeatmap = settings.trailStyle === 'heatmap';
    const baseHalfWidth = (isHeatmap ? 0.32 : 0.6) * settings.trailWidth;
    const baseColor = customTrailColor.clone();
    const peakColor = customTrailColor
      .clone()
      .lerp(new THREE.Color(isLightMap ? 0x0f172a : 0xffffff), 0.48);
    const finishRingGeo = new THREE.RingGeometry(0.65, 1.0, 24);
    finishRingGeo.rotateX(-Math.PI / 2);

    const targetSegments = 200;
    const lineGlowMul = 0.28 + settings.lineGlow * 0.95;
    const lineOpacity = isLightMap
      ? isHeatmap
        ? Math.min(0.95, 0.12 + settings.lineGlow * 0.22)
        : Math.min(0.95, 0.25 + settings.lineGlow * 0.26)
      : isHeatmap
        ? Math.min(0.95, 0.08 + settings.lineGlow * 0.22)
        : Math.min(0.98, 0.25 + settings.lineGlow * 0.28);

    for (let aIdx = 0; aIdx < activities.length; aIdx++) {
      const act = activities[aIdx];
      if (act.points.length < 2 || act.durationSec <= 0) continue;

      const sampleTimes = new Float32Array(targetSegments + 1);
      const samplePts: Array<{ x: number; y: number; z: number }> = [];

      for (let s = 0; s <= targetSegments; s++) {
        const t = (s / targetSegments) * act.durationSec;
        sampleTimes[s] = t;
        const interp = interpolateActivityAtTime(act, t);
        const ele = sampleElevationGrid(elevationGrid, interp.x, interp.z);
        const yLift = isHeatmap ? 0.35 : 0.55 + (aIdx % 5) * 0.14;
        const wy = (ele - elevationGrid.minEle) * effectiveElevScale + yLift;
        samplePts.push({
          x: interp.x * worldScale,
          y: wy,
          z: interp.z * worldScale,
        });
      }

      const vertCount = samplePts.length * 2;
      const positions = new Float32Array(vertCount * 3);
      const uvs = new Float32Array(vertCount * 2);
      const indices: number[] = [];

      for (let i = 0; i < samplePts.length; i++) {
        const prev = samplePts[Math.max(0, i - 1)];
        const next = samplePts[Math.min(samplePts.length - 1, i + 1)];
        let dx = next.x - prev.x;
        let dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;

        const nx = -dz;
        const nz = dx;
        const cur = samplePts[i];

        const lIdx = i * 2;
        const rIdx = i * 2 + 1;

        positions[lIdx * 3] = cur.x + nx * baseHalfWidth;
        positions[lIdx * 3 + 1] = cur.y;
        positions[lIdx * 3 + 2] = cur.z + nz * baseHalfWidth;

        positions[rIdx * 3] = cur.x - nx * baseHalfWidth;
        positions[rIdx * 3 + 1] = cur.y;
        positions[rIdx * 3 + 2] = cur.z - nz * baseHalfWidth;

        const u = i / (samplePts.length - 1);
        uvs[lIdx * 2] = u;
        uvs[lIdx * 2 + 1] = 0;
        uvs[rIdx * 2] = u;
        uvs[rIdx * 2 + 1] = 1;

        if (i < samplePts.length - 1) {
          const a = lIdx;
          const b = rIdx;
          const c = lIdx + 2;
          const d = rIdx + 2;
          indices.push(a, b, c, b, d, c);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.setDrawRange(0, 0);

      const mixFactor = (aIdx % 7) / 6;
      const trailColor = baseColor
        .clone()
        .lerp(peakColor, isHeatmap ? mixFactor * 0.25 : mixFactor * 0.65);
      if (!isLightMap) {
        trailColor.multiplyScalar(lineGlowMul);
      }

      const mat = new THREE.MeshBasicMaterial({
        color: trailColor,
        map: engine.ribbonTex,
        transparent: true,
        opacity: lineOpacity,
        toneMapped: isLightMap,
        blending: isLightMap
          ? THREE.NormalBlending
          : isHeatmap
            ? THREE.AdditiveBlending
            : THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      engine.trailsGroup.add(mesh);

      // Additive Marker Glow Halo Sprite (behind core/custom marker)
      const glowMat = new THREE.SpriteMaterial({
        map: engine.beaconTex,
        color: isLightMap
          ? customTrailColor.getHex()
          : customTrailColor
              .clone()
              .multiplyScalar(0.8 + settings.markerGlow * 0.65),
        transparent: true,
        opacity: Math.min(1, settings.markerGlow * 0.52),
        toneMapped: isLightMap,
        depthWrite: false,
        blending: isLightMap ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      const glowSprite = new THREE.Sprite(glowMat);
      const haloScale =
        (2.2 + settings.markerGlow * 2.1) * settings.markerSize;
      glowSprite.scale.set(haloScale, haloScale, 1);
      glowSprite.visible = settings.markerGlow > 0.02;
      glowSprite.renderOrder = 9;
      engine.markersGroup.add(glowSprite);

      // Core Runner Sprite (Beacon or Custom Uploaded Face/Image)
      const isCustom = Boolean(engine.customMarkerTex);
      const lowMarkerGlow = settings.markerGlow < 0.35;
      const spriteMat = new THREE.SpriteMaterial({
        map: engine.customMarkerTex || engine.beaconTex,
        color: isCustom
          ? 0xffffff
          : lowMarkerGlow
            ? customMarkerColor.getHex()
            : customMarkerColor
                .clone()
                .multiplyScalar(0.85 + settings.markerGlow * 0.4),
        transparent: true,
        opacity: isCustom
          ? 1.0
          : Math.min(1, 0.32 + settings.markerGlow * 0.82),
        toneMapped: isCustom || isLightMap || lowMarkerGlow,
        depthWrite: false,
        blending:
          !isCustom && !isLightMap && !lowMarkerGlow
            ? THREE.AdditiveBlending
            : THREE.NormalBlending,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const spriteScale =
        (isCustom
          ? 4.4
          : Math.min(3.0, 1.3 + settings.markerGlow * 1.05)) *
        settings.markerSize;
      sprite.scale.set(spriteScale, spriteScale, 1);
      sprite.renderOrder = 10;
      engine.markersGroup.add(sprite);

      // Finish Ring Mesh
      const finishMat = new THREE.MeshBasicMaterial({
        color: peakColor.getHex(),
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const finishRing = new THREE.Mesh(finishRingGeo.clone(), finishMat);
      finishRing.visible = false;
      finishRing.renderOrder = 5;
      engine.markersGroup.add(finishRing);

      engine.trailEntries.push({
        activity: act,
        mesh,
        geometry: geo,
        material: mat,
        totalSegments: targetSegments,
        sampleTimes,
        sprite,
        glowSprite,
        finishRing,
      });
    }

    finishRingGeo.dispose();

    // Sync current playback position immediately
    engine.updateFrameState(propsRef.current.elapsedSec);
    engine.requestRender();
  }, [
    activities,
    bounds,
    elevationGrid,
    streetNetwork,
    basemapTiles,
    streetOverlayTiles,
    homeLat,
    homeLon,
    settings.palette,
    settings.baseMapStyle,
    settings.elevationExaggeration,
    settings.showTerrain,
    settings.showStreets,
    settings.showContours,
    settings.useHomeFilter,
    settings.homeRadiusM,
    settings.trailStyle,
    settings.trailWidth,
    settings.markerSize,
    settings.lineGlow,
    settings.markerGlow,
    settings.trailColor,
    settings.markerColor,
  ]);

  // 4. Sync Camera Preset smoothly via THREE.MathUtils.damp
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { pos, target } = getCameraPresetTarget(
      settings.cameraPreset,
      engine.centerX,
      engine.centerZ,
    );
    engine.cameraGoalPos = pos;
    engine.cameraGoalTarget = target;
    engine.requestRender();
  }, [settings.cameraPreset, bounds]);

  // 5. Sync playback / scrubber / autoOrbit / finish animation toggle changes
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.updateFrameState(elapsedSec);
    engine.requestRender();
  }, [elapsedSec, isPlaying, settings.autoOrbit, settings.showFinishPulse]);

  // 5b. Toggle radius circle visibility without rebuilding scene geometry
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !engine.radiusLoop) return;
    engine.radiusLoop.visible = showRadiusRing && settings.useHomeFilter;
    engine.requestRender();
  }, [showRadiusRing, settings.useHomeFilter]);

  // 5c. Hide home origin point whenever controls are collapsed
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.homeGroup.visible = showHomeMarker;
    engine.requestRender();
  }, [showHomeMarker]);

  // 6. Imperative export & camera controls
  useImperativeHandle(ref, () => ({
    resetCamera: () => {
      const engine = engineRef.current;
      if (!engine) return;
      const { pos, target } = getCameraPresetTarget(
        propsRef.current.settings.cameraPreset,
        engine.centerX,
        engine.centerZ,
      );
      engine.cameraGoalPos = pos;
      engine.cameraGoalTarget = target;
      engine.requestRender();
    },

    captureSnapshot: (datasetTitle: string) => {
      const engine = engineRef.current;
      if (!engine) return;
      const {
        activities: curActs,
        elapsedSec: curSec,
        maxDurationSec: maxSec,
        settings: curSettings,
      } = propsRef.current;
      const palette = PALETTES[curSettings.palette];

      engine.updateFrameState(curSec);
      engine.renderImmediate();

      const srcCanvas = engine.renderer.domElement;
      const out = document.createElement('canvas');
      out.width = srcCanvas.width;
      out.height = srcCanvas.height;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(srcCanvas, 0, 0);
      drawExportHud(
        ctx,
        out.width,
        out.height,
        datasetTitle,
        curActs,
        curSec,
        maxSec,
        palette.isLight,
      );

      out.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `activityvid-${formatClockHMS(curSec).replace(/:/g, '-')}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    },

    exportVideo: async (
      datasetTitle: string,
      onProgress: (pct: number) => void,
    ) => {
      const engine = engineRef.current;
      if (!engine) return;
      const {
        activities: curActs,
        maxDurationSec: maxSec,
        settings: curSettings,
        onSetPlaying: setPlayingCb,
        onTickTime: tickCb,
      } = propsRef.current;

      if (curActs.length === 0 || maxSec <= 0) return;
      setPlayingCb(false);

      const palette = PALETTES[curSettings.palette];
      const srcCanvas = engine.renderer.domElement;
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = Math.min(1920, srcCanvas.width);
      exportCanvas.height = Math.min(1080, srcCanvas.height);
      const ctx = exportCanvas.getContext('2d')!;

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const stream = exportCanvas.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 6_000_000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const finished = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: mimeType }));
        };
      });

      recorder.start();

      // 12 seconds @ 30fps = 360 frames
      const totalFrames = 360;
      for (let f = 0; f <= totalFrames; f++) {
        const progress = f / totalFrames;
        const t = progress * maxSec;

        if (curSettings.autoOrbit) {
          _vec3A.copy(engine.camera.position).sub(engine.controls.target);
          const angle = 0.008;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const nx = _vec3A.x * cos - _vec3A.z * sin;
          const nz = _vec3A.x * sin + _vec3A.z * cos;
          _vec3A.x = nx;
          _vec3A.z = nz;
          engine.camera.position.copy(engine.controls.target).add(_vec3A);
          engine.controls.update();
        }

        engine.updateFrameState(t);
        engine.renderImmediate();

        ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
        ctx.drawImage(
          srcCanvas,
          0,
          0,
          exportCanvas.width,
          exportCanvas.height,
        );
        drawExportHud(
          ctx,
          exportCanvas.width,
          exportCanvas.height,
          datasetTitle,
          curActs,
          t,
          maxSec,
          palette.isLight,
        );

        onProgress(Math.round(progress * 100));
        // Pace frame delivery to 30fps MediaRecorder
        await new Promise((r) => window.setTimeout(r, 33));
      }

      recorder.stop();
      const blob = await finished;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'activityvid-motion-graphic.webm';
      a.click();
      URL.revokeObjectURL(url);
      tickCb(maxSec);
    },
  }));

  return (
    <div
      className={`relative w-full h-full ${isPickingHome ? 'cursor-crosshair' : ''}`}
    >
      <div ref={mountRef} className="w-full h-full" />
      {webglLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#07090E]/90 text-slate-200 z-30">
          <div className="max-w-sm text-center px-6 py-5 border border-slate-800 rounded-xl bg-[#0E121B]">
            <p className="font-display text-lg font-semibold">
              WebGL Context Interrupted
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Hardware graphics context was reset. Reloading or resetting the viewport will restore the 3D scene.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
