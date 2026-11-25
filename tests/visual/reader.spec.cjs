const { test, expect } = require('../../app/node_modules/@playwright/test');

for (const locale of ['pl','en']) {
  test(`TNP note and dock in ${locale}`, async ({ page }) => {
    await page.goto('/' + locale + '/Biblia/TNP/J/3/');
    const markers = page.locator('#v16 sup a');
    await expect(markers).toHaveCount(2);
    expect(await markers.allTextContents()).toEqual(['*','**']);
    const target = await markers.nth(1).getAttribute('href');
    await markers.nth(1).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const link = dialog.locator('a[href="' + target + '"]');
    await expect(link).toBeVisible();
    await expect(page).toHaveScreenshot(locale + '-note.png');
    await dialog.locator('[data-edge-select]').selectOption('right');
    await dialog.locator('[data-place]').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('main')).toBeVisible();
    await expect(page).toHaveScreenshot(locale + '-dock.png');
  });

  test(`Public direct links and source markup without JavaScript in ${locale}`, async ({browser,baseURL})=>{
    const ctx = await browser.newContext({ javaScriptEnabled:false, baseURL });
    try {
      const page = await ctx.newPage();
      await page.goto('/' + locale + '/Biblia/TNP/J/1/');
      const verse = page.locator('#v38');
      await expect(verse.locator('strong').first()).toBeVisible();
      expect((await verse.locator('strong').allTextContents()).join('')).toEqual('Czego szukacie?');
      await page.goto('/' + locale + '/Biblia/TNP/J/3/');
      const markers = page.locator('#v16 sup a');
      const links = await markers.evaluateAll(items => items.map(a => a.href));
      expect(links[0]).not.toEqual(links[1]);
      const bodies = [];
      for (const href of links) {
        expect((await page.goto(href)).status()).toBe(200);
        bodies.push(await page.locator('blockquote').innerText());
      }
      expect(bodies[0]).not.toEqual(bodies[1]);
      expect(bodies.every(body => body.trim())).toBeTruthy();
    } finally { await ctx.close(); }
  });
}

test('Keyboard activation, edge changes, passage navigation and independent tabs', async ({page,context})=>{
  await page.goto('/en/Biblia/TNP/J/3/');
  const tab = await context.newPage();
  await tab.goto('/pl/Biblia/TNP/J/1/');
  const trigger = page.locator('#v16 sup a').first();
  await trigger.focus();
  await trigger.press('Enter');
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Open full page')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-edge-select]').selectOption('right');
  await dialog.locator('[data-place]').click();
  const dock = page.locator('#dock');
  await expect(dock).toBeVisible();
  await expect(tab.locator('#dock')).toHaveCount(0);
  for (const edge of ['left','top','bottom','right']) {
    await dock.locator('[data-edge-select]').selectOption(edge);
    await dock.locator('[data-place]').click();
    await expect(page.locator('body')).toHaveAttribute('data-edge',edge);
  }
  await page.locator('main a[href="/en/Biblia/TNP/J/4/"]').last().click();
  await expect(page).toHaveURL(/\/J\/4\/$/);
  await expect(dock.locator('[data-full]')).toHaveAttribute('href','/en/Study/TNP/J/3/16/notes/1/');
  await dock.locator('[data-undock]').click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('#dock')).toHaveCount(0);
  await dialog.locator('[data-full]').click();
  await expect(page).toHaveURL(/\/notes\/1\/$/);
  await expect(tab).toHaveURL(/\/pl\/Biblia\/TNP\/J\/1\/$/);
});
