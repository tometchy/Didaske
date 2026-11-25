const { I } = inject();

module.exports = {
  open(path) { I.amOnPage(path); },
  assertLanguage(locale) { I.seeElement(`html[lang="${locale}"]`); },
  assertPassage(text) { I.see(text, '#main-content'); },
  assertFootnoteLinks(verse, number) {
    I.seeNumberOfElements(`#v${verse} sup a[href*="/notes/"]`, number);
  }
};
