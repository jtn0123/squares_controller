import { $ } from "./dom.js";
import { state } from "./app_state.js";
import { api, toast } from "./net.js";
import { queueEffectPreviewRender } from "./effects_ui.js";
import { loadLibrary } from "./library_sync.js";
import { CURATED_PALETTES, normalizePalette } from "./palette_model.js";
import type { Palette, SavedPalette } from "./types.js";

// Curated and saved palettes carry names; a custom gradient may not.
type NamedPalette = Palette & { name?: string };

export function availablePalettes(): NamedPalette[] {
  return [...CURATED_PALETTES, ...state.library.palettes];
}

export function renderPaletteOptions(): void {
  const select = $<HTMLSelectElement>("#paletteSelect");
  const palettes = availablePalettes();
  const selectedId = palettes.some(
    (palette) => palette.id === state.palette.id,
  )
    ? state.palette.id
    : "custom";
  select.replaceChildren();
  palettes.forEach((palette) => {
    const option = document.createElement("option");
    option.value = palette.id;
    option.textContent =
      palette.name ?? palette.id.replaceAll("-", " ").toUpperCase();
    select.append(option);
  });
  const customOption = document.createElement("option");
  customOption.value = "custom";
  customOption.textContent = "UNSAVED GRADIENT";
  select.append(customOption);
  select.value = selectedId;

  const overlaySelect = $<HTMLSelectElement>("#overlayPalette");
  if (overlaySelect) {
    const overlayId = state.overlay.paletteId;
    overlaySelect.replaceChildren();
    palettes.forEach((palette) => {
      const option = document.createElement("option");
      option.value = palette.id;
      option.textContent =
        palette.name ?? palette.id.replaceAll("-", " ").toUpperCase();
      overlaySelect.append(option);
    });
    overlaySelect.value = palettes.some((palette) => palette.id === overlayId)
      ? overlayId
      : CURATED_PALETTES[0].id;
  }
}

export function renderPaletteWorkshop(): void {
  const list = $("#paletteStopList");
  if (!list) return;
  list.replaceChildren();
  state.palette.colors.forEach((color, index) => {
    const stop = document.createElement("label");
    stop.className = "palette-stop";
    const input = document.createElement("input");
    input.type = "color";
    input.value = color;
    input.setAttribute("aria-label", `Palette color stop ${index + 1}`);
    input.addEventListener("input", () => {
      const colors = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          "#paletteStopList input[type='color']",
        ),
        (element) => element.value,
      );
      state.palette = normalizePalette({ id: "custom", colors });
      updatePaletteControls(false);
    });
    input.addEventListener("change", queueEffectPreviewRender);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove palette color stop ${index + 1}`);
    remove.disabled = state.palette.colors.length <= 2;
    remove.addEventListener("click", () => {
      const colors = state.palette.colors.filter(
        (_color, colorIndex) => colorIndex !== index,
      );
      applyPalette({ id: "custom", colors });
    });
    stop.append(input, remove);
    list.append(stop);
  });
  $("#paletteStopCount").textContent =
    `${state.palette.colors.length} STOPS`;
  const saved = state.library.palettes.find(
    (palette) => palette.id === state.palette.id,
  );
  $<HTMLInputElement>("#paletteName").value = saved?.name ?? "";
  $<HTMLButtonElement>("#deletePaletteButton").disabled = !saved;
}

export function updatePaletteControls(renderStops = true): void {
  renderPaletteOptions();
  const colors = state.palette.colors;
  $<HTMLInputElement>("#gradientStart").value = colors[0];
  $<HTMLInputElement>("#gradientMiddle").value =
    colors[Math.floor((colors.length - 1) / 2)];
  // Normalized palettes always keep at least two stops.
  $<HTMLInputElement>("#gradientEnd").value = colors.at(-1)!;
  $("#palettePreview").style.background =
    `linear-gradient(90deg, ${colors.join(", ")})`;
  if (renderStops) renderPaletteWorkshop();
}

export function applyPalette(palette: unknown, announce = false): void {
  state.palette = normalizePalette(palette);
  updatePaletteControls();
  queueEffectPreviewRender();
  if (announce) toast(`Palette set to ${state.palette.id.toUpperCase()}.`);
}

export function initializePalettes(): void {
  const select = $<HTMLSelectElement>("#paletteSelect");
  renderPaletteOptions();
  select.addEventListener("change", () => {
    if (select.value === "custom") return;
    applyPalette(
      availablePalettes().find((palette) => palette.id === select.value),
      true,
    );
  });
  $("#applyGradientButton").addEventListener("click", () => {
    applyPalette(
      {
        id: "custom",
        colors: [
          $<HTMLInputElement>("#gradientStart").value,
          $<HTMLInputElement>("#gradientMiddle").value,
          $<HTMLInputElement>("#gradientEnd").value,
        ],
      },
      true,
    );
  });
  $("#addPaletteStopButton").addEventListener("click", () => {
    if (state.palette.colors.length >= 8) {
      toast("A palette can have at most eight color stops.", true);
      return;
    }
    const colors = [...state.palette.colors];
    // Normalized palettes always keep at least two stops.
    colors.splice(-1, 0, colors.at(-1)!);
    applyPalette({ id: "custom", colors });
  });
  $("#savePaletteButton").addEventListener("click", async () => {
    const nameInput = $<HTMLInputElement>("#paletteName");
    const name = nameInput.value.trim();
    if (!name) {
      toast("Name the palette first.", true);
      nameInput.focus();
      return;
    }
    const existing = state.library.palettes.find(
      (palette) => palette.id === state.palette.id || palette.name === name.toUpperCase(),
    );
    try {
      const response = await api<{ palette: SavedPalette }>("/api/palettes", {
        method: "POST",
        body: JSON.stringify({
          ...(existing ? { id: existing.id } : {}),
          name,
          colors: state.palette.colors,
        }),
      });
      await loadLibrary();
      applyPalette(response.palette, true);
    } catch (error) {
      toast((error as Error).message, true);
    }
  });
  $("#deletePaletteButton").addEventListener("click", async () => {
    const saved = state.library.palettes.find(
      (palette) => palette.id === state.palette.id,
    );
    if (!saved) return;
    try {
      await api(`/api/palettes/${encodeURIComponent(saved.id)}`, {
        method: "DELETE",
      });
      applyPalette(CURATED_PALETTES[0]);
      await loadLibrary();
      toast(`Deleted ${saved.name}.`);
    } catch (error) {
      toast((error as Error).message, true);
    }
  });
  updatePaletteControls();
}
