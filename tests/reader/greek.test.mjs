import assert from "node:assert/strict";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";
import queries from "../../app/src/queries.json" with {type:"json"};
import {align, describePassage, formKey, grammarDescription, greekChapter, morphology, words} from "../../app/src/greek.js";
import {catalog} from "../../app/src/i18n/index.js";

const db=new DatabaseSync(fileURLToPath(new URL("../../build/content.sqlite3",import.meta.url)),{readOnly:true});
const read=(name,args)=>db.prepare(queries[name]).all(...args);

test("lookup retains breathing, iota subscript and diaeresis while aligning repeated words in order",()=>{
  assert.equal(formKey("ΛΌΓΟΣ"),formKey("λὸγος".normalize("NFD")));
  assert.notEqual(formKey("ὡς"),formKey("ὠς"));
  assert.notEqual(formKey("ᾧ"),formKey("ὧ"));
  assert.notEqual(formKey("ϊ"),formKey("ι"));
  assert.deepEqual(words("καὶ, Βίβλος· λόγος!"),["καὶ","Βίβλος","λόγος"]);
  assert.deepEqual([...align(["ὁ","λόγος","ὁ"],["ὁ","δέ","λόγος","ὁ"])],[[0,0],[1,2],[2,3]]);
  assert.equal(align(["ὁ","λόγος","ἐν","σοφία"],["ὁ","λόγος"]).size,0);
  assert.deepEqual([...align(["καί"],["οὐ","καὶ"])],[[0,1]]);
});

test("passage glosses and exact pronunciation have independent evidence requirements",()=>{
  const key=formKey("ὡς");
  const forms=new Map([[key,[{english:"as",pronunciation:"hos"}]]]);
  const [w]=describePassage(["ὡς"],[{greek:"ὠς",polish:"jak",pronunciation:"os"}],
    [{greek:"ὠς",strong:5613,grammar:"ADV",form_key:formKey("ὠς")}],forms,new Map());
  assert.deepEqual(w.polish,["jak"]);
  assert.deepEqual(w.pronunciation,["hos"]);
  assert.equal(w.source,null);
  assert.equal(w.morphology.state,"unavailable");
  const [missing]=describePassage(["ὡς"],[{greek:"ὠς",polish:"jak",pronunciation:"os"}],[],new Map(),new Map());
  assert.deepEqual(missing.pronunciation,[]);
});

test("Strong lookup excludes wrong inflections, orders variants by frequency and bounds compatible forms",()=>{
  const token={form_key:"actual",strong:4536,grammar:"N-DSF"};
  const senses=new Map([["actual",[{polish:"trąbą",code:"N-DSF"},{polish:"trąbie",code:"N-DSF / N-DSM"},
    {polish:"trąby",code:"N-GSF"},{english:"a trumpet",polish:"-",code:"N-DSF"}]],
    ["also",[{polish:"TRĄBIE",code:"N-DSF"}]]]);
  assert.deepEqual(morphology(token,["also","actual"],senses),{state:"variants",values:["trąbie","trąbą"]});
  assert.deepEqual(morphology(token,[],senses),{state:"missing",values:[]});
  const keys=Array.from({length:40},(_,i)=>"a"+i.toString().padStart(2,"0"));
  assert.deepEqual(morphology(token,[...keys,"actual"],new Map([["a31",[{polish:"invalid",code:"N-DSF"}]]])),
    {state:"missing",values:[]});
});

test("real John passage uses the selected occurrence with its dictionary and grammar provenance",async()=>{
  const tokens=(await greekChapter(read,"John",1)).get(1);
  const first=tokens[4], last=tokens.at(-1);
  assert.equal(first.source.position,5);
  assert.equal(last.source.position,17);
  assert.equal(first.source.strong,3056);
  assert.equal(first.source.form_key,"λόγοσ");
  assert.deepEqual(tokens[1].polish,["początku"]);
  assert.ok(first.morphology.values.length);
  assert.equal(first.source.grammar,"N-NSM");
  for(const [lang,expected] of [["en","noun, nominative, singular, masculine"],["pl","rzeczownik, mianownik, liczba pojedyncza, rodzaj męski"]]) {
    assert.equal(grammarDescription(first.source.grammar,catalog[lang].greekGrammar),expected);
    assert.equal(grammarDescription("unknown",catalog[lang].greekGrammar),catalog[lang].greekGrammar.unknown);
  }
  const exceptions=read("greekHomographs",[]);
  assert.ok(exceptions.length>0);
  const {grammar,form_key:key}=exceptions[0];
  const ids=db.prepare("SELECT DISTINCT strong FROM strong_tokens WHERE grammar=? AND form_key=? AND strong>0").all(grammar,key);
  assert.ok(ids.length>1);
});

test("a misleading reference cannot lend Strong identity or an unattested dictionary gloss",()=>{
  const [row]=describePassage(["ἄλλος"],[],[{greek:"θεοῦ",form_key:formKey("θεοῦ"),strong:2316,grammar:"N-GSM"}],
    new Map([[formKey("ἄλλος"),[{english:"other",english_kind:"dictionary",lemma:"ἄλλος"}]]]),new Map());
  assert.equal(row.morphology.state,"unavailable");
  assert.equal(row.translationKind,"dictionary");
  assert.deepEqual(row.polish,[]);
});

test("comparisons and tagged excerpts link attested words, marked TNP notes and Fathers introductions", async()=>{
  const {parseRoute}=await import("../../app/src/routes.js");
  const {view}=await import("../../app/src/views/reader.js");
  // A temporary relation exercises the supported historical Fathers reference.
  // The shipped editorial tag currently contains two Bible ranges only.
  db.exec("CREATE TEMP TABLE tag_fathers AS SELECT * FROM main.tag_fathers");
  db.exec("INSERT INTO temp.tag_fathers VALUES ('narodzenie-jezusa','Ef',0,1)");
  try {
    for(const locale of ["en","pl"]) {
      const render=async path=>(await view(parseRoute("/"+locale+path),read)).body;
      const comparison=await render("/Biblia/Werset/J/1/1/");
      assert.match(comparison,/Study\/TR\/J\/1\/1\/words\/5\//);
      assert.match(comparison,/data-layer="morphology"/);
      const fathers=await render("/Ojcowie/Ignatius/Ef/0/");
      assert.match(fathers,/\/Dictionary\//);
      assert.match(fathers,/data-father/);
      const tag=await render("/Tag/narodzenie-jezusa/");
      for(const edition of ["TNP","UBG","KJV","TR"]) assert.ok(tag.includes("<summary>"+edition+"</summary>"));
      assert.match(tag,/TNP\/Mt\/1\/18\/notes\//);
      assert.match(tag,/TR\/Mt\/1\/18\/words\//);
      assert.match(tag,/Ojcowie\/Ignatius\/Ef\/0\/#v1/);
      assert.match(tag,/\/Dictionary\//);
    }
  } finally {
    db.exec("DROP TABLE temp.tag_fathers");
  }
});
