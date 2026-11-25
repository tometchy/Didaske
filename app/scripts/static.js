import { createHash } from "node:crypto";
import { createReadStream,createWriteStream } from "node:fs";
import { createGzip,gzipSync } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { SiteTar } from "./tar.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import queries from "../src/queries.json" with {type:"json"};
import { view } from "../src/views/reader.js";
import { documentHtml, standaloneHtml, esc } from "../src/views/html.js";
import { basePath, pathFor, publicOrigin } from "../src/routes.js";

const started=Date.now();
const sample=process.argv.includes("--sample");
const archive=process.argv.includes("--tar");
const appRoot=fileURLToPath(new URL("..",import.meta.url)), dir=join(appRoot,archive ? "dist-tar-assets" : sample ? "dist" : "dist-preview"), build=join(appRoot,"../build");
if (!sample && !archive && !process.argv.includes("--full-local-preview")) throw new Error("Select --sample or --full-local-preview. Source redistribution and device releases require review.");
const dataDir=join(dir,"data");
mkdirSync(dataDir,{recursive:true});
const snapshot=join(build,"content.sqlite3"), sourceManifest=readFileSync(join(build,"manifest.json"));
const expected=JSON.parse(sourceManifest), digest=createHash("sha256"), stream=createReadStream(snapshot);
stream.on("data",chunk=>digest.update(chunk));
await pipeline(stream,createGzip({level:9}),createWriteStream(join(dataDir,"content.sqlite3.gz")));
if(digest.digest("hex")!==expected.sha256) throw new Error("Snapshot changed during static build; rerun with a stable snapshot");
writeFileSync(join(dataDir,"manifest.json"),sourceManifest);
const db=new DatabaseSync(snapshot,{readOnly:true});
if (!sourceManifest.equals(readFileSync(join(build,"manifest.json")))) throw new Error("Snapshot changed before rendering");

const manifest=JSON.parse(readFileSync(join(dir,".vite/manifest.json"),"utf8"));
const assets=Object.values(manifest).find(e=>e.isEntry && e.src==="index.html");
const prepared=Object.fromEntries(Object.entries(queries).map(([name,sql])=>[name,db.prepare(sql)]));
const lookups=new Map(), perRoute=new Map();
function read(name,params=[]) {
  const cached=["lookupBook","chapters","works","workChapters"].includes(name);
  const key=JSON.stringify([name,...params]);
  if (cached && lookups.has(key)) return lookups.get(key);
  if (perRoute.has(key)) return perRoute.get(key);
  const rows=prepared[name].all(...params);
  if (cached) lookups.set(key,rows);
  else perRoute.set(key,rows);
  return rows;
}
function* inventory() {
  for (const kind of ["home","catalog","help","application","literature","fathers","author","tags","dictionary","search"]) yield {kind};
  for (const {slug} of read("tags")) yield {kind:"tag",slug};
  for (const {work_id:work} of read("works")) {
    yield {kind:"work",work};
    for (const {chapter} of read("workChapters",[work])) yield {kind:"passage",work,chapter};
  }
  for (const {source_id:source} of read("translations")) {
    yield {kind:"translation",source};
    for (const {book_id:id,abbr:book} of read("books",[source])) {
      yield {kind:"book",source,book};
      const chapters=read("chapters",[source,id]);
      for (const {chapter} of chapters) if (!sample || (book==="J" && [1,2,3,4].includes(chapter))) yield {kind:"chapter",source,book,chapter};
    }
  }
  const where=sample ? "WHERE b.abbr='J' AND v.chapter IN (1,2,3,4)" : "";
  for (const row of db.prepare(`SELECT DISTINCT b.abbr AS book,v.chapter,v.verse FROM verses v JOIN books b USING(book_id) ${where} ORDER BY book,chapter,verse`).iterate()) yield {kind:"verse",...row};
  for (const row of db.prepare(`SELECT b.abbr AS book,v.chapter,v.verse,v.note_ordinal AS ordinal FROM verse_footnotes v JOIN books b USING(book_id) ${where}`).iterate()) yield {kind:"note",...row};
  const words=sample ? "WHERE b.abbr='J' AND v.chapter=1 AND v.verse=1" : "";
  // Keep contextual analyses contiguous so the shared reader resolves each chapter once.
  for (const row of db.prepare(`SELECT b.abbr AS book,v.chapter,v.verse,v.position AS ordinal FROM strong_tokens v JOIN books b USING(book_id) ${words} ORDER BY v.book_id,v.chapter,v.verse,v.position`).iterate()) yield {kind:"word",...row};
  if (sample) {
    const rows=db.prepare("SELECT DISTINCT form_key AS key FROM form_senses WHERE form_key IN (SELECT form_key FROM strong_tokens WHERE book_id='John' AND chapter=1 AND verse=1)").all();
    for (const {key} of rows) yield {kind:"entry",key};
  } else {
    for (const {initial} of read("dictionaryInitials")) yield {kind:"dictionaryLetter",initial};
    for (const {key} of db.prepare("SELECT DISTINCT form_key AS key FROM form_senses").iterate()) yield {kind:"entry",key};
  }
}
const archivePath=join(build,"pages.tar");
const tar=archive ? new SiteTar(archivePath+".partial") : null;
const archiveDigest=createHash("sha256");
function addMember(path,content) {
  const data=Buffer.isBuffer(content) ? content : Buffer.from(content);
  // Both writers receive the same render output. The independent verifier
  // recomputes this unambiguous framed digest using the archived bytes.
  archiveDigest.update(path+"\0"+data.length+"\0").update(data);
  tar.add(path,data);
}
let files=0,bytes=0,mapFiles=0;
let urls=[];
function write(rel,content) {
  if (tar) addMember(rel,content);
  else {
    const dest=join(dir,rel);
    mkdirSync(dirname(dest),{recursive:true});
    writeFileSync(dest,content);
  }
  bytes+=Buffer.byteLength(content);files++;
}
function flushMap() {
  if (!urls.length) return;
  write("sitemap-"+(++mapFiles)+".xml.gz",gzipSync(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join("")}</urlset>`));
  urls=[];
}
const groups={};
for (const row of inventory()) {
  perRoute.clear();
  for (const locale of ["pl","en"]) {
    const route={...row,locale}, url=pathFor(route), rel=decodeURIComponent(url.slice(basePath.length));
    const model=await view(route,read);
    if (model.missing) throw new Error("Inventory references absent content: "+url);
    const html=["word","note","entry","verse"].includes(route.kind) ? standaloneHtml(route,model,assets) : documentHtml(route,model,assets);
    write(join(rel,"index.html"),html);
    groups[row.kind]=(groups[row.kind] ?? 0)+Buffer.byteLength(html);
    if (!["literature","search"].includes(route.kind)) {
      const alternate=lang=>new URL(pathFor({...route,locale:lang==="x-default" ? "pl" : lang}),publicOrigin).href;
      const links=["pl","en","x-default"].map(lang=>`<xhtml:link rel="alternate" hreflang="${lang}" href="${esc(alternate(lang))}"/>`).join("");
      urls.push(`<url><loc>${esc(new URL(url,publicOrigin).href)}</loc>${links}</url>`);
    }
    if (urls.length===10000) flushMap();
    if (locale==="pl" && ["catalog","translation","book","chapter","verse","fathers","author","work","passage","tags","tag","literature"].includes(route.kind)) {
      const alias=rel.slice(3);
      write(join(alias,"index.html"),`<!doctype html><html lang="pl"><meta charset="utf-8"><title>${esc(model.title)} · Didaske</title><meta name="robots" content="noindex,follow"><link rel="canonical" href="${esc(new URL(url,publicOrigin).href)}"><meta http-equiv="refresh" content="0;url=${esc(url)}"><a href="${esc(url)}">${esc(model.title)}</a></html>`);
    }
  }
}
flushMap();
write("sitemap.xml",`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({length:mapFiles},(_,i)=>"<sitemap><loc>"+esc(new URL(basePath+"sitemap-"+(i+1)+".xml.gz",publicOrigin).href)+"</loc></sitemap>").join("")}</sitemapindex>`);
const home=pathFor({kind:"home",locale:"pl"});
write("index.html",`<!doctype html><html lang="pl"><meta charset="utf-8"><title>Didaske</title><meta http-equiv="refresh" content="0;url=${home}"><a href="${home}">Polski</a> · <a href="${basePath}en/" lang="en">English</a></html>`);
write("404.html",`<!doctype html><html lang="pl"><meta charset="utf-8"><title>404 · Didaske</title><h1>404</h1><a href="${home}">Wróć do biblioteki</a> · <a href="${basePath}en/" lang="en">Return to the library</a></html>`);
if (!sourceManifest.equals(readFileSync(join(build,"manifest.json")))) throw new Error("Snapshot changed during rendering; rerun the build");
const report={mode:archive ? "full-tar" : sample ? "sample" : "full-local-preview",documents:files,documentBytes:bytes,snapshotBytes:expected.bytes,snapshotGzipBytes:statSync(join(dataDir,"content.sqlite3.gz")).size,snapshotSha256:expected.sha256,elapsedSeconds:(Date.now()-started)/1000};
const assetDir=join(dir,"assets");
const builtAssets=readdirSync(assetDir,{recursive:true,withFileTypes:true}).filter(e=>e.isFile());
const assetBytes=builtAssets.reduce((sum,file)=>sum+statSync(join(file.parentPath,file.name)).size,0);
const publicFiles=readdirSync(join(appRoot,"public"),{recursive:true,withFileTypes:true}).filter(e=>e.isFile());
const publicBytes=publicFiles.reduce((sum,file)=>sum+statSync(join(file.parentPath,file.name)).size,0);
report.siteFiles=files+builtAssets.length+publicFiles.length+3;
report.siteBytes=bytes+report.snapshotGzipBytes+sourceManifest.length+assetBytes+publicBytes+statSync(join(dir,".vite/manifest.json")).size;
report.sizeBudgetBytes=800_000_000;
report.withinSizeBudget=report.siteBytes<=report.sizeBudgetBytes;
report.documentBytesByKind=groups;
if (tar) {
  for (const file of readdirSync(dir,{recursive:true,withFileTypes:true})) {
    if (!file.isFile()) continue;
    const absolute=join(file.parentPath,file.name), path=absolute.slice(dir.length+1);
    // The canonical root page was already rendered above.
    if (path!=="index.html") addMember(path,readFileSync(absolute));
  }
  tar.finish();
  renameSync(archivePath+".partial",archivePath);
  report.memberSha256=archiveDigest.digest("hex");
  report.tarBytes=statSync(archivePath).size;
}
report.elapsedSeconds=(Date.now()-started)/1000;
writeFileSync(join(build,sample ? "sample-site-report.json" : "full-site-report.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report));
db.close();
