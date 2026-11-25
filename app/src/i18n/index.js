import en from "./en.json" with { type: "json" };
import pl from "./pl.json" with { type: "json" };

export const catalog = { en, pl };
export function bookName(locale, book) {
  return locale === "pl" ? book.name_pl ?? book.abbr : book.name_en;
}
export function pendingCount(locale, count) {
  const forms = catalog[locale].pendingCount;
  const category = new Intl.PluralRules(locale).select(count);
  return (forms[category] ?? forms.other).replace("{count}", new Intl.NumberFormat(locale).format(count));
}
