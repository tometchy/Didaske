import { pdfView } from "./pdf.js";
import { greekChapter, grammarDescription, knownForms, formKey, words } from "../greek.js";
import { catalog, bookName } from "../i18n/index.js";
import { basePath, pathFor } from "../routes.js";
import { esc, grid, link, section } from "./html.js";

const sourceLang = { TNP:"pl", UBG:"pl", KJV:"en", TR:"grc" };
function groupByVerse(rows) {
  const verses=new Map();
  for (const row of rows) {
    if (!verses.has(row.verse)) verses.set(row.verse,[]);
    verses.get(row.verse).push(row);
  }
  return verses;
}
function sourceCredit(source, t) {
  const credit = {TNP:t.tnpCredit, UBG:t.ubgCredit}[source];
  return credit ? `<aside class="credit">${esc(credit)}</aside>` : "";
}
function verseText(text, runs, route, t) {
  if (!runs?.length) return esc(text);
  return runs.map(run => {
    if (run.kind === "footnoteRef") {
      const ordinal = run.note_ordinal;
      return ordinal ? `<sup>${link({...route, kind:"note", ordinal},run.text,{detail:true,label:`${t.note} ${ordinal} · ${route.book} ${route.chapter},${route.verse}`})}</sup>` : `<sup>${esc(run.text)}</sup>`;
    }
    if (run.kind !== "text") return "";
    const styles = JSON.parse(run.styles);
    let value = esc(run.text);
    if (styles.includes("added_text")) value = `<i>${value}</i>`;
    if (styles.includes("jesus_quote")) value = `<strong>${value}</strong>`;
    return value;
  }).join("");
}
function trText(text, words, route) {
  if (!words?.length) return esc(text);
  let pos = 0;
  const fragments = [];
  for (const word of words) {
    const start = text.indexOf(word.greek,pos);
    if (start < pos) continue;
    fragments.push(esc(text.slice(pos,start)),link({...route,kind:"word",ordinal:word.position},word.greek,{detail:true,className:"token"}));
    pos = start + word.greek.length;
  }
  return fragments.join("") + esc(text.slice(pos));
}
function fatherText(text,known,route) {
  let end=0;
  const parts=[];
  for(const word of words(text)) {
    const i=text.indexOf(word,end), key=formKey(word);
    parts.push(esc(text.slice(end,i)),known.has(key) ? link({...route,kind:"entry",key},word,{detail:true}) : esc(word));
    end=i+word.length;
  }
  return parts.join("")+esc(text.slice(end));
}
function fatherPassage(row,route,known) {
  return `<span class="father-text" lang="grc">${fatherText(row.text,known,route)}</span><small class="aligned" data-father hidden></small>`;
}
function byReference(rows) {
  const index=new Map();
  for (const row of rows) {
    const ref=[row.book_id,row.chapter,row.verse].join("/");
    if (!index.has(ref)) index.set(ref,[]);
    index.get(ref).push(row);
  }
  return index;
}
const annotationKeys = {polish:"glossPl",morphology:"greekStrongGloss",english:"glossEn",code:"grammar",pronunciation:"pronunciation"};
function layerSelector(t,layers) {
  return `<details class="layer-selector"><summary>${t.layers}</summary><fieldset><legend>${t.alignedTitle}</legend>${Object.entries(annotationKeys).map(([key,label])=>`<label><input type="checkbox" data-layer="${key}" ${layers[key] ? "checked" : ""}> ${t[label]}</label>`).join("")}</fieldset></details>`;
}
function alignedText(book,chapter,verse) {
  return `<small class="aligned" data-book="${esc(book)}" data-chapter="${chapter}" data-verse="${verse}" hidden></small>`;
}
function definitionList(items) {
  return '<dl>' + items.filter(([,v]) => v != null && v !== "").map(([label,value,lang]) => `<div><dt>${esc(label)}</dt><dd${lang ? ` lang="${lang}"` : ""}>${esc(value)}</dd></div>`).join("") + '</dl>';
}
function senses(rows,t) {
  return rows.map(row => `<article class="sense">${definitionList([[t.form,row.form,"grc"],[t.glossPl,row.polish,"pl"],[row.english_kind==="dictionary" ? t.greekDictionaryMeaning : t.glossEn,row.english,"en"],[t.grammar,row.code ?? row.grammar],[t.pronunciation,row.pronunciation],[t.source,row.attribution || row.source]])}</article>`).join("");
}
function pager(ids,current,anchor,t) {
  const index = ids.indexOf(current);
  return '<div class="pager">' + (index > 0 ? anchor(ids[index-1], "← "+t.previous) : "") + (index >= 0 && index+1 < ids.length ? anchor(ids[index+1], t.next+" →") : "") + '</div>';
}
export async function view(route, read, layers = {}) {
  const {locale,kind,source,chapter,verse} = route, t = catalog[locale];
  const to = (kind,params={}) => ({...route,...params,kind});
  const a = (kind,title,params={},opts={}) => link(to(kind,params),title,opts);
  const group = ({home:"catalog",translation:"catalog",book:"catalog",chapter:"catalog",verse:"catalog",note:"catalog",word:"catalog",entry:"dictionary",dictionaryLetter:"dictionary",author:"fathers",work:"fathers",passage:"fathers",tag:"tags"})[kind] ?? kind;
  const crumbs = kind !== "home" ? [a("home","Didaske")] : [];
  if (group!==kind && kind !== "home") crumbs.push(a(group,t[group]));
  const model = (title,body,description) => ({title,body,group,crumbs,description});
  const missing = () => ({...model(t.unavailable,a("catalog",t.catalog)),missing:true});
  if (kind === "home" || kind === "catalog") {
    const sources = await read("translations");
    const cards = grid(sources.map(s => `<a class="edition" href="${pathFor(to("translation",{source:s.source_id}))}"><b>${esc(s.source_id)}</b><span>${esc(s.name)}</span><i aria-hidden="true">↗</i></a>`),"editions");
    return model(kind==="home" ? t.homeTitle : t.catalog,(kind === "home" ? a("chapter",t.startReading,{source:"TNP",book:"J",chapter:1},{className:"read-link"}) : "") + section(t.translations,cards)+section(t.library,grid(["fathers","dictionary","tags","literature"].map(k=>a(k,t[k])))));
  }
  if (kind === "translation") {
    const books = await read("books",[source]);
    return books.length ? model(source,section(t.books,grid(books.map(b=>a("book",bookName(locale,b),{book:b.abbr})), "books")) + sourceCredit(source,t)) : missing();
  }
  if (route.book) {
    const [b] = await read("lookupBook",[route.book]);
    if (!b) return missing();
    const id = b.book_id, name = bookName(locale,b);
    const ref = `${name} ${chapter}${verse ? "," + verse : ""}`;
    const back = (s="TNP") => a("chapter", "← "+t.back,{source:s},{fragment:"v"+verse});
    if (source) crumbs.push(a("translation",source));
    if (kind === "book" || kind === "chapter") {
      const chapters = (await read("chapters",[source,id])).map(x=>x.chapter);
      if (!chapters.length) return missing();
      if (kind === "book") return model(name,section(t.chapters,grid(chapters.map(ch=>a("chapter",ch,{chapter:ch})),"numbers"))+sourceCredit(source,t));
      if (!chapters.includes(chapter)) return missing();
      crumbs.push(a("book",name));
      const [rows,runs,words] = await Promise.all([read("chapter",[source,id,chapter]),source==="TNP" ? read("chapterRuns",[source,id,chapter]) : [],source==="TR" ? read("words",[id,chapter]) : []]);
      const grouped = groupByVerse(runs), tokens = groupByVerse(words);
      const body = rows.map(v=>{
        const r = {...route,verse:v.verse};
        const text = source==="TR" ? trText(v.text,tokens.get(v.verse),r) : verseText(v.text,grouped.get(v.verse),r,t);
        return `<p class="verse" id="v${v.verse}">${link({...r,kind:"verse"},v.verse,{detail:true,label:`${t.compare} · ${route.book} ${chapter},${v.verse}`,className:"verse-number"})}<span lang="${sourceLang[source]}">${text}${source==="TR" ? alignedText(id,chapter,v.verse) : ""}</span></p>`;
      }).join("");
      return model(ref,`<div class="edition-line">${esc(source)} <span>·</span> ${t.chapter} ${chapter}</div>${source==="TR" ? layerSelector(t,layers) : ""}<div class="passage">${body}</div>`+pager(chapters,chapter,(ch,s)=>a("chapter",s,{chapter:ch}),t)+sourceCredit(source,t), rows[0]?.text);
    }
    if (kind === "verse") {
      const [rows,runs,tags,neighbors] = await Promise.all([read("comparison",[id,chapter,verse]),read("verseRuns",[id,chapter,verse]),read("verseTags",[id,chapter,verse]),read("neighbors",[id,chapter,verse,id,chapter,verse])]);
      if (!rows.length) return missing();
      const tr=rows.some(s=>s.source_id==="TR") ? await read("greekVerseWords",[id,chapter,verse]) : [];
      const items = rows.map(s=>`<section class="comparison"><h2>${a("chapter",s.source_id,{source:s.source_id},{fragment:"v"+verse})} <small>${esc(s.name)}</small></h2><p lang="${esc(s.language)}">${s.source_id==="TR" ? trText(s.text,tr,route)+alignedText(id,chapter,verse) : verseText(s.text,s.source_id==="TNP" ? runs : [],route,t)}</p>${sourceCredit(s.source_id,t)}</section>`).join("");
      return model(ref,`<p class="edition-line">${t.compare}</p>`+items+(tr.length ? layerSelector(t,layers) : "")+(tags.length ? section(t.tags,grid(tags.map(tag=>a("tag",tag.title,{slug:tag.slug},{detail:true})))) : "")+back(rows[0].source_id)+'<div class="pager">'+neighbors.map(n=>a("verse",t[n.direction],n)).join("")+'</div>', rows[0].text);
    }
    if (kind === "note") {
      const [note] = await read("note",[id,chapter,verse,route.ordinal]);
      if (!note) return missing();
      return model(`${ref} · ${t.note} ${route.ordinal}`,`<p class="edition-line">TNP · ${esc(note.label)}</p><blockquote lang="pl">${esc(note.body)}</blockquote>`+sourceCredit("TNP",t)+back());
    }
    if (kind === "word") {
      const [word] = await read("word",[id,chapter,verse,route.ordinal]);
      if (!word) return missing();
      const tokens=(await greekChapter(read,id,chapter)).get(verse) ?? [];
      const selected=tokens.findIndex(token=>token.source?.position===word.position);
      const analyzed=tokens[selected];
      const morphology=analyzed?.morphology;
      const start=Math.max(0,selected-2);
      const context=selected<0 ? "" : tokens.slice(start,selected+3).map((token,i)=>
        i+start===selected ? "<b>"+esc(token.greek)+"</b>" : esc(token.greek)).join(" ");
      const lines=[[t.grammar,word.grammar+" · "+grammarDescription(word.grammar,t.greekGrammar)],
        [t.lemma,word.lemma,"grc"],[t.strong,word.strong ? "G"+word.strong : null],
        [t.glossPl,analyzed?.polish.join(" / "),"pl"],
        [t.greekStrongGloss,morphology?.values.join(" / ") || (morphology?.state==="missing" ? t.greekMissing : t.greekUnavailable)],
        [analyzed?.translationKind==="dictionary" ? t.greekDictionaryMeaning : t.glossEn,analyzed?.english.join(" / "),"en"],
        [t.pronunciation,analyzed?.pronunciation.join(" / ")],[t.definition,word.definition,"en"]];
      const rows=await read("senses",[word.form_key]);
      return model(word.greek,`<p>TR · ${esc(ref)}</p><p lang="grc">${context}</p>` +
        "<dl>"+lines.filter(([,value])=>value).map(([label,value,lang])=>`<dt>${esc(label)}<dd${lang ? ` lang=${lang}` : ""}>${esc(value)}`).join("")+"</dl>" +
        (rows.length ? a("entry",t.dictionary,{key:word.form_key},{detail:true}) : "")+back("TR"));
    }
  }
  if (kind === "dictionary") {
    const chars = await read("dictionaryInitials");
    return model(t.dictionary,grid(chars.map(({initial})=>a("dictionaryLetter",initial,{initial})),"numbers"));
  }
  if (kind === "dictionaryLetter") {
    const entries = await read("dictionaryPage",[route.initial]);
    return entries.length ? model(route.initial,grid(entries.map(e=>a("entry",e.form,{key:e.form_key},{detail:true})),"books")) : missing();
  }
  if (kind === "entry") {
    const rows = await read("senses",[route.key]);
    return rows.length ? model(rows[0].form,section(t.senses,senses(rows,t))+`<aside class="credit">${esc(t.interlinearCredit)}</aside>`) : missing();
  }
  if (kind === "fathers") return model(t.fathers,grid([a("author",t.author)]));
  if (kind === "author") return model(t.author,grid((await read("works")).map(w=>a("work",t.works[w.work_id] ?? w.work_id,{work:w.work_id}))));
  if (kind === "work" || kind === "passage") {
    const w = t.works[route.work] ?? route.work, chapters = (await read("workChapters",[route.work])).map(c=>c.chapter);
    if (!chapters.length) return missing();
    const links = section(t.chapters,grid(chapters.map(ch=>a("passage",ch,{chapter:ch})),"numbers"));
    if (kind === "work") return model(w, links);
    const rows = await read("passage",[route.work,chapter]);
    if (!rows.length) return missing();
    crumbs.push(a("work",w));
    const known=await knownForms(read,rows.map(row=>row.text));
    return model(`${w} · ${chapter}`,layerSelector(t,layers)+rows.map(r=>`<p class="verse" id="v${r.ordinal}"><small>${esc(r.ordinal)}</small>${fatherPassage(r,route,known)}</p>`).join("")+pager(chapters,chapter,(ch,s)=>a("passage",s,{chapter:ch}),t)+`<aside class="credit">${esc(t.fathersCredit)}</aside>`);
  }
  if (kind === "tags") return model(t.tags,grid((await read("tags")).map(tag=>a("tag",tag.title,{slug:tag.slug}))));
  if (kind === "tag") {
    const [tag] = await read("tag",[route.slug]);
    if (!tag) return missing();
    const [refs,ranges,texts,runs, tokens,fathers]=await Promise.all([
      read("tagReferences",[route.slug]),read("tagRanges",[route.slug]),read("greekTagTexts",[route.slug]),
      read("greekTagRuns",[route.slug]),read("greekTagWords",[route.slug]),read("greekTagFathers",[route.slug])]);
    const notes=byReference(runs), strong=byReference(tokens);
    let editions="";
    for (const source of ["TNP","UBG","KJV","TR"]) {
      const selected=texts.filter(row=>row.source_id===source);
      if (!selected.length || selected.length!==refs.length) continue;
      const body=selected.map(row=>{
        const r={...route,book:row.abbr,chapter:row.chapter,verse:row.verse}, ref=[row.book_id,row.chapter,row.verse].join("/");
        const text=source==="TR" ? trText(row.text,strong.get(ref),r)+alignedText(row.book_id,row.chapter,row.verse)
          : verseText(row.text,source==="TNP" ? notes.get(ref) : [],r,t);
        return `<p>${link({...r,kind:"verse"},row.abbr+" "+row.chapter+","+row.verse,{detail:true})} <span lang=${sourceLang[source]}>${text}</span></p>`;
      }).join("");
      editions+=`<details name="tag-edition"${editions ? "" : " open"}><summary>${source}</summary>${body}${sourceCredit(source,t)}</details>`;
    }
    const known=await knownForms(read,fathers.map(f=>f.text));
    const fatherRows=fathers.map(f=>`<p>${a("passage",(t.works[f.work_id] ?? f.work_id)+" "+f.chapter+","+f.ordinal,{work:f.work_id,chapter:f.chapter},{fragment:"v"+f.ordinal})} ${fatherPassage(f,route,known)}</p>`).join("");
    return model(tag.title,`<p>${esc(tag.description)}</p><p>${ranges.map(r=>esc(r.fragment)).join(" · ")}</p>`+
      ((tokens.length || fathers.length) ? layerSelector(t,layers) : "")+section(t.references,editions+fatherRows));
  }
  if (kind === "search") {
    let body=`<form action="${pathFor(route)}" class="search"><label for="q">${t.searchText}</label><div><input id="q" type="search" name="q" value="${esc(route.q)}" maxlength="160"><button>${t.search}</button></div></form><noscript><p>${t.searchDisabled}</p>${a("catalog",t.catalog)}</noscript>`;
    if (!route.q?.trim()) return model(t.search,body);
    const expression = '"' + route.q.trim().slice(0,160).toLowerCase().normalize("NFD").replace(/\p{Mn}/gu,"").replaceAll("ł","l").replaceAll("ς","σ").replaceAll('"','""') + '"';
    const hits = await read("search",[expression]);
    body += hits.length ? '<ol class="hits">'+hits.map(hit=>{
      let ref,lang;
      if (hit.kind==="fathers") {
        ref=a("passage",`${t.works[hit.target] ?? hit.target} ${hit.chapter},${hit.verse}`,{work:hit.target,chapter:hit.chapter},{fragment:"v"+hit.verse}); lang="grc";
      } else if (hit.kind==="entry") {
        ref=a("entry",hit.target,{key:hit.target},{detail:true}); lang="und";
      } else {
        ref=a("chapter",`${hit.source_id} · ${hit.target} ${hit.chapter},${hit.verse}`,{source:hit.source_id,book:hit.target,chapter:hit.chapter},{fragment:"v"+hit.verse}); lang=sourceLang[hit.source_id];
      }
      return `<li>${ref}<p lang="${lang}">${esc(hit.text.slice(0,400))}</p></li>`;
    }).join("")+'</ol>' : `<p role="status">${t.noHits}</p>`;
    return model(t.search,body);
  }
  if (kind === "literature") return model(t.literature,pdfView(locale));
  if (kind === "application") return model(t.application,`<p>${t.appBody}</p>`);
  if (kind === "help") return model(t.help,`<p>${t.helpBody}</p><p>${t.helpDock}</p>`);
  return missing();
}
