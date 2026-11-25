import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { pdfLabels } from "./views/pdf.js";
import { getPreference, setPreference } from "./outbox.js";

GlobalWorkerOptions.workerSrc=workerUrl;

function pdfUrl(value) {
  const url=new URL(value);
  if (url.protocol!=="https:" || url.username || url.password) throw new Error("INVALID_PDF_URL");
  if (url.hostname==="github.com") {
    const parts=url.pathname.split("/");
    if (parts[3]==="blob") {
      parts.splice(3,1);
      url.hostname="raw.githubusercontent.com"; url.pathname=parts.join("/");
    }
  }
  url.hash="";
  return url.href;
}

export async function mountPdf(root, locale) {
  if (!root || root.dataset.active) return;
  root.dataset.active="true";
  const t=pdfLabels[locale], form=root.querySelector("form"), page=root.querySelector("[data-page]"),
    layout=root.querySelector("[data-layout]"), panes=root.querySelector(".pdf-pages");
  const docs=[null,null], versions=[0,0], jobs=[null,null];
  let swapped=false;
  const urls=[form.elements.url0,form.elements.url1], files=[form.elements.file0,form.elements.file1];
  const saved=await getPreference("literature","pdf").catch(()=>null);
  if (!root.isConnected) return;
  if (saved) {
    urls.forEach((input,i)=>{input.value=saved.urls?.[i] || "";});
    page.value=saved.page ?? 1; layout.value=saved.layout || "side"; swapped=Boolean(saved.swapped);
  }
  function settings() {
    const number=Number(page.value);
    page.value=String(Number.isSafeInteger(number) && number>0 ? number : 1);
    panes.dataset.layout=layout.value;
    panes.prepend(panes.querySelector('[data-document="'+(swapped?1:0)+'"]'));
    root.querySelector("[data-previous]").disabled=Number(page.value)===1;
    void setPreference("literature","pdf",{urls:urls.map(i=>i.value),page:Number(page.value),layout:layout.value,swapped}).catch(()=>{});
  }
  async function render(i) {
    const version=++versions[i], article=panes.querySelector('[data-document="'+i+'"]');
    const status=article.querySelector("p"),canvas=article.querySelector("canvas");
    const job=jobs[i];
    if (job) { job.cancel(); await job.promise.catch(()=>{}); }
    if (version!==versions[i]) return;
    canvas.hidden=true;
    if (!docs[i]) {status.textContent=t.missing;return;}
    try {
      const doc=await docs[i].promise;
      if (version!==versions[i] || !root.isConnected) return;
      const index=Number(page.value);
      if (index>doc.numPages) {status.textContent=t.outside+" "+doc.numPages+".";return;}
      const source=await doc.getPage(index);
      if (version!==versions[i] || !root.isConnected) return;
      const original=source.getViewport({scale:1});
      const viewport=source.getViewport({scale:Math.min(2,Math.min(1400,Math.max(260,article.clientWidth)*devicePixelRatio)/original.width)});
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const task=source.render({canvas,viewport});
      jobs[i]=task;await task.promise;
      if (version===versions[i]) {
        canvas.hidden=false;status.textContent=t.page+" "+index+" / "+doc.numPages;
      }
    } catch {
      if (version===versions[i]) status.textContent=t.failed;
    }
  }
  async function load(i) {
    const version=++versions[i];
    const previous=docs[i]; docs[i]=null;
    if (previous) await previous.destroy().catch(()=>{});
    try {
      const file=files[i].files[0];
      const source=file ? {data:new Uint8Array(await file.arrayBuffer())} : urls[i].value ? {url:pdfUrl(urls[i].value)} : null;
      if (version!==versions[i] || !root.isConnected) return;
      if (source) docs[i]=getDocument({...source,isEvalSupported:false,enableXfa:false,useWasm:false,useSystemFonts:true});
      await render(i);
    } catch { panes.querySelector('[data-document="'+i+'"] p').textContent=t.failed; }
  }
  function update() {settings();void Promise.all([render(0),render(1)]);}
  form.addEventListener("submit",e=>{e.preventDefault();settings();void Promise.all([load(0),load(1)]);});
  files.forEach((input,i)=>input.addEventListener("change",()=>{urls[i].value="";settings();void load(i);}));
  urls.forEach((input,i)=>input.addEventListener("input",()=>{files[i].value="";}));
  root.querySelector("[data-previous]").onclick=()=>{page.stepDown();update();};
  root.querySelector("[data-next]").onclick=()=>{page.stepUp();update();};
  root.querySelector("[data-swap]").onclick=()=>{swapped=!swapped;update();};
  page.onchange=layout.onchange=update;
  const observer=new MutationObserver(()=>{
    if (root.isConnected) return;
    observer.disconnect();
    docs.forEach((doc,i)=>{versions[i]++;if(doc)void doc.destroy().catch(()=>{});});
  });
  observer.observe(document.getElementById("app"),{childList:true,subtree:true});
  settings();await Promise.all([load(0),load(1)]);
}
