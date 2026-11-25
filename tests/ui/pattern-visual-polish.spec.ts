import {expect,test} from '@playwright/test';

const entry='/tools/ui-preview/entries/ui-ux-internal-patterns.html?dimensions=1&create-upload-review=1&image-variants=1';
const proof='artifacts/pattern-visual-polish/';
const sample='<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" fill="#e8ece4"/><path fill="#356556" d="M6 34Q25 5 52 27Q30 43 6 34M36 78Q37 46 68 41Q75 63 36 78"/><path fill="#b47366" d="M66 6L75 17L89 14L86 29L77 42L62 32L53 19Z"/></svg>';

for(const width of [1440,360,390]){
 test('pattern workbench and new pattern layout at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:width===1440?900:800});
  await page.route('https://fabric-related-fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:sample}));
  await page.goto(entry+'&gallery=1');
  const number=page.getByRole('textbox',{name:'搜索编号'});
  const filter=page.getByRole('button',{name:/^题材标签/});
  await expect(page.getByRole('button',{name:'清空筛选'})).toHaveCount(0);
  const searchRect=await number.boundingBox(),filterRect=await filter.boundingBox();
  expect(Math.abs(searchRect!.y-filterRect!.y)).toBeLessThan(6);
  await number.fill('G0068');
  await expect(page.getByRole('button',{name:'清空筛选'})).toBeVisible();
  await expect(page.getByRole('button',{name:'查看花型原图 G0068-1'})).toBeVisible();
  await page.getByRole('img',{name:'G0068-1',exact:true}).evaluate((img:HTMLImageElement)=>img.decode());
  await page.screenshot({path:proof+'library-'+width+'.png'});
  const open=page.getByRole('button',{name:'新增花型'});
  await open.click();
  const dialog=page.getByRole('dialog',{name:'新增花型'});
  const save=dialog.getByRole('button',{name:'保存花型'});
  await expect(dialog.getByRole('textbox',{name:'花型编号'})).toBeFocused();
  await expect(dialog.getByLabel('配色 1 花型图',{exact:true})).toHaveCount(1);
  await expect(dialog.getByRole('button',{name:'添加配色'})).toBeInViewport();
  await expect(save).toBeInViewport();
  await page.screenshot({path:proof+'create-empty-'+width+'.png'});
  await dialog.getByText('题材标签',{exact:true}).click();
  await expect(dialog.getByRole('button',{name:'油画花卉',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'油画花卉',exact:true}).click();
  await dialog.getByText('题材标签',{exact:true}).click();
  await expect(dialog.locator('summary')).toContainText('油画花卉');
  await dialog.getByRole('button',{name:'添加配色'}).click();
  await dialog.getByRole('button',{name:'添加配色'}).click();
  await expect(save).toBeInViewport();
  expect(await dialog.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button',{name:'确认关闭'}).click();
  await expect(open).toBeFocused();
  await expect(number).toHaveValue('G0068');
  await page.getByRole('button',{name:'清空筛选'}).click();
  await expect(number).toHaveValue('');
  await expect(number).toBeFocused();
 });
}

test('select image, show row progress, keep draft on failure, and retry the same file',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.route('https://fabric-related-fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:sample}));
 await page.goto(entry);
 const buffer=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');
  canvas.width=84;canvas.height=64;
  const context=canvas.getContext('2d')!;
  context.fillStyle='#376558';context.fillRect(0,0,84,64);
  context.fillStyle='#e3b499';for(let i=0;i<4;i++)context.fillRect(i*22,14,14,28);
  return canvas.toDataURL().split(',')[1];
 });
 await page.getByRole('button',{name:'新增花型'}).click();
 const dialog=page.getByRole('dialog',{name:'新增花型'});
 const image=dialog.getByLabel('配色 1 花型图',{exact:true});
 const save=dialog.getByRole('button',{name:'保存花型'});
 await dialog.getByRole('textbox',{name:'花型编号'}).fill('G9002');
 await dialog.getByRole('textbox',{name:'配色 1 备注'}).fill('保留备注');
 await image.setInputFiles({name:'G9002-1.png',mimeType:'image/png',buffer:Buffer.from(buffer,'base64')});
 await expect(dialog.getByRole('img',{name:'待保存花型图'})).toBeVisible();
 await expect(dialog.getByText('已选图，保存时上传')).toBeVisible();
 await page.screenshot({path:proof+'create-selected-360.png'});
 await save.click();
 await expect(dialog.getByText('正在上传…',{exact:true})).toBeVisible();
 await expect(save).toBeDisabled();
 await expect(dialog.getByRole('alert')).toContainText('上传失败');
 await expect(dialog.getByRole('textbox',{name:'配色 1 备注'})).toHaveValue('保留备注');
 await expect(dialog.getByText('G9002-1.png',{exact:true})).toBeVisible();
 await page.screenshot({path:proof+'create-upload-error-360.png'});
 await save.click();
 await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('region',{name:'操作提示'})).toContainText('花型 G9002 及配色已保存。');
 await expect(page.getByText('G9002-1',{exact:true})).toBeVisible();
});
