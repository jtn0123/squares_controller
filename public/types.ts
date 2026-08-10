// Shared domain shapes used across feature modules. Types only — this
// module emits no JavaScript, so it may be imported from anywhere without
// affecting the served bundle.

// An [r, g, b] triple, 0-255. Kept as number[] rather than a tuple because
// call sites build colors with array methods; arity is enforced by the
// normalizers that produce them.
export type Rgb = number[];

export interface Palette {
  id: string;
  colors: string[];
}

export interface SavedPalette extends Palette {
  name: string;
}

export type Zone =
  | { type: "all" }
  | { type: "panel"; column: number; row: number }
  | { type: "row"; index: number }
  | { type: "column"; index: number }
  | { type: "custom"; x: number; y: number; width: number; height: number };

export interface PanelCell {
  id: string;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentTransform {
  mirrorX: boolean;
  mirrorY: boolean;
  transpose: boolean;
  grouping: number;
  spacing: number;
  offset: number;
}

export interface Segment {
  id: string;
  name: string;
  enabled: boolean;
  effect: string;
  speed: number;
  intensity: number;
  palette: Palette;
  zone: Zone;
  transform: SegmentTransform;
}

export type BlendMode = "normal" | "add" | "screen" | "multiply" | "difference";

export interface BlendLayer {
  enabled: boolean;
  effect: string;
  blend: BlendMode;
  opacity: number;
  paletteId: string;
}

export type TransitionType =
  | "cut"
  | "crossfade"
  | "push"
  | "dissolve"
  | "wipe"
  | "shift"
  | "radial"
  | "pixelate";

export interface TransitionSettings {
  type: TransitionType;
  duration: number;
}

export interface StreamTelemetry {
  targetFps: number;
  actualFps: number;
  uniqueFps: number;
  sentFrames: number;
  uniqueFrames: number;
  repeatedFrames: number;
  lateFrames: number;
  missedDeadlines: number;
  p95GapMs: number;
  maxGapMs: number;
  p95UniqueGapMs: number;
  maxUniqueGapMs: number;
  p95LatenessMs: number;
}

// Painters are pure: (time, target RGB buffer, palette hexes, ctx).
export interface PainterContext {
  width: number;
  height: number;
  zone: Zone;
  control(effect: string, control: string): number;
}

export type EffectPainter = (
  time: number,
  target: Uint8Array,
  paletteColors: readonly string[],
  ctx: PainterContext,
) => void;

export interface EffectControlSpec {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface EffectDefinition {
  id: string;
  name: string;
  subtitle: string;
  controls?: readonly EffectControlSpec[];
}

export interface MovieInfo {
  id: number;
  name: string;
  unique_id?: string;
  descriptor_type?: string;
  leds_per_frame?: number;
  frames_number?: number;
  fps?: number;
}

// The /api/status payload. Optional fields appear only on some paths
// (controllerVersion is stamped by the local server, telemetry piggybacks
// on full refreshes).
export interface ControllerStatus {
  connected: boolean;
  ip: string;
  name: string;
  productCode: string;
  firmware: string;
  ledCount: number;
  width: number;
  height: number;
  rotation: number;
  frameRate: number;
  measuredFrameRate: number;
  streamTargetFps: number;
  mode: string;
  currentMovie: MovieInfo | null;
  brightness: number;
  brightnessControl: string;
  streaming: boolean;
  streamTelemetry?: Partial<StreamTelemetry> | null;
  lastError: string | null;
  controllerVersion?: string;
}

export interface ClipFrame {
  pixels: Uint8Array;
  duration: number;
}

// Persisted scenes are JSON from disk/localStorage: most fields optional.
export interface SceneSnapshot {
  id?: string;
  name: string;
  effect: string | null;
  width: number;
  height: number;
  pixels: number[] | null;
  previewPixels?: number[];
  speed: number;
  intensity: number;
  brightness: number;
  palette?: Palette;
  zone?: Zone;
  layers?: { overlay?: BlendLayer };
  transition?: TransitionSettings;
  segments?: Segment[];
  segmentTransform?: SegmentTransform;
  effectControls?: Record<string, Record<string, number>>;
  folder?: string;
  tags?: string[] | string;
  favorite?: boolean;
  updatedAt?: number | string;
}

export interface PlaylistStep {
  sceneId: string;
  duration: number;
  transition: TransitionType;
}

export interface PlaylistItem {
  id: string;
  name: string;
  steps: PlaylistStep[];
  repeat?: boolean;
}

export interface LibrarySnapshot {
  scenes: SceneSnapshot[];
  playlists: PlaylistItem[];
  palettes: SavedPalette[];
}

export interface MovieLibrary {
  movies: MovieInfo[];
  availableFrames: number;
  maxCapacity: number;
}

export interface AudioMetrics {
  bass: number;
  mid: number;
  treble: number;
  level: number;
}

export interface AudioBeatState {
  baseline: number;
  lastBeat: number;
  pulse: number;
  beat: boolean;
}

export interface OutputContext {
  kind: string;
  name: string;
  sceneKey: string | null;
  scene: SceneSnapshot | null;
  source: string | null;
  effect: string | null;
  badge: string | null;
  kicker: string | null;
  meta: string | null;
  note: string | null;
  playback: string | null;
  controllerMovie: MovieInfo | null;
}
