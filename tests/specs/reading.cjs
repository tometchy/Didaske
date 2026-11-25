Feature('Read the TNP edition');
for (const locale of ['en', 'pl']) {
  Scenario(`John 3:16 retains its two source notes in the ${locale} interface`, ({ reader }) => {
    reader.openJohnThreeInTnp(locale);
    reader.seeSourceNotesForVerseSixteen();
  });
}
