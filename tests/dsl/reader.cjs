const browser = require('../drivers/browser.cjs');
module.exports = {
  openJohnThreeInTnp(locale) {
    browser.open(`/${locale}/Biblia/TNP/J/3/`);
    browser.assertLanguage(locale);
  },
  seeSourceNotesForVerseSixteen() { browser.assertFootnoteLinks(16, 2); }
};
