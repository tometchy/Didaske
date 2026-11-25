export const pdfLabels = {
  en: {title:"Parallel PDF reader", language:["English","Polish"], url:"PDF address", file:"Open local PDF", load:"Load documents", page:"Page", next:"Next", previous:"Previous", layout:"Layout", side:"Side by side", stacked:"Stacked", swap:"Swap documents", failed:"Could not read this PDF. Try opening a local copy.", missing:"Choose a PDF.", outside:"This document ends on page", scripting:"Enable JavaScript to compare documents."},
  pl: {title:"Równoległy czytnik PDF", language:["Angielski","Polski"], url:"Adres PDF", file:"Otwórz lokalny PDF", load:"Wczytaj dokumenty", page:"Strona", next:"Dalej", previous:"Wstecz", layout:"Układ", side:"Obok siebie", stacked:"Jeden pod drugim", swap:"Zamień kolejność", failed:"Nie udało się odczytać PDF. Spróbuj otworzyć lokalną kopię.", missing:"Wybierz PDF.", outside:"Dokument kończy się na stronie", scripting:"Włącz JavaScript, aby porównać dokumenty."}
};

export function pdfView(locale) {
  const t=pdfLabels[locale];
  return `<section class="pdf-reader" data-pdf><h2>${t.title}</h2><noscript>${t.scripting}</noscript>
    <form data-sources>${t.language.map((language,i)=>`<fieldset><legend>${language}</legend><label>${t.url}<input type="url" name="url${i}" placeholder="https://…"></label><label>${t.file}<input name="file${i}" type="file" accept=".pdf,application/pdf"></label></fieldset>`).join("")}<button>${t.load}</button></form>
    <div class="pdf-controls"><button data-previous>${t.previous}</button><label>${t.page}<input data-page type="number" min="1" value="1"></label><button data-next>${t.next}</button><label>${t.layout}<select data-layout><option value="side">${t.side}</option><option value="stacked">${t.stacked}</option></select></label><button data-swap>${t.swap}</button></div>
    <div class="pdf-pages">${t.language.map((language,i)=>`<article data-document="${i}"><h3>${language}</h3><p role="status">${t.missing}</p><canvas hidden aria-label="${language} PDF"></canvas></article>`).join("")}</div></section>`;
}
