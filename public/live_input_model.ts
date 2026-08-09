import { sampleGradient } from "./palette_model.js";
import type { AudioBeatState, AudioMetrics, Rgb } from "./types.js";

export type AudioMode = "spectrum" | "halo" | "bands";

export interface AudioControls {
  mode: AudioMode;
  sensitivity: number;
  smoothing: number;
}

// Everything renderAudioFrame needs to paint one visualizer frame.
export interface AudioFrameOptions {
  width: number;
  height: number;
  bins?: ArrayLike<number> | null;
  mode?: string;
  sensitivity?: number;
  palette: readonly string[];
  time?: number;
  beatPulse?: number;
}

const AUDIO_MODES: ReadonlySet<string> = new Set(["spectrum", "halo", "bands"]);

function clamp(value: number, minimum: number, maximum: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function averageRange(
  values: ArrayLike<number>,
  start: number,
  stop: number,
): number {
  const first = Math.max(0, Math.min(values.length, Math.floor(start)));
  const last = Math.max(first + 1, Math.min(values.length, Math.ceil(stop)));
  let total = 0;
  for (let index = first; index < last; index += 1) {
    total += Number(values[index]) || 0;
  }
  return total / (last - first);
}

export function normalizeAudioControls(value: unknown): AudioControls {
  const raw = (value ?? {}) as {
    mode?: string;
    sensitivity?: number;
    smoothing?: number;
  };
  return {
    // has() vouches for membership; the cast names the union for the compiler.
    mode:
      raw.mode !== undefined && AUDIO_MODES.has(raw.mode)
        ? (raw.mode as AudioMode)
        : "spectrum",
    sensitivity: clamp(raw.sensitivity ?? 1, 0.25, 4),
    smoothing: clamp(raw.smoothing ?? 0.72, 0, 0.95),
  };
}

export function measureAudioBands(
  frequencyData: ArrayLike<number> | null | undefined,
  sensitivity = 1,
): AudioMetrics {
  const bins =
    frequencyData && typeof frequencyData.length === "number"
      ? frequencyData
      : [];
  if (!bins.length) {
    return { bass: 0, mid: 0, treble: 0, level: 0 };
  }
  const gain = clamp(sensitivity, 0.25, 4);
  const bassStop = bins.length * 0.15;
  const midStop = bins.length * 0.55;
  const scale = (value: number): number => clamp((value / 255) * gain, 0, 1);
  const bass = scale(averageRange(bins, 0, bassStop));
  const mid = scale(averageRange(bins, bassStop, midStop));
  const treble = scale(averageRange(bins, midStop, bins.length));
  return {
    bass,
    mid,
    treble,
    level: clamp(bass * 0.46 + mid * 0.36 + treble * 0.18, 0, 1),
  };
}

export function detectAudioBeat(
  previous: AudioBeatState | null,
  bass: number,
  now: number,
): AudioBeatState {
  const energy = clamp(bass, 0, 1);
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : 0;
  if (!previous) {
    return {
      baseline: energy,
      lastBeat: Number.NEGATIVE_INFINITY,
      pulse: 0,
      beat: false,
    };
  }
  const baseline = previous.baseline * 0.92 + energy * 0.08;
  const cooledDown = timestamp - previous.lastBeat >= 180;
  const beat =
    cooledDown && energy >= 0.18 && energy > Math.max(0.18, baseline * 1.45);
  return {
    baseline,
    lastBeat: beat ? timestamp : previous.lastBeat,
    pulse: beat ? 1 : clamp(previous.pulse * 0.78, 0, 1),
    beat,
  };
}

function paint(
  frame: Uint8Array,
  offset: number,
  rgb: Rgb,
  intensity: number,
): void {
  const gain = clamp(intensity, 0, 1);
  frame[offset] = Math.round(rgb[0] * gain);
  frame[offset + 1] = Math.round(rgb[1] * gain);
  frame[offset + 2] = Math.round(rgb[2] * gain);
}

export function renderAudioFrame({
  width,
  height,
  bins,
  mode = "spectrum",
  sensitivity = 1,
  palette,
  time = 0,
  beatPulse = 0,
}: AudioFrameOptions): Uint8Array {
  const columns = Math.max(1, Math.floor(Number(width) || 1));
  const rows = Math.max(1, Math.floor(Number(height) || 1));
  const frame = new Uint8Array(columns * rows * 3);
  const settings = normalizeAudioControls({ mode, sensitivity });
  const frequencies =
    bins && typeof bins.length === "number" && bins.length
      ? bins
      : new Uint8Array(1);
  const metrics = measureAudioBands(frequencies, settings.sensitivity);
  const pulse = clamp(beatPulse, 0, 1);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const offset = (y * columns + x) * 3;
      let intensity = 0;
      let position = columns === 1 ? 0 : x / (columns - 1);

      if (settings.mode === "spectrum") {
        const binIndex = Math.min(
          frequencies.length - 1,
          Math.floor(position * frequencies.length),
        );
        const energy = clamp(
          (frequencies[binIndex] / 255) * settings.sensitivity,
          0,
          1,
        );
        const litRows = Math.ceil(energy * rows);
        if (y >= rows - litRows) {
          const vertical = (rows - y) / Math.max(1, litRows);
          intensity = 0.42 + vertical * 0.58;
        }
      } else if (settings.mode === "bands") {
        const bandIndex = Math.min(2, Math.floor((x / columns) * 3));
        const energy = [metrics.bass, metrics.mid, metrics.treble][bandIndex];
        const litRows = Math.ceil(energy * rows);
        if (y >= rows - litRows) {
          intensity = 0.38 + energy * 0.62;
          position = (bandIndex + (rows - y) / rows) / 3;
        }
      } else {
        const dx = (x - (columns - 1) / 2) / Math.max(1, columns / 2);
        const dy = (y - (rows - 1) / 2) / Math.max(1, rows / 2);
        const distance = Math.hypot(dx, dy);
        const radius = 0.16 + metrics.bass * 0.48 + pulse * 0.14;
        const thickness = 0.07 + metrics.mid * 0.13;
        const ring = Math.max(0, 1 - Math.abs(distance - radius) / thickness);
        const core = Math.max(0, 1 - distance / Math.max(0.08, radius)) *
          metrics.level *
          0.28;
        intensity = clamp(ring * (0.45 + metrics.level * 0.55) + core, 0, 1);
        position = distance * 0.62 + Number(time) * 0.035;
      }

      if (intensity > 0) {
        paint(
          frame,
          offset,
          sampleGradient(palette, position + Number(time) * 0.018),
          intensity,
        );
      }
    }
  }
  return frame;
}
