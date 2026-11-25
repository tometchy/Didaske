import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const requirements = {
  "google-play": {
    locales: ["en-US", "pl-PL"],
    fields: { title: 30, shortDescription: 80, fullDescription: 4000, releaseNotes: 500 },
  },
  "app-store": {
    locales: ["en-US", "pl"],
    fields: { name: 30, subtitle: 30, description: 4000, keywords: 100, promotionalText: 170, whatsNew: 4000 },
  },
};
for (const [store, { locales, fields }] of Object.entries(requirements)) {
  const directory = new URL(`./${store}/`, import.meta.url);
  assert.deepEqual(readdirSync(directory).sort(), locales.toSorted());
  let english;
  for (const locale of locales) {
    const listing = JSON.parse(readFileSync(new URL(`${locale}/listing.json`, directory), "utf8"));
    assert.deepEqual(Object.keys(listing).sort(), Object.keys(fields).sort());
    assert.equal(listing.name ?? listing.title, "Didaske");
    for (const [field, limit] of Object.entries(fields)) {
      const value = listing[field];
      assert.equal(typeof value, "string", `${store}/${locale}/${field}`);
      assert.ok(value.trim() && value === value.trim());
      const length = field === "keywords" ? Buffer.byteLength(value) : Array.from(value).length;
      assert.ok(length <= limit, `${store}/${locale}/${field} exceeds ${limit}`);
      if (english && field !== "name" && field !== "title") assert.notEqual(value, english[field]);
    }
    if (locale === "en-US") english = listing;
  }
}
console.log("Google Play and App Store text fields passed in all four storefront locales.");
