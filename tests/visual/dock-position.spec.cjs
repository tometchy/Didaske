const {test,expect}=require('../../app/node_modules/@playwright/test');

test('Move the selected note to every edge and continue reading in the same tab',async({page,context,baseURL})=>{
  await page.goto('/en/Biblia/TNP/J/3/');
  await page.locator('#v16 sup a').first().click();
  const original=await page.locator('#v16').evaluate(v=>v.getBoundingClientRect().top);
  const dialog=page.getByRole('dialog');
  const full=await dialog.locator('[data-full]').getAttribute('href');
  await dialog.locator('[data-edge-select]').selectOption('right');
  await dialog.locator('[data-place]').click();
  const dock=page.locator('#dock');
  await expect(dock).toBeVisible();
  const offset=()=>page.evaluate(()=>document.getElementById('v16').getBoundingClientRect().top-document.getElementById('app').getBoundingClientRect().top);
  await expect.poll(async()=>Math.abs(await offset()-original)).toBeLessThan(4);
  for(const edge of ['left','top','bottom','right']){
    await dock.locator('[data-edge-select]').selectOption(edge);
    await dock.locator('[data-place]').click();
    await expect(page.locator('body')).toHaveAttribute('data-edge',edge);
    await expect(dock.locator('[data-full]')).toHaveAttribute('href',full);
    const visible=await page.locator('#v16').evaluate(v=>{
      const verse=v.getBoundingClientRect(),reader=document.getElementById('app').getBoundingClientRect();
      return verse.bottom>reader.top && verse.top<reader.bottom && document.documentElement.scrollWidth<=innerWidth;
    });
    expect(visible).toBe(true);
  }
  const second=await context.newPage();
  await second.goto(baseURL+full);
  await expect(second.locator('#dock')).toHaveCount(0);
  await second.close();
  await page.locator('main .pager a').last().click();
  await expect(page).toHaveURL(/\/J\/4\/$/);
  await expect(dock.locator('[data-full]')).toHaveAttribute('href',full);
  await dock.locator('[data-undock]').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(dock).toHaveCount(0);
});
