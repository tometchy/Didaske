const {test,expect} = require('../../app/node_modules/@playwright/test');

function blankPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',...Array(2).fill('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 150 175] /Resources <<>> >>')];
  let pdf='%PDF-1.4\n';
  const offsets=[0];
  for (const [i,obj] of objects.entries()) { offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n'; }
  const xref=pdf.length;
  pdf+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  return Buffer.from(pdf);
}
test('Compare two offline PDFs and turn both pages together',async ({page})=>{
  await page.goto('/pl/Teksty/');
  const viewer=page.locator('[data-pdf][data-active="true"]');
  for (const input of ['file0','file1']) await viewer.locator('input[name="'+input+'"]').setInputFiles({name:'pages.pdf',mimeType:'application/pdf',buffer:blankPdf()});
  await expect(viewer.locator('canvas:visible')).toHaveCount(2);
  await viewer.locator('[data-next]').click();
  await expect(viewer.getByText('Strona 2 / 2')).toHaveCount(2);
  await viewer.locator('select[data-layout]').selectOption('stacked');
  await viewer.locator('[data-swap]').click();
  await expect(viewer.locator('article').first()).toHaveAttribute('data-document','1');
});
