import { basePath, localized, pathFor, publicOrigin } from "../routes.js";
import { catalog } from "../i18n/index.js";

export const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function link(route, text, options = {}) {
  const { detail, fragment = "", label, lang, className } = options;
  const href = pathFor(route) + (fragment ? "#" + encodeURIComponent(fragment) : "");
  return `<a href="${esc(href)}"${detail ? ' data-detail' : ''}${label ? ` aria-label="${esc(label)}"` : ''}${lang ? ` lang="${esc(lang)}"` : ''}${className ? ` class="${esc(className)}"` : ''}>${esc(text)}</a>`;
}
export const grid = (items, className = "") => `<ul class="grid ${className}">${items.map(i => `<li>${i}</li>`).join("")}</ul>`;
export const section = (title, body) => `<section><h2>${esc(title)}</h2>${body}</section>`;
export function chrome(route, model) {
  const { locale } = route, t = catalog[locale];
  const other = locale === "pl" ? "en" : "pl";
  const nav = ["catalog","fathers","dictionary","tags","search"];
  return `<div id="reader"><a class="skip" href="#main-content">${esc(t.skip)}</a><header><div class="top"><a class="brand" href="${pathFor({kind:"home",locale})}">Didaske</a><div class="tools"><a href="${pathFor({kind:"help",locale})}">${t.help}</a><a class="language" data-language href="${esc(localized(route,other))}" hreflang="${other}" lang="${other}" aria-label="${t.language} · ${other === "en" ? "English" : "Polski"}">${other === "en" ? "English" : "Polski"}</a></div></div><nav aria-label="${esc(t.navigation)}">${nav.map(kind => link({ kind,locale },t[kind], {className: model.group === kind ? "active" : ""})).join("")}</nav></header><main id="main-content" up-main tabindex="-1"><div class="page"><div class="crumbs">${(model.crumbs ?? []).join('<span aria-hidden="true">/</span>')}</div><h1>${esc(model.title)}</h1><div data-body>${model.body}</div></div></main><footer><span>Didaske</span><div>${["application","literature","help"].map(kind => link({kind,locale},t[kind])).join("")}</div></footer></div>`;
}
export function documentHtml(route, model, assets) {
  const canonical = new URL(pathFor(route),publicOrigin).href;
  return `<!doctype html><html lang="${route.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(model.title)} · Didaske</title><meta name="description" content="${esc(model.description ?? model.title)}"><link rel="canonical" href="${esc(canonical)}">${["pl","en","x-default"].map(tag => `<link rel="alternate" hreflang="${tag}" href="${esc(new URL(pathFor({...route,locale:tag === "x-default" ? "pl" : tag}),publicOrigin).href)}">`).join("")}${["search","literature"].includes(route.kind) ? '<meta name="robots" content="noindex,follow">' : ""}${assets.css.map(css => `<link rel="stylesheet" href="${esc(basePath+css)}">`).join("")}<script type="module" src="${esc(basePath+assets.file)}"></script></head><body><div id="app">${chrome(route,model)}</div></body></html>`;
}

// Dedicated public details share their content with the dialog. A compact document
// keeps the site small while its visible locale and library links also work offline.
export function standaloneHtml(route,model,assets) {
  const t=catalog[route.locale], other=route.locale==="en" ? "pl" : "en";
  const path=decodeURI(pathFor(route)), abs=new URL(pathFor(route),publicOrigin).origin+path;
  const title=esc(model.title);
  const html=`<!doctype html><html lang=${route.locale}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title} · Didaske</title><link rel=canonical href="${esc(abs)}"><link rel=stylesheet href="${basePath+assets.css[0]}"><script type=module src="${basePath+assets.file}"></script><div id=app><main class=page data-standalone><nav aria-label="${esc(t.navigation)}"><a href="${basePath+route.locale}/">Didaske</a><a data-language rel=alternate hreflang=${other} lang=${other} href="${esc(path.replace("/"+route.locale+"/","/"+other+"/"))}">${other==="pl" ? "Polski" : "English"}</a></nav><h1>${title}</h1><div data-body>${model.body}</div></main></div>`;
  // HTML permits unquoted attributes without whitespace or delimiters. Omit only
  // end tags with an unambiguous following element under the HTML parsing rules.
  return html.replace(/<[^>]+>/g,tag=>tag.replace(/ ([\w:-]+)="([^\s"'`=<>]+)"/g," $1=$2"))
    .replace(/<\/p>(?=<(?:p|dl|section|ul|ol|h[1-6])(?: |>|\/))/g,"");
}
