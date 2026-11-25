import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import queries from "../../app/src/queries.json" with {type:"json"};
import { parseRoute, pathFor, localized } from "../../app/src/routes.js";
import { view } from "../../app/src/views/reader.js";
import { catalog, pendingCount } from "../../app/src/i18n/index.js";
import { documentHtml } from "../../app/src/views/html.js";

const db=new DatabaseSync(fileURLToPath(new URL("../../build/content.sqlite3",import.meta.url)),{readOnly:true});
function read(name,params=[]) { return db.prepare(queries[name]).all(...params); }
function render(path) { return view(parseRoute(path),read); }
test("Public detail routes round trip across interface languages",()=>{
  for (const path of ["/pl/Study/TNP/Łk/3/16/notes/2/","/en/Biblia/Werset/J/3/16/","/pl/Ojcowie/Ignatius/Ef/0/","/en/Dictionary/ἐν/","/pl/Study/TR/J/1/1/words/4/"]) {
    const route=parseRoute(path);
    assert.equal(decodeURIComponent(pathFor(route)),path);
    assert.equal(parseRoute(localized(route,"en")).locale,"en");
  }
  for (const path of ["/pl/Biblia/TNP/J/-1/","/en/Study/TNP/J/0/16/notes/1/","/pl/Dictionary/a%2Fb/","/pl/%GG/"]) assert.equal(parseRoute(path),null);
});
test("Catalog parity and Polish plural categories",()=>{
  assert.deepEqual(Object.keys(catalog.pl).sort(),Object.keys(catalog.en).sort());
  assert.deepEqual([1,2,5,12,22].map(n=>pendingCount("pl",n)),["1 oczekująca zmiana","2 oczekujące zmiany","5 oczekujących zmian","12 oczekujących zmian","22 oczekujące zmiany"]);
  assert.equal(pendingCount("en",1),"1 pending change");
});
for (const locale of ["pl","en"]) {
  test(`TNP direct, repeated and independently addressed source annotations in ${locale}`,async()=>{
    const renderAt=p=>render("/"+locale+p);
    const chapter=await renderAt("/Biblia/TNP/J/1/");
    const verse=chapter.body.split('id="v38"')[1].split("</p>")[0];
    assert.deepEqual([...verse.matchAll(/<strong>(.*?)<\/strong>/g)].map(m=>m[1]),["Czego szukacie?"]);
    const cmp=await renderAt("/Biblia/Werset/J/3/16/");
    assert.match(cmp.body,/notes\/1\//);assert.match(cmp.body,/notes\/2\//);
    const notes=await Promise.all([1,2].map(n=>renderAt("/Study/TNP/J/3/16/notes/"+n+"/")));
    assert.notEqual(notes[0].body,notes[1].body);assert.match(notes[0].body,/houto/);
    const repeated=await renderAt("/Biblia/TNP/1Kor/2/");
    const p=repeated.body.split('id="v15"')[1].split("</p>")[0];
    assert.equal((p.match(/notes\/1\//g)??[]).length,2);
    const html=documentHtml(parseRoute("/"+locale+"/Biblia/TNP/J/1/"),chapter,{file:"assets/main.js",css:[]});
    assert.match(html,new RegExp('<html lang="'+locale+'"'));
    assert.match(html,/hreflang="x-default"/);
  });
}
test("Greek words, source annotations and introductions are real linked content",async()=>{
  const chapter=await render("/en/Biblia/TR/J/1/");
  assert.match(chapter.body,/\/en\/Study\/TR\/J\/1\/1\/words\/2\//);
  assert.match(chapter.body,/data-book="John" data-chapter="1" data-verse="1"/);
  const word=await render("/pl/Study/TR/J/1/1/words/2/");
  assert.match(word.body,/początku/);assert.match(word.body,/ἀρχή/);assert.match(word.body,/N-DSF/);
  const fathers=await render("/en/Ojcowie/Ignatius/Ef/0/");
  assert.equal(fathers.missing,undefined);assert.match(fathers.body,/lang="grc"/);
  assert.equal((await render("/en/Biblia/TNP/Rdz/1/")).missing,true);
});
test("Search preserves ranked public destinations across language and Greek accents",async()=>{
  const hits=(html)=>Array.from(html.matchAll(/<li><a href="([^"]+)"/g),m=>m[1].replace(/^\/(pl|en)\//,"/"));
  const en=await render("/en/Search/?q="+encodeURIComponent("λόγος"));
  const pl=await render("/pl/Search/?q="+encodeURIComponent("λογος"));
  assert.deepEqual(hits(en.body),hits(pl.body));
  assert.ok(hits(en.body).length);
  const english=await render("/en/Search/?q=grace");
  assert.match(english.body,/class="hits"/);
  for(const route of hits(english.body)) assert.ok(parseRoute("/en"+route));
});
