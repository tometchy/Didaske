// Exact lexical lookup retains breathing, iota subscript and diaeresis. Alignment
// alone may ignore accents when comparing independent editions of a passage.
export function formKey(word) {
  return word.toLowerCase().normalize("NFD").replaceAll("\u0300","\u0301").normalize("NFC").replaceAll("ς","σ");
}
export function words(text) {
  return text.match(/(?=[\u0370-\u03ff\u1f00-\u1fff])\p{L}(?:(?=[\u0370-\u03ff\u1f00-\u1fff])\p{L}|\p{M})*/gu) ?? [];
}
const alignmentKey = word => formKey(word).normalize("NFD").replace(/\p{Mn}/gu,"");
const ordinal = (a,b) => a<b ? -1 : a>b ? 1 : 0;

export function align(selected,source) {
  const a=selected.map(alignmentKey), b=source.map(alignmentKey);
  const lengths=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=a.length-1;i>=0;i--) for(let j=b.length-1;j>=0;j--) {
    lengths[i][j]=a[i]===b[j] ? lengths[i+1][j+1]+1 : Math.max(lengths[i+1][j],lengths[i][j+1]);
  }
  const result=new Map();
  if(lengths[0][0]<Math.min(3,a.length) || lengths[0][0]<a.length*0.65) return result;
  for(let i=0,j=0;i<a.length && j<b.length;) {
    if(a[i]===b[j]) { result.set(i++,j++); }
    else if(lengths[i+1][j]>lengths[i][j+1]) i++;
    else j++;
  }
  return result;
}

function distinct(rows,field) {
  const values=new Map();
  for (const row of rows) {
    const value=row[field]?.trim();
    if (!value) continue;
    const shown=value==="-" ? "—" : value;
    if (!values.has(shown.toLowerCase())) values.set(shown.toLowerCase(),shown);
  }
  return [...values.values()];
}

export function morphology(token,compatible,senses) {
  if (!token?.strong || !token.grammar) return {state:"unavailable",values:[]};
  const frequencies=new Map();
  const keys=[...new Set(compatible)].sort((a,b)=>
    Number(b===token.form_key)-Number(a===token.form_key) || ordinal(a,b)).slice(0,32);
  for (const key of keys) {
    for (const sense of senses.get(key) ?? []) {
      if (!sense.code?.toUpperCase().split("/").some(code=>code.trim()===token.grammar.toUpperCase())) continue;
      const value=sense.polish?.trim();
      if (!value || value==="—" || value==="-") continue;
      const k=value.toLowerCase(), group=frequencies.get(k) ?? {value,n:0};
      group.n++; frequencies.set(k,group);
    }
  }
  const values=[...frequencies.values()].sort((a,b)=>b.n-a.n || ordinal(a.value,b.value)).map(e=>e.value);
  return {state:values.length>1 ? "variants" : values.length ? "single" : "missing",values};
}

export function describePassage(selected,interlinear,strong,senses,identities) {
  const context=align(selected,interlinear.map(row=>row.greek));
  const strongMap=align(selected,strong.map(row=>words(row.greek)[0] ?? ""));
  return selected.map((greek,i)=>{
    const key=formKey(greek), forms=senses.get(key) ?? [];
    const aligned=interlinear[context.get(i)], token=strong[strongMap.get(i)];
    const source=token?.form_key===key ? token : null;
    const readings=aligned ? [aligned] : forms;
    const pron=aligned && formKey(aligned.greek)!==key ? distinct(forms,"pronunciation").slice(0,1) : distinct(readings,"pronunciation");
    const polish=distinct(readings,"polish");
    return {greek,source,polish,english:distinct(readings,"english"),code:distinct(readings,"code"),
      pronunciation:pron,translationKind:readings.some(s=>s.english_kind==="dictionary") ? "dictionary" : "gloss",
      match:aligned ? "passage" : !forms.length ? "missing" : polish.length>1 ? "ambiguous" : "form",
      morphology:morphology(source,identities.get(source?.strong+"|"+source?.grammar) ?? [],senses)};
  });
}

function group(rows,key) {
  const result=new Map();
  for (const row of rows) {
    const k=key(row);
    if (!result.has(k)) result.set(k,[]);
    result.get(k).push(row);
  }
  return result;
}

async function batches(read,query,values) {
  const keys=[...new Set(values)],rows=[];
  // A batch remains within the installed reader's parameter and result limits.
  for(let i=0;i<keys.length;i+=28) rows.push(...await read(query,[JSON.stringify(keys.slice(i,i+28))]));
  return rows;
}

const caches=new WeakMap();
export function greekChapter(read,book,chapter) {
  let cache=caches.get(read);
  if (!cache) { cache={chapters:new Map()}; caches.set(read,cache); }
  const ref=book+"/"+chapter;
  if (!cache.chapters.has(ref)) {
    if (cache.chapters.size>=4) cache.chapters.delete(cache.chapters.keys().next().value);
    const loading=analyzeChapter(read,cache,book,chapter).catch(e=>{cache.chapters.delete(ref);throw e;});
    cache.chapters.set(ref,loading);
  }
  return cache.chapters.get(ref);
}

async function analyzeChapter(read,cache,book,chapter) {
  cache.exceptions ??= Promise.resolve().then(()=>read("greekHomographs",[])).then(rows=>
    new Set(rows.map(r=>r.grammar+"|"+r.form_key))).catch(e=>{cache.exceptions=undefined;throw e;});
  const [passages,strong,interlinear,exceptions]=await Promise.all([
    read("chapter",["TR",book,chapter]),read("words",[book,chapter]),
    read("interlinearChapter",[book,chapter]),cache.exceptions]);
  const identityRows=await batches(read,"greekRelated",strong.map(row=>row.strong).filter(Boolean));
  const needed=new Set(strong.map(row=>row.strong+"|"+row.grammar));
  const compatible=new Map();
  for(const row of identityRows) {
    const id=row.strong+"|"+row.grammar;
    if (!needed.has(id) || exceptions.has(row.grammar+"|"+row.form_key)) continue;
    if (!compatible.has(id)) compatible.set(id,[]);
    compatible.get(id).push(row.form_key);
  }
  const selected=passages.map(r=>[r.verse,words(r.text)]);
  const keys=selected.flatMap(([,w])=>w.map(formKey));
  for (const forms of compatible.values()) keys.push(...forms.slice(0,32));
  const senses=group(await batches(read,"greekSenses",keys),r=>r.form_key);
  for (const [key,all] of senses) {
    const primary=all.filter(row=>row.source!=="supplement");
    if (primary.length) senses.set(key,primary);
  }
  const ctx=group(interlinear,r=>r.verse), tr=group(strong,r=>r.verse);
  return new Map(selected.map(([verse,selection])=>[verse,describePassage(selection,ctx.get(verse) ?? [],tr.get(verse) ?? [],senses,compatible)]));
}

// Both catalogs use the same Ross grammar and independent UI labels.
export function grammarDescription(code,labels) {
  if (!code) return labels.unknown;
  return code.split("/").map(part=>{
    const key=part.trim();
    if (labels.fixed[key]) return labels.fixed[key];
    let m=/^([NATPRDFI])-([NGDAV])([SP])([MFN])$/.exec(key);
    if(m) return [labels.part[m[1]],labels.case[m[2]],labels.number[m[3]],labels.gender[m[4]]].join(", ");
    m=/^P-([123])([NGDAV])([SP])$/.exec(key);
    if(m) return [labels.personal,labels.person[m[1]],labels.case[m[2]],labels.number[m[3]]].join(", ");
    m=/^V-([12]?)([PIFARLX])([AMPDNE])([ISOMNP])(?:-([123][SP]|[NGDAV][SP][MFN]))?$/.exec(key);
    if(m) {
      const parts=[labels.verb,labels.tense[m[2]],labels.voice[m[3]],labels.mood[m[4]]];
      if(m[1]) parts.push(labels.stem[m[1]]);
      if(m[5]?.length===2) parts.push(labels.person[m[5][0]],labels.number[m[5][1]]);
      if(m[5]?.length===3) parts.push(labels.case[m[5][0]],labels.number[m[5][1]],labels.gender[m[5][2]]);
      return parts.join(", ");
    }
    return labels.unknown;
  }).join(" / ");
}

export async function knownForms(read,texts) {
  const keys=texts.flatMap(text=>words(text).map(formKey));
  return new Set((await batches(read,"greekAttested",keys)).map(row=>row.form_key));
}

export async function patristicReadings(read,text) {
  const selected=words(text);
  const senses=group(await batches(read,"greekSenses",selected.map(formKey)),r=>r.form_key);
  for (const [key,all] of senses) {
    const primary=all.filter(row=>row.source!=="supplement");
    if (primary.length) senses.set(key,primary);
  }
  return describePassage(selected,[],[],senses,new Map());
}
