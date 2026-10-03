import { civilizations } from "./fixture.ts";

export type CivTab = "tavle" | "prosjekter" | "agenter" | "kilder" | "mandat";
export type ProjectTab = "tavle" | "om";
export const civTabs: { id: CivTab; name: string }[] = [
  { id: "tavle", name: "Tavle" }, { id: "prosjekter", name: "Prosjekter" }, { id: "agenter", name: "Agenter" }, { id: "kilder", name: "Kilder" }, { id: "mandat", name: "Mandat" },
];
export const projectTabs: { id: ProjectTab; name: string }[] = [{ id: "tavle", name: "Tavle" }, { id: "om", name: "Om prosjektet" }];

export type Route =
  | { kind: "overview" }
  | { kind: "civs" }
  | { kind: "projects" }
  | { kind: "agents" }
  | { kind: "council"; matter: string | null }
  | { kind: "chronicler" }
  | { kind: "search"; q: string }
  | { kind: "settings" }
  | { kind: "civ"; id: string; tab: CivTab; card: string | null }
  | { kind: "project"; id: string; slug: string; tab: ProjectTab; card: string | null };

export const nav: { kind: Route["kind"]; name: string; href: string }[] = [
  { kind: "overview", name: "Oversikt", href: "#/" },
  { kind: "civs", name: "Sivilisasjoner", href: "#/sivilisasjoner" },
  { kind: "projects", name: "Prosjekter", href: "#/prosjekter" },
  { kind: "agents", name: "Agenter", href: "#/agenter" },
  { kind: "council", name: "Rådet", href: "#/raadet" },
  { kind: "chronicler", name: "Krønikeren", href: "#/kroniker" },
  { kind: "search", name: "Søk", href: "#/sok" },
  { kind: "settings", name: "Innstillinger", href: "#/innstillinger" },
];

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b, c, d, e] = parts;
  switch (head) {
    case undefined: return { kind: "overview" };
    case "sivilisasjoner": return { kind: "civs" };
    case "prosjekter": return { kind: "projects" };
    case "agenter": return { kind: "agents" };
    case "raadet": return { kind: "council", matter: a ?? null };
    case "kroniker": return { kind: "chronicler" };
    case "sok": return { kind: "search", q: a ?? "" };
    case "innstillinger": return { kind: "settings" };
    case "s": {
      const civ = civilizations.find((x) => x.id === a);
      if (!civ) return { kind: "overview" };
      if (b === "p" && c && civ.projects.some((p) => p.slug === c)) {
        const tab: ProjectTab = d === "om" ? "om" : "tavle";
        return { kind: "project", id: civ.id, slug: c, tab, card: tab === "tavle" && e ? e : null };
      }
      const tab = civTabs.some((t) => t.id === b) ? (b as CivTab) : "tavle";
      return { kind: "civ", id: civ.id, tab, card: tab === "tavle" && c ? c : null };
    }
    default: return { kind: "overview" };
  }
}

export function href(route: Route): string {
  switch (route.kind) {
    case "overview": return "#/";
    case "civs": return "#/sivilisasjoner";
    case "projects": return "#/prosjekter";
    case "agents": return "#/agenter";
    case "council": return route.matter ? `#/raadet/${route.matter}` : "#/raadet";
    case "chronicler": return "#/kroniker";
    case "search": return route.q ? `#/sok/${encodeURIComponent(route.q)}` : "#/sok";
    case "settings": return "#/innstillinger";
    case "civ": return `#/s/${route.id}${route.tab === "tavle" && route.card === null ? "" : `/${route.tab}`}${route.card ? `/${route.card}` : ""}`;
    case "project": return `#/s/${route.id}/p/${route.slug}${route.tab === "tavle" && route.card === null ? "" : `/${route.tab}`}${route.card ? `/${route.card}` : ""}`;
  }
}

export const civRoute = (id: string, tab: CivTab = "tavle", card: string | null = null): Route => ({ kind: "civ", id, tab, card });
export const projectRoute = (id: string, slug: string, tab: ProjectTab = "tavle", card: string | null = null): Route => ({ kind: "project", id, slug, tab, card });
