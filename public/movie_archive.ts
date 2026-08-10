// Local copies of movies this app baked onto the panel.
//
// The controller will not return frame data — every read path 404s — so
// a movie that only lives on the panel cannot be previewed, exported,
// or rebuilt. The archive keeps the source frames on this machine,
// which is what makes the thumbnails real and lets a movie be pulled
// off the wall, kept as a file, and put back later unchanged.
import { $ } from "./dom.js";
import { api, toast } from "./net.js";
import { drawRgbCanvas } from "./render_core.js";
import { loadMovies } from "./status_view.js";

interface ArchiveEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  savedAt: number;
  deviceMovieId: number | null;
  thumbnailBase64: string;
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    // atob yields latin1 code units (0-255), so no surrogate pairs.
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
}

function actionButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "archive-action";
  button.textContent = label;
  button.setAttribute("aria-label", title);
  return button;
}

async function downloadArchive(entry: ArchiveEntry): Promise<void> {
  const payload = await api<{ archive: unknown }>(
    `/api/movies/archive/${encodeURIComponent(entry.id)}`,
  );
  const blob = new Blob([JSON.stringify(payload.archive)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.squares-movie.json`;
  link.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(`Saved ${entry.name} to your downloads.`);
}

async function restoreArchive(entry: ArchiveEntry): Promise<void> {
  await api(`/api/movies/archive/${encodeURIComponent(entry.id)}/restore`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  await loadMovies();
  toast(`${entry.name} is back on the panel.`);
}

async function forgetArchive(entry: ArchiveEntry): Promise<void> {
  await api(`/api/movies/archive/${encodeURIComponent(entry.id)}`, {
    method: "DELETE",
  });
  toast(`Removed the local copy of ${entry.name}.`);
}

function buildCard(entry: ArchiveEntry): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "archive-card";

  const canvas = document.createElement("canvas");
  canvas.className = "archive-thumb";
  canvas.setAttribute("aria-hidden", "true");
  drawRgbCanvas(
    canvas,
    decodeBase64(entry.thumbnailBase64),
    entry.width,
    entry.height,
  );

  const copy = document.createElement("span");
  copy.className = "archive-copy";
  const name = document.createElement("strong");
  name.textContent = entry.name;
  const detail = document.createElement("small");
  const seconds = (entry.frameCount / Math.max(1, entry.fps)).toFixed(1);
  detail.textContent =
    `${entry.frameCount}F / ${entry.fps}FPS / ${seconds}s`;
  copy.append(name, detail);

  const actions = document.createElement("div");
  actions.className = "archive-actions";
  // TO PANEL runs a multi-second bake; a second click would queue a
  // second bake and write a duplicate movie into scarce panel storage.
  let inFlight = false;
  const run = (job: () => Promise<void>) => async () => {
    if (inFlight) return;
    inFlight = true;
    card.classList.add("busy");
    const buttons = [...actions.querySelectorAll("button")];
    buttons.forEach((button) => (button.disabled = true));
    try {
      await job();
      // renderArchive replaces this card, so nothing to re-enable here.
      await renderArchive();
    } catch (error) {
      toast((error as Error).message, true);
      card.classList.remove("busy");
      buttons.forEach((button) => (button.disabled = false));
      inFlight = false;
    }
  };
  const save = actionButton("SAVE", `Save ${entry.name} to this computer`);
  save.addEventListener("click", () => void run(() => downloadArchive(entry))());
  const restore = actionButton("TO PANEL", `Put ${entry.name} back on the panel`);
  restore.addEventListener("click", () => void run(() => restoreArchive(entry))());
  const forget = actionButton("FORGET", `Delete the local copy of ${entry.name}`);
  forget.classList.add("danger");
  forget.addEventListener("click", () => void run(() => forgetArchive(entry))());
  actions.append(save, restore, forget);

  card.append(canvas, copy, actions);
  return card;
}

export async function renderArchive(): Promise<void> {
  const list = $("#panelArchiveList");
  let entries: ArchiveEntry[] = [];
  try {
    entries = (await api<{ archive: ArchiveEntry[] }>("/api/movies/archive"))
      .archive;
  } catch {
    // The archive is a local convenience; failing to read it must not
    // take the rest of the panel section down with it. But a silent
    // blank would be indistinguishable from an empty archive.
    const failed = document.createElement("small");
    failed.className = "local-note";
    failed.textContent = "COULD NOT READ THE LOCAL ARCHIVE";
    list.replaceChildren(failed);
    return;
  }
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("small");
    empty.className = "local-note";
    empty.textContent =
      "NOTHING ARCHIVED YET / BAKE A LOOK TO KEEP A LOCAL COPY";
    list.append(empty);
    return;
  }
  entries.forEach((entry) => list.append(buildCard(entry)));
}

export function initializeMovieArchive(): void {
  const input = $<HTMLInputElement>("#archiveImport");
  input.addEventListener("change", () => {
    const [file] = input.files ?? [];
    if (!file) return;
    // The server caps archives at 8 MB of frames; base64 plus JSON
    // overhead puts a legitimate file near 11 MB. Reading anything much
    // larger into a string would stall the tab before the server could
    // reject it.
    if (file.size > 16_000_000) {
      toast("That file is too large to be a movie archive.", true);
      input.value = "";
      return;
    }
    void (async () => {
      try {
        const archive: unknown = JSON.parse(await file.text());
        await api("/api/movies/import", {
          method: "POST",
          body: JSON.stringify({ archive }),
        });
        await renderArchive();
        toast("Archive imported. Use TO PANEL to bake it back.");
      } catch (error) {
        toast((error as Error).message, true);
      } finally {
        input.value = "";
      }
    })();
  });
  void renderArchive();
}
