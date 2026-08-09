import { normalizeEffectControls } from "./effect_catalog.js";
import { normalizeLayer } from "./blend_model.js";
import { normalizePalette } from "./palette_model.js";
import { normalizeSegmentTransform } from "./segment_model.js";
import { normalizeStreamTelemetry } from "./stream_model.js";
import { normalizeTransition } from "./transition_model.js";
import type {
  AudioBeatState,
  BlendLayer,
  ClipFrame,
  ControllerStatus,
  LibrarySnapshot,
  MovieLibrary,
  OutputContext,
  Palette,
  PainterContext,
  PlaylistStep,
  Segment,
  SegmentTransform,
  StreamTelemetry,
  TransitionSettings,
  Zone,
} from "./types.js";
import type { AutomationItem } from "./automation_model.js";

export const PRESET_STORAGE_KEY = "squares-controller.presets.v1";
export const PRESET_MIGRATION_KEY = "squares-controller.presets-migrated.v1";
export const ROTATION_STORAGE_KEY = "squares-controller.rotation.v1";
export const MAX_SAVED_PRESETS = 12;
export const FONT_STACKS: Record<string, string> = {
  condensed: '"Avenir Next Condensed", "Arial Narrow", sans-serif',
  pixel: '"Courier New", ui-monospace, monospace',
  serif: 'Georgia, "Times New Roman", serif',
};
export const EFFECT_PREVIEW_TIMES: Record<string, number> = {
  tide: 1.35,
  radar: 0.8,
  ember: 1.7,
  orbit: 1.2,
  plasma: 1.5,
  confetti: 1.1,
  rain: 1.35,
  fireworks: 1.9,
  ripples: 1.1,
  vortex: 1.4,
  galaxy: 1.6,
  waterfall: 1.25,
  life: 1.4,
  snow: 1.1,
  blobs: 1.8,
  ballpit: 1.3,
};

export interface BuiltInPreset {
  id: string;
  name: string;
  effect: string;
  speed: number;
  intensity: number;
  brightness: number;
}

export const builtInPresets: readonly BuiltInPreset[] = [
  { id: "aurora", name: "AURORA DRIFT", effect: "tide", speed: 74, intensity: 70, brightness: 28 },
  { id: "signal", name: "SIGNAL SWEEP", effect: "radar", speed: 110, intensity: 58, brightness: 24 },
  { id: "hearth", name: "WARM HEARTH", effect: "ember", speed: 52, intensity: 55, brightness: 20 },
  { id: "orbit", name: "SLOW ORBIT", effect: "orbit", speed: 42, intensity: 72, brightness: 26 },
];

const DEFAULT_WIDTH = 32;
const DEFAULT_HEIGHT = 24;

// Producer loops park either a requestAnimationFrame id or the cancel
// function returned by startPacedLoop in these handle slots.
export type FrameLoopHandle = number | (() => void) | null;

export interface AppState {
  width: number;
  height: number;
  pixels: Uint8Array;
  brush: number;
  erasing: boolean;
  drawing: boolean;
  connected: boolean;
  animationFrame: FrameLoopHandle;
  animationName: string | null;
  frameQueued: boolean;
  frameSending: boolean;
  frameErrorShown: boolean;
  nextFrameAt: number;
  toastTimer: ReturnType<typeof setTimeout> | null;
  effectSpeed: number;
  effectIntensity: number;
  effectControls: Record<string, Record<string, number>>;
  clip: { frames: ClipFrame[]; selected: number };
  rotation: number;
  backendWarningShown: boolean;
  stateEvents: EventSource | null;
  library: LibrarySnapshot;
  playlistDraft: PlaylistStep[];
  playlistTimer: ReturnType<typeof setTimeout> | null;
  playlistProgressTimer: ReturnType<typeof setInterval> | null;
  activePlaylistId: string | null;
  activePlaylistStep: {
    index: number;
    startedAt: number;
    duration: number;
    transition: string;
  } | null;
  outputContext: OutputContext;
  palette: Palette;
  zone: Zone;
  segmentTransform: SegmentTransform;
  segments: Segment[];
  overlay: BlendLayer;
  transition: TransitionSettings;
  transitionToken: number;
  mediaElement: HTMLVideoElement | HTMLImageElement | null;
  mediaFrame: FrameLoopHandle;
  mediaUrl: string | null;
  mediaStream: MediaStream | null;
  mediaLastFrame: number;
  audioStream: MediaStream | null;
  audioContext: AudioContext | null;
  audioSource: MediaStreamAudioSourceNode | null;
  audioAnalyser: AnalyserNode | null;
  audioData: Uint8Array | null;
  audioBeatState: AudioBeatState | null;
  audioLastFrame: number;
  sceneFilters: { query: string; folder: string; favoritesOnly: boolean };
  textFont: string;
  textSize: number;
  textDirection: string;
  automations: AutomationItem[];
  streamTelemetry: StreamTelemetry;
  measuredFrameRate: number;
  movieLibrary: MovieLibrary;
  controllerStatus: ControllerStatus | null;
  statusEpoch: number;
}

export const state: AppState = {
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  pixels: new Uint8Array(DEFAULT_WIDTH * DEFAULT_HEIGHT * 3),
  brush: 1,
  erasing: false,
  drawing: false,
  connected: false,
  animationFrame: null,
  animationName: null,
  frameQueued: false,
  frameSending: false,
  frameErrorShown: false,
  nextFrameAt: 0,
  toastTimer: null,
  effectSpeed: 1,
  effectIntensity: 0.75,
  effectControls: {},
  clip: { frames: [], selected: -1 },
  rotation: 0,
  backendWarningShown: false,
  stateEvents: null,
  library: { scenes: [], playlists: [], palettes: [] },
  playlistDraft: [],
  playlistTimer: null,
  playlistProgressTimer: null,
  activePlaylistId: null,
  activePlaylistStep: null,
  outputContext: {
    kind: "canvas",
    name: "CURRENT CANVAS",
    sceneKey: null,
    scene: null,
    source: null,
    effect: null,
    badge: null,
    kicker: null,
    meta: null,
    note: null,
    playback: null,
    controllerMovie: null,
  },
  palette: normalizePalette(null),
  zone: { type: "all" },
  segmentTransform: normalizeSegmentTransform(
    null,
    DEFAULT_WIDTH * DEFAULT_HEIGHT,
  ),
  segments: [],
  overlay: normalizeLayer({
    enabled: false,
    effect: "orbit",
    blend: "screen",
    opacity: 55,
    paletteId: "candy",
  }),
  transition: normalizeTransition({ type: "crossfade", duration: 800 }),
  transitionToken: 0,
  mediaElement: null,
  mediaFrame: null,
  mediaUrl: null,
  mediaStream: null,
  mediaLastFrame: 0,
  audioStream: null,
  audioContext: null,
  audioSource: null,
  audioAnalyser: null,
  audioData: null,
  audioBeatState: null,
  audioLastFrame: 0,
  sceneFilters: {
    query: "",
    folder: "ALL",
    favoritesOnly: false,
  },
  textFont: FONT_STACKS.condensed,
  textSize: 13,
  textDirection: "left",
  automations: [],
  streamTelemetry: normalizeStreamTelemetry(null),
  measuredFrameRate: 30,
  movieLibrary: { movies: [], availableFrames: 0, maxCapacity: 0 },
  controllerStatus: null,
  // Incremented for every user-initiated controller mutation; slow HTTP
  // responses from an older action must not overwrite newer state.
  statusEpoch: 0,
};

export function effectControl(effect: string, control: string): number {
  return normalizeEffectControls(
    effect,
    state.effectControls[effect],
  )[control];
}

// Painter context bound to the live application state; pass an explicit
// zone so segments can render without mutating shared state.
export function painterContext(zone: Zone = state.zone): PainterContext {
  return {
    width: state.width,
    height: state.height,
    zone,
    control: effectControl,
  };
}
