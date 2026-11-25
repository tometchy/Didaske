// Stratified preflight for the large route families. The release budget applies to the full artifact.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import queries from "../src/queries.json" with {type:"json"};
import { view } from "../src/views/reader.js";
import { standaloneHtml,documentHtml } from "../src/views/html.js";
const root=new URL("../../",import.meta.url);
const db=new DatabaseSync(fileURLToPath(new URL("build/content.sqlite3",root)),{readOnly:true});
const vite=JSON.parse(readFileSync(new URL("app/dist-preview/.vite/manifest.json",root)));
const assets=Object.values(vite).find(e=>e.src==="index.html"), prepared=new Map();
function read(name,params=[]) {
  if (!prepared.has(name)) prepared.set(name,db.prepare(queries[name]));
  return prepared.get(name).all(...params);
}
const queriesByKind={
  verse:"SELECT DISTINCT b.abbr book,v.chapter,v.verse FROM verses v JOIN books b USING(book_id)",
  note:"SELECT b.abbr book,n.chapter,n.verse,n.note_ordinal ordinal FROM verse_footnotes n JOIN books b USING(book_id)",
  word:"SELECT b.abbr book,w.chapter,w.verse,w.position ordinal FROM strong_tokens w JOIN books b USING(book_id)",
  entry:"SELECT DISTINCT form_key AS key FROM form_senses",
  chapter:"SELECT DISTINCT source_id source,b.abbr book,v.chapter FROM verses v JOIN books b USING(book_id)"
};
const result={};
for (const [kind,sql] of Object.entries(queriesByKind)) {
  const candidates=db.prepare(sql).all();
  const samples=Math.min(candidates.length,1000);
  let bytes=0;
  for (let i=0;i<samples;i++) {
    const data=candidates[Math.floor((i+0.5)*candidates.length/samples)];
    for(const locale of ["pl","en"]) {
      const route={...data,kind,locale}, model=await view(route,read);
      if (model.missing) throw new Error("Missing sampled "+kind);
      const render=kind==="chapter" ? documentHtml : standaloneHtml;
      bytes+=Buffer.byteLength(render(route,model,assets));
    }
  }
  result[kind]={references:candidates.length,sampledReferences:samples,sampleBilingualBytes:bytes,estimatedBytes:Math.round(bytes*candidates.length/samples)};
}
writeFileSync(new URL("build/route-sample-report.json",root),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
db.close();
