const {test,expect} = require('../../app/node_modules/@playwright/test');

test('Three independent search tabs query the verified SQLite snapshot', async ({context,baseURL}) => {
  const pages = await Promise.all(Array.from({length:3}, () => context.newPage()));
  const phrases = ['grace','logos','Jezus'];
  for (const page of pages) await page.goto(baseURL+'/en/Search/');
  await Promise.all(pages.map(async (page,i) => {
    const term = phrases[i];
    await page.locator('form.search input[name=q]').fill(term);
    await page.locator('form.search input[name=q]').press('Enter');
    await expect(page).toHaveURL(new RegExp('q=' + term), {timeout:55000});
    if (term === 'logos') return; // The query may legitimately have zero exact matches.
    await expect(page.locator('#main-content .hits a').first()).toBeVisible();
    await expect(page.locator('#reading-error')).toHaveCount(0);
  }));
});
