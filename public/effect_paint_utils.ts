import { zoneContains } from "./zone_model.js";
import type { PainterContext, Rgb } from "./types.js";

// Every painter receives a context of { width, height, zone, control } so
// the pixel math stays pure: no painter reads application state directly.
export function paintPixel(
  ctx: PainterContext,
  target: Uint8Array,
  x: number,
  y: number,
  rgb: Rgb,
): void {
  if (
    x < 0 ||
    y < 0 ||
    x >= ctx.width ||
    y >= ctx.height ||
    !zoneContains(ctx.zone, x, y, ctx.width, ctx.height)
  ) {
    return;
  }
  target.set(rgb, (y * ctx.width + x) * 3);
}
