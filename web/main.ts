import { inspectFields, placePosition, stateCopy, worldState } from "./state.ts";
import { inspectSourceFields } from "../src/world-form.ts";
import { drawPlace, drawTerrain } from "./terrain.ts";

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}

const world = element("world");
const terrain = element<HTMLCanvasElement>("terrain");
const viewport = element("viewport");
const panel = element<HTMLDialogElement>("inspect");
const close = element<HTMLButtonElement>("close");
let selected: HTMLButtonElement | undefined;
close.addEventListener("click", () => panel.close());
panel.addEventListener("close", () => selected?.focus());

function paint(): void {
  terrain.width = Math.ceil(world.clientWidth / 2);
  terrain.height = Math.ceil(world.clientHeight / 2);
  drawTerrain(terrain);
}
new ResizeObserver(paint).observe(world);

async function load(): Promise<void> {
  let state;
  try {
    const response = await fetch("/api/world-snapshot", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    state = response.ok ? worldState(await response.json()) : worldState(undefined, true);
  } catch { state = worldState(undefined, true); }
  const notice = element("notice");
  notice.dataset.state = state.kind;
  if (state.kind === "error") notice.setAttribute("role", "alert");
  element("notice-title").textContent = stateCopy[state.kind].title;
  element("notice-detail").textContent = stateCopy[state.kind].detail;
  if (state.kind !== "ready" && state.kind !== "empty") return;
  const snapshot = state.snapshot;
  const last = placePosition(Math.max(0, snapshot.civilizations.length - 1));
  world.style.height = `${Math.max(800, last.y + 200)}px`;
  for (const [index, entry] of snapshot.civilizations.entries()) {
    const position = placePosition(index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "place";
    button.style.left = `${position.x}px`;
    button.style.top = `${position.y}px`;
    button.setAttribute("aria-label", `Les erklæringen: ${entry.name}`);
    const canvas = document.createElement("canvas");
    canvas.width = 60;
    canvas.height = 40;
    canvas.setAttribute("aria-hidden", "true");
    drawPlace(canvas);
    const name = document.createElement("span");
    name.textContent = entry.name;
    button.append(canvas, name);
    button.addEventListener("click", () => {
      selected = button;
      element("inspect-title").textContent = entry.name;
      const fields = element("fields");
      fields.replaceChildren();
      const picture = snapshot.sourcePictures.find((picture) => picture.civilizationId === entry.civilizationId)!;
      for (const field of [{ label: "Skjemaversjon", values: [String(snapshot.schemaVersion)] }, ...inspectFields(entry), ...inspectSourceFields(picture, snapshot)]) {
        const term = document.createElement("dt");
        term.textContent = field.label;
        fields.append(term);
        for (const value of field.values) {
          const description = document.createElement("dd");
          description.textContent = value;
          fields.append(description);
        }
      }
      panel.showModal();
      close.focus();
    });
    button.addEventListener("focus", () => button.scrollIntoView({ block: "nearest", inline: "nearest" }));
    element("places").append(button);
  }
  viewport.scrollLeft = 0;
}
void load();
