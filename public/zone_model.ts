import type { PanelCell, Zone } from "./types.js";

const PANEL_SIZE = 8;
const ZONE_TYPES = new Set<string>(["all", "panel", "row", "column", "custom"]);

// Raw zones arrive from persisted JSON or API payloads; every field is suspect.
type RawZone = Partial<{
  type: string;
  column: number;
  row: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  const numeric = Number.isFinite(Number(value)) ? Math.round(Number(value)) : minimum;
  return Math.max(minimum, Math.min(maximum, numeric));
}

export function panelGrid(
  width: number,
  height: number,
  panelSize: number = PANEL_SIZE,
): PanelCell[] {
  const columns = Math.ceil(width / panelSize);
  const rows = Math.ceil(height / panelSize);
  const panels: PanelCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      panels.push({
        id: `panel-${column}-${row}`,
        column,
        row,
        x: column * panelSize,
        y: row * panelSize,
        width: Math.min(panelSize, width - column * panelSize),
        height: Math.min(panelSize, height - row * panelSize),
      });
    }
  }
  return panels;
}

export function normalizeZone(rawZone: unknown, width: number, height: number): Zone {
  const raw = (rawZone ?? {}) as RawZone;
  // Membership in ZONE_TYPES guarantees the string is a Zone["type"].
  const type =
    raw.type !== undefined && ZONE_TYPES.has(raw.type)
      ? (raw.type as Zone["type"])
      : "all";
  if (type === "all") return { type: "all" };
  if (type === "panel") {
    return {
      type,
      column: clampInteger(raw.column, 0, Math.max(0, Math.ceil(width / PANEL_SIZE) - 1)),
      row: clampInteger(raw.row, 0, Math.max(0, Math.ceil(height / PANEL_SIZE) - 1)),
    };
  }
  if (type === "row") {
    return { type, index: clampInteger(raw.index, 0, Math.max(0, height - 1)) };
  }
  if (type === "column") {
    return { type, index: clampInteger(raw.index, 0, Math.max(0, width - 1)) };
  }
  const x = clampInteger(raw.x, 0, Math.max(0, width - 1));
  const y = clampInteger(raw.y, 0, Math.max(0, height - 1));
  return {
    type,
    x,
    y,
    width: clampInteger(raw.width, 1, Math.max(1, width - x)),
    height: clampInteger(raw.height, 1, Math.max(1, height - y)),
  };
}

export function zoneContains(
  rawZone: unknown,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const bounds = zoneBounds(rawZone, width, height);
  return (
    x >= bounds.x &&
    x < bounds.x + bounds.width &&
    y >= bounds.y &&
    y < bounds.y + bounds.height
  );
}

export function zoneBounds(rawZone: unknown, width: number, height: number): ZoneBounds {
  const zone = normalizeZone(rawZone, width, height);
  if (zone.type === "panel") {
    return {
      x: zone.column * PANEL_SIZE,
      y: zone.row * PANEL_SIZE,
      width: Math.min(PANEL_SIZE, width - zone.column * PANEL_SIZE),
      height: Math.min(PANEL_SIZE, height - zone.row * PANEL_SIZE),
    };
  }
  if (zone.type === "row") {
    return { x: 0, y: zone.index, width, height: 1 };
  }
  if (zone.type === "column") {
    return { x: zone.index, y: 0, width: 1, height };
  }
  if (zone.type === "custom") {
    return { x: zone.x, y: zone.y, width: zone.width, height: zone.height };
  }
  return { x: 0, y: 0, width, height };
}

export function describeZone(zone: Zone | null | undefined): string {
  if (zone?.type === "panel") return `PANEL C${zone.column + 1} / R${zone.row + 1}`;
  if (zone?.type === "row") return `ROW ${zone.index + 1}`;
  if (zone?.type === "column") return `COLUMN ${zone.index + 1}`;
  if (zone?.type === "custom") {
    return `RECT ${zone.x + 1},${zone.y + 1} / ${zone.width}×${zone.height}`;
  }
  return "WHOLE WALL";
}
