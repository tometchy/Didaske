import "unpoly/unpoly.es6.min.js";
import "./styles/reader.css";
import { isNative, readPublic as nativeRead } from "./tauri-db.js";
import { readPublic as webRead } from "./browser-db.js";
import { getPreference, setPreference } from "./outbox.js";
import { mountNotes } from "./notes-ui.js";
import { basePath, localized, parseRoute, pathFor, publicOrigin } from "./routes.js";
import { greekChapter, patristicReadings } from "./greek.js";
import { catalog } from "./i18n/index.js";
import { chrome, esc } from "./views/html.js";
import { view } from "./views/reader.js";

const app = document.getElementById("app");
const native = isNative();
const edges = ["left","right","top","bottom"];
let state = history.state?.didaske ?? { dock:null, modal:null, scroll:0 };
let page = null, generation = 0, panelGeneration = 0;
let trigger;
const cache = new Map();
const layers = {};

const read = native ? nativeRead : webRead;
function record(method="replaceState", url=location.href) {
  history[method]({ ...history.state, didaske:state },"",url);
}
function position() { return state.dock ? app.scrollTop : window.scrollY; }
function restore(y) { (state.dock ? app : window).scrollTo(0,y ?? 0); }
function readerViewport() {
  return state.dock ? app.getBoundingClientRect() : {top:0,bottom:innerHeight};
}
function rememberVerse() {
  const viewport=readerViewport();
  const visible=element=>element && element.getBoundingClientRect().bottom>viewport.top && element.getBoundingClientRect().top<viewport.bottom;
  let verse=trigger?.closest(".verse[id]");
  if (!visible(verse) || !app.contains(verse)) verse=Array.from(app.querySelectorAll(".verse[id]")).find(visible);
  if (!verse) return {pixels:position()};
  return {id:verse.id,offset:verse.getBoundingClientRect().top-viewport.top,pixels:position()};
}
function restoreVerse(anchor) {
  const verse=anchor.id && document.getElementById(anchor.id);
  if (!verse) { restore(anchor.pixels); return; }
  const viewport=readerViewport();
  const offset=Math.max(-verse.offsetHeight/2,Math.min(anchor.offset,viewport.bottom-viewport.top-40));
  restore(position()+verse.getBoundingClientRect().top-viewport.top-offset);
}
function focusPassage() {
  const anchor = trigger && document.contains(trigger) ? trigger : document.querySelector("main");
  anchor?.focus({preventScroll:true});
}
function errorBox(error) {
  const t = catalog[page?.locale ?? "pl"];
  document.querySelector("#reading-error")?.remove();
  const node = document.createElement("div");
  node.id="reading-error"; node.setAttribute("role","alert");
  node.innerHTML = `${esc(t.dataError)} <button type="button" data-retry>${esc(t.retry)}</button>`;
  app.prepend(node);
  console.error("Didaske reader",error?.message);
}
function saveScroll() {
  if (!page || state.modal) return;
  state = {...state,scroll:position()}; record();
}
function staticModel(doc,route) {
  const reader=doc.querySelector("#reader"), main=reader?.querySelector("main") ?? doc.querySelector("[data-standalone]");
  if (!main) return null;
  const model={title:main.querySelector("h1").textContent, body:main.querySelector("[data-body]").innerHTML,description:doc.querySelector('meta[name="description"]')?.content,group:route.kind==="entry" ? "dictionary" : "catalog"};
  return {...model,html:reader?.outerHTML ?? chrome(route,model)};
}
async function load(route) {
  const url = localized(route,route.locale);
  if (cache.has(url) && route.kind!=="search" && !(route.kind==="chapter" && route.source==="TR")) return cache.get(url);
  let data;
  if (!native && !route.q) {
    try {
      const response = await fetch(url);
      if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
        const doc = new DOMParser().parseFromString(await response.text(),"text/html");
        if (doc.querySelector('link[rel="canonical"]')?.href===new URL(pathFor(route),publicOrigin).href) data=staticModel(doc,route);
      }
    } catch { /* Use the local SQLite snapshot when a page cannot be fetched. */ }
  }
  if (!data) {
    const vm = await view(route,read,layers);
    data = {html:chrome(route,vm),...vm};
  }
  if (cache.size >= 18) cache.delete(cache.keys().next().value);
  cache.set(url,data);
  return data;
}
let layerVersion=0;
const layerData=new WeakMap();
async function applyLayers() {
  const version=++layerVersion;
  for (const input of document.querySelectorAll("[data-layer]")) input.checked=Boolean(layers[input.dataset.layer]);
  const rows=[...document.querySelectorAll(".aligned")];
  const enabled=Object.values(layers).some(Boolean), t=catalog[page?.locale ?? "pl"];
  for (const row of rows) row.hidden=!enabled;
  if (!enabled || !rows.length) return;
  try {
    const columns=[["polish","glossPl","pl"],["morphology","greekStrongGloss","pl"],["english","glossEn","en"],
      ["code","grammar","und"],["pronunciation","pronunciation","und"]];
    for (const row of rows) {
      if (version!==layerVersion || !row.isConnected) return;
      if (!layerData.has(row)) {
        const {book,chapter,verse}=row.dataset;
        const pending=row.hasAttribute("data-father") ? patristicReadings(read,row.previousElementSibling.textContent)
          : greekChapter(read,book,Number(chapter)).then(data=>data.get(Number(verse)) ?? []);
        layerData.set(row,pending.catch(error=>{layerData.delete(row);throw error;}));
      }
      const readings=await layerData.get(row);
      if (version!==layerVersion || !row.isConnected) return;
      row.innerHTML=`<span class="aligned-source">${esc(t.alignedTitle)}</span>`+
        readings.map(word=>{
          const annotations=columns.filter(([key])=>layers[key]).map(([key,label,lang])=>{
            const values=key==="morphology" ? word.morphology.values : word[key];
            const caption=key==="english" && word.translationKind==="dictionary" ? t.greekDictionaryMeaning : t[label];
            return `<span title="${esc(caption)}" lang="${lang}">${esc(values.join(" / ") || "—")}</span>`;
          }).join("");
          return `<span class="unit"><b lang="grc">${esc(word.greek)}</b>${annotations}</span>`;
        }).join(" ");
    }
  } catch(error) { if (version===layerVersion) errorBox(error); }
}
document.addEventListener("change",event=>{
  const input=event.target.closest("[data-layer]");
  if (!input) return;
  layers[input.dataset.layer]=input.checked;
  setPreference("reader","layers",{...layers}).catch(()=>{});
  applyLayers();
});
function metadata(route, data) {
  if (route.kind==="literature") {
    const root=app.querySelector("[data-pdf]");
    void import("./pdf-reader.js").then(module=>module.mountPdf(root,route.locale)).catch(errorBox);
  }
  if (native && route.kind==="application") mountNotes(app.querySelector("#main-content"),route.locale);
  document.documentElement.lang = route.locale;
  document.title = data.title + " · Didaske";
  function set(selector, tag, attrs) {
    const el=document.head.querySelector(selector) ?? document.createElement(tag);
    for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
    if (!el.parentNode) document.head.append(el);
  }
  set('link[rel="canonical"]',"link",{rel:"canonical",href:new URL(pathFor(route),publicOrigin).href});
  for (const locale of ["pl","en","x-default"]) set(`link[hreflang="${locale}"]`,"link",{rel:"alternate",hreflang:locale,href:new URL(pathFor({...route,locale:locale==="x-default" ? "pl" : locale}),publicOrigin).href});
  set('meta[name="description"]',"meta",{name:"description",content:data.description ?? data.title});
  set('meta[name="robots"]',"meta",{name:"robots",content:["search","literature"].includes(route.kind) ? "noindex,follow" : "index,follow"});
}
async function navigate(url, mode="push", options={}) {
  const target=parseRoute(url); if (!target) return;
  const version=++generation;
  const next = await load(target);
  if (generation!==version) return;
  if (mode==="push") saveScroll();
  const oldScroll=state.scroll;
  if (mode!=="restore") {
    state={...state,modal:null,scroll:options.keepScroll ? oldScroll : 0};
    if (state.dock && page?.locale!==target.locale) state.dock={...state.dock,route:{...state.dock.route,locale:target.locale}};
    record(mode==="push" ? "pushState" : "replaceState",url);
  }
  page=target;
  if (document.querySelector("#reader") && window.up) {
    await window.up.render("#reader",{fragment:next.html,history:false,focus:false,scroll:false,animation:false});
  } else app.innerHTML=next.html;
  if (version!==generation) return;
  metadata(target,next);
  await panels();
  if (version!==generation) return;
  const hash=new URL(url,location.href).hash;
  if (hash && mode!=="restore" && !options.keepScroll) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  else restore(state.scroll);
  if (!options.keepScroll && !state.modal) app.querySelector("main")?.focus({preventScroll:true});
}
function panelHtml(route, data, dock) {
  const t=catalog[route.locale],edge=state.dock?.edge ?? "right";
  return `<h2 id="${dock ? "dock" : "modal"}-title">${esc(data.title)}</h2><a class="full" data-full href="${esc(pathFor(route))}">${t.open}</a>
    <div class="actions"><label>${t.dock}<select data-edge-select>${edges.map(e=>`<option value="${e}"${e===edge ? " selected" : ""}>${t[e]}</option>`).join("")}</select></label><button type="button" data-place>${t.dock}</button>${dock ? `<button data-undock>${t.undock}</button>` : ""}<button type="button" data-close>${t.close}</button></div><div class="panel-content">${data.body}</div>`;
}
async function panels() {
  const version=++panelGeneration;
  const [dockData,modalData]=await Promise.all([state.dock ? load(state.dock.route) : null,state.modal ? load(state.modal) : null]);
  if (version!==panelGeneration) return;
  let dock=document.querySelector("#dock");
  if (dockData) {
    if (!dock) { dock=document.createElement("aside"); dock.id="dock"; dock.className="detail-panel"; dock.setAttribute("aria-labelledby","dock-title"); document.body.append(dock); }
    const previousOffset=dock.dataset.route===pathFor(state.dock.route) ? dock.scrollTop : 0;
    dock.dataset.route=pathFor(state.dock.route);
    dock.innerHTML=panelHtml(state.dock.route,dockData,true);
    dock.scrollTop=previousOffset;
    document.body.dataset.edge=state.dock.edge;
  } else { dock?.remove(); delete document.body.dataset.edge; }
  let dlg=document.querySelector("#detail-modal");
  if (modalData) {
    if (!dlg) {
      dlg=document.createElement("dialog"); dlg.className="detail-panel"; dlg.id="detail-modal";
      dlg.setAttribute("aria-labelledby","modal-title"); dlg.addEventListener("cancel",e=>{e.preventDefault();closeModal();}); document.body.append(dlg);
    }
    dlg.innerHTML=panelHtml(state.modal,modalData,false);
    if (!dlg.open) dlg.showModal();
    dlg.querySelector("[data-full]").focus();
  } else if (dlg) { dlg.close();dlg.remove(); }
  applyLayers();
}
async function openDetail(route,anchor) {
  saveScroll(); trigger=anchor; state={...state,modal:route,fromDock:false};
  record("pushState"); await panels();
}
function closeModal() {
  if (!state.modal) return;
  if (!state.fromDock) { history.back(); return; }
  state={...state,modal:null,fromDock:false};record();
  panels().then(focusPassage).catch(errorBox);
}
async function movePanel(action,node) {
  const dock=node.closest("#dock"), route=dock ? state.dock.route : state.modal;
  const place=rememberVerse();
  if (action==="close" && !dock) { closeModal();return; }
  if (action==="close") state={...state,dock:null};
  if (action==="undock") state={...state,modal:route,dock:null,fromDock:true};
  if (action==="place") {
    if (state.dock && !dock && !window.confirm(catalog[route.locale].replace)) return;
    const edge=node.closest(".detail-panel").querySelector("[data-edge-select]").value;
    state={...state,dock:{edge,route},modal:null};
  }
  record();
  await panels(); restoreVerse(place);
  state={...state,scroll:position()};record();
  if (!state.modal) focusPassage();
}
document.addEventListener("click",event=>{
  if (event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const button=event.target.closest("button");
  if (button?.hasAttribute("data-retry")) { location.reload();return; }
  if (button?.closest(".detail-panel")) {
    for (const action of ["close","undock","place"]) if (button.hasAttribute("data-"+action)) {
      event.preventDefault();movePanel(action,button).catch(errorBox);return;
    }
  }
  const anchor=event.target.closest("a[href]");
  if (!anchor || anchor.target || anchor.origin!==location.origin || anchor.hasAttribute("download") || anchor.getAttribute("href").startsWith("#")) return;
  const route=parseRoute(anchor.href); if (!route) return;
  event.preventDefault();
  if (anchor.hasAttribute("data-detail")) { openDetail(route,anchor).catch(errorBox); return; }
  const lang=anchor.hasAttribute("data-language");
  if (lang) setPreference("reader","locale",route.locale).catch(()=>{});
  navigate(anchor.href+(lang ? location.hash : ""), "push",{keepScroll:lang}).catch(errorBox);
});
document.addEventListener("submit",event=>{
  if (!event.target.matches("form.search")) return;
  event.preventDefault();
  const url=new URL(event.target.action);
  url.search=new URLSearchParams(new FormData(event.target));
  navigate(url).catch(errorBox);
});
// The reader restores its own snapshot-backed history, including while offline.
document.addEventListener("up:location:restore",event=>event.preventDefault());
window.addEventListener("popstate",event=>{
  const previous=state;
  state=event.state?.didaske ?? {modal:null,dock:null,scroll:0};
  const next=parseRoute(location.href);
  if (page && next && localized(page,page.locale)===localized(next,next.locale)) {
    panels().then(()=>{restore(state.scroll); if (previous.modal&&!state.modal) focusPassage();}).catch(errorBox);
  } else navigate(location.href,"restore").catch(errorBox);
});
window.addEventListener("pagehide",saveScroll);
async function start() {
  const savedLayers=await getPreference("reader","layers").catch(()=>null);
  if (savedLayers && typeof savedLayers === "object") Object.assign(layers,savedLayers);
  let route=parseRoute(location.href);
  if (!route) {
    const saved=await getPreference("reader","locale").catch(()=>null),system=navigator.language?.split("-")[0];
    const locale=["pl","en"].includes(saved) ? saved : ["pl","en"].includes(system) ? system : "pl";
    route={kind:"home",locale}; record("replaceState",pathFor(route));
  }
  const initial=staticModel(document,route);
  if (initial && app.querySelector("[data-standalone]")) app.innerHTML=initial.html;
  if (initial) { page=route;cache.set(localized(route,route.locale),initial); metadata(route,initial);record();await panels(); }
  else await navigate(location.href,"restore");
}
start().catch(errorBox);
