import config from "./app-config.json" with { type: "json" };

export const locales = ["pl", "en"];
export const basePath = config.basePath;
export const publicOrigin = config.siteOrigin;
const patterns = {
  home: "", catalog: "Biblia", translation: "Biblia/:source", book: "Biblia/:source/:book",
  chapter: "Biblia/:source/:book/:chapter", verse: "Biblia/Werset/:book/:chapter/:verse",
  note: "Study/TNP/:book/:chapter/:verse/notes/:ordinal",
  word: "Study/TR/:book/:chapter/:verse/words/:ordinal",
  dictionary: "Dictionary", dictionaryLetter: "Dictionary/letters/:initial", entry: "Dictionary/:key",
  fathers: "Ojcowie", author: "Ojcowie/Ignatius", work: "Ojcowie/Ignatius/:work", passage: "Ojcowie/Ignatius/:work/:chapter",
  tags: "Tag", tag: "Tag/:slug", literature: "Teksty", search: "Search", help: "Help", application: "App"
};
const segments = Object.entries(patterns).map(([kind, pattern]) => [kind, pattern.split("/").filter(Boolean)]);
export function pathFor(route) {
  const pattern = segments.find(([kind]) => kind === route.kind);
  if (!pattern || !locales.includes(route.locale)) throw new Error("Unknown route");
  const parts = pattern[1].map(bit => {
    if (!bit.startsWith(":")) return bit;
    const value = String(route[bit.slice(1)]);
    if (!value || value === "." || value === ".." || /[/\\\u0000]/.test(value)) throw new Error("Invalid segment");
    return encodeURIComponent(value);
  });
  return basePath + [route.locale, ...parts].join("/") + "/";
}
export function parseRoute(url) {
  const { pathname, searchParams } = new URL(url, publicOrigin);
  if (!pathname.startsWith(basePath)) return null;
  let parts;
  try { parts = pathname.slice(basePath.length).replace(/\/$/, "").split("/").map(decodeURIComponent); }
  catch { return null; }
  const locale = parts.shift();
  if (!locales.includes(locale) || parts.some(x => !x || /[/\\\u0000]/.test(x))) return null;
  for (const [kind, pattern] of segments) {
    if (parts.length !== pattern.length) continue;
    const route = { kind, locale };
    const matches = pattern.every((bit, index) => {
      if (!bit.startsWith(":")) return bit === parts[index];
      const key = bit.slice(1), value = parts[index];
      if (["chapter", "verse", "ordinal"].includes(key)) {
        if (!/^(0|[1-9]\d{0,4})$/.test(value) || (value === "0" && !(kind === "passage" && key === "chapter"))) return false;
        route[key] = Number(value);
      } else route[key] = value;
      return true;
    });
    if (matches) {
      if (kind === "search") route.q = searchParams.get("q")?.slice(0, 160) ?? "";
      return route;
    }
  }
  return null;
}
export function localized(route, locale) {
  return pathFor({ ...route, locale }) + (route.kind === "search" && route.q ? "?q=" + encodeURIComponent(route.q) : "");
}
