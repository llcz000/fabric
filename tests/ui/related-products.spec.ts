import {test,expect} from '@playwright/test';
const pattern='/tools/ui-preview/entries/ui-ux-internal-patterns.html';
const fabric='/tools/ui-preview/entries/ui-ux-internal-fabrics.html';
for(const entry of [
 {kind:'pattern',url:pattern,trigger:'查看 G0076 关联产品 21 个'},
 {kind:'fabric',url:fabric,trigger:'查看 F018 关联产品 5 个'}
]){
 test(entry.kind+' related fabric information is one compact data-only line',async({page})=>{
  for(const width of [1440,360]){
   await page.setViewportSize({width,height:900});
   await page.goto(entry.url);
   await page.getByRole('button',{name:entry.trigger,exact:true}).click();
   const dialog=page.getByRole('dialog');
   await expect(dialog).toContainText('G0076-1-F018');
   for(const label of ['品号','品名','成分','克重','门幅','备注'])await expect(dialog.getByText(label,{exact:true})).toHaveCount(0);
   const info=dialog.getByText('F018 · 轻薄印花雪纺 · 聚酯纤维 100% · 80 gsm · 145 cm · 适合裙装、衬衫',{exact:true}).first();
   await expect(info).toBeVisible();
   await expect(info).toHaveCSS('white-space','nowrap');
   expect((await info.boundingBox())!.height).toBeLessThanOrEqual(30);
   if(width===1440)expect((await dialog.locator('tbody tr').first().boundingBox())!.height).toBeLessThanOrEqual(56);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   await page.screenshot({path:'artifacts/ui-ux-pilot/related-products-compact-'+entry.kind+'-'+width+'.png'});
  }
 });
}

test.beforeEach(async({page})=>{
 page.on('pageerror',error=>{throw error;});
});

test('pattern total opens all colorways, current fabric details and paged products; Esc restores focus',async({page})=>{
 await page.goto(pattern);
 await expect(page.getByRole('columnheader',{name:'关联产品',exact:true})).toBeVisible();
 const trigger=page.getByRole('button',{name:'查看 G0076 关联产品 21 个',exact:true});
 await trigger.click();
 const dialog=page.getByRole('dialog',{name:'花型关联产品 G0076',exact:true});
 await expect(dialog).toContainText('共 21 个产品');
 await expect(dialog).toContainText('G0076-1-F018');
 for(const text of ['F018','轻薄印花雪纺','聚酯纤维 100%','80 gsm','145 cm','适合裙装、衬衫'])await expect(dialog).toContainText(text);
 await page.screenshot({path:'artifacts/ui-ux-pilot/related-products-pattern-desktop.png',fullPage:true});
 await dialog.getByRole('button',{name:'下一页'}).click();
 await expect(dialog).toContainText('G0076-1-F021');
 await expect(dialog).toContainText('第 2 / 2 页');
 await expect(dialog.getByRole('button',{name:'下一页'})).toBeDisabled();
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(trigger).toBeFocused();
 await page.getByRole('button',{name:'查看 G0075 关联产品 0 个',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('暂无关联产品');
});
test('fabric count opens full fabric information and closes without leaving the list',async({page})=>{
 await page.goto(fabric);
 await page.getByRole('button',{name:'查看 F018 关联产品 5 个',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'面料关联产品 F018',exact:true});
 await expect(dialog).toContainText('共 5 个产品');
 await expect(dialog).toContainText('G0076-1-F018');
 await expect(dialog).toContainText('适合裙装、衬衫');
 await dialog.getByRole('button',{name:'关闭关联产品'}).click();
 await expect(dialog).toHaveCount(0);
 await expect(page.locator('tbody tr')).toHaveCount(3);
 await page.getByRole('button',{name:'查看 F036 关联产品 0 个',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('暂无关联产品');
});
test('linked product failure can retry and retains accessible focus and 360px layout',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.goto(pattern+'?linkedError=1');
 await page.getByRole('button',{name:'查看 G0076 关联产品 21 个',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('alert')).toContainText('关联产品读取失败');
 await dialog.getByRole('button',{name:'重试'}).click();
 await expect(dialog).toContainText('共 21 个产品');
 const bounds=await dialog.boundingBox();
 expect(bounds!.x).toBeGreaterThanOrEqual(0);
 expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(360);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 await page.screenshot({path:'artifacts/ui-ux-pilot/related-products-pattern-mobile.png',fullPage:true});
 await dialog.getByRole('button',{name:'关闭关联产品'}).focus();
 await page.keyboard.press('Shift+Tab');
 expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');
 await page.goto(fabric);
 await page.getByRole('button',{name:'查看 F032 关联产品 2 个',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('16.5 mm');
 await page.screenshot({path:'artifacts/ui-ux-pilot/related-products-fabric-mobile.png',fullPage:true});
});
test('closing a loading request cannot reopen stale products and keeps the current search',async({page})=>{
 await page.goto(pattern+'?linkedDelay=1');
 await page.getByRole('textbox',{name:'搜索编号'}).fill('G0076');
 await expect(page.getByRole('navigation',{name:'花型分页'})).toContainText('共 1 个花型');
 const trigger=page.getByRole('button',{name:'查看 G0076 关联产品 21 个',exact:true});
 await trigger.click();
 await expect(page.getByRole('status',{name:'',exact:true}).filter({hasText:'正在读取关联产品'})).toBeVisible();
 await page.getByRole('button',{name:'关闭关联产品'}).click();
 await expect(trigger).toBeFocused();
 await expect(page.getByRole('textbox',{name:'搜索编号'})).toHaveValue('G0076');
 await trigger.click();
 await expect(page.getByRole('dialog')).toContainText('共 21 个产品');
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('unrelated product rows are rejected instead of appearing under the wrong pattern',async({page})=>{
 await page.goto(pattern+'?linkedMismatch=1');
 await page.getByRole('button',{name:'查看 G0076 关联产品 21 个',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('alert')).toContainText('关联产品资料无效');
 await expect(dialog.getByRole('table')).toHaveCount(0);
});


for(const entry of [
 {kind:'pattern',url:pattern,trigger:'查看 G0076 关联产品 21 个',count:20},
 {kind:'fabric',url:fabric,trigger:'查看 F018 关联产品 5 个',count:5}
])test(entry.kind+' related products show matching thumbnails directly at desktop and mobile sizes',async({page})=>{
 await page.route('https://fabric-related-fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#f1e2df"/><path d="M5 120Q60 60 20 0M70 120Q10 60 65 0" fill="none" stroke="#54765b" stroke-width="4"/><circle cx="30" cy="40" r="12" fill="#bb647e"/><circle cx="50" cy="85" r="14" fill="#bb647e"/></svg>'}));
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});
  await page.goto(entry.url+'?linkedImages=1');
  await page.getByRole('button',{name:entry.trigger,exact:true}).click();
  const dialog=page.getByRole('dialog'),rows=dialog.locator('tbody tr');
  await expect(rows).toHaveCount(entry.count);
  const first=rows.first(),image=first.getByRole('img',{name:'花型 G0076-1',exact:true});
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
  await expect(image).toHaveCSS('object-fit','contain');
  await expect(rows.nth(4)).toContainText('暂无图片');
  const box=await image.boundingBox();expect(box!.width).toBe(40);expect(box!.height).toBe(40);
  if(entry.kind==='fabric')await expect(rows.nth(1).getByRole('img',{name:'花型 G0075-1',exact:true})).toHaveAttribute('src',/000000000075.svg$/);
  if(width===1440)expect((await first.boundingBox())!.height).toBeLessThanOrEqual(56);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const bounds=await first.boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:'artifacts/related-product-thumbnails/'+entry.kind+'-'+width+'.png'});
  if(entry.kind==='pattern'){
   await dialog.getByRole('button',{name:'下一页'}).click();
   await expect(rows).toHaveCount(1);await expect(rows.first().getByRole('img',{name:'花型 G0076-1',exact:true})).toBeVisible();
   await expect(dialog).toContainText('G0076-1-F021');
  }
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:entry.trigger,exact:true})).toBeFocused();
 }
});

test('thumbnail signing failure keeps product information and supports retry without losing the page',async({page})=>{
 await page.route('https://fabric-related-fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#b77c8a"/></svg>'}));
 await page.goto(fabric+'?linkedImages=1&linkedImageError=1');
 await page.getByRole('button',{name:'查看 F018 关联产品 5 个',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('缩略图暂不可用');await expect(dialog).toContainText('G0076-1-F018');
 await expect(dialog.locator('tbody tr')).toHaveCount(5);
 await dialog.getByRole('button',{name:'重试缩略图',exact:true}).click();
 await expect(dialog.getByRole('img',{name:'花型 G0076-1',exact:true})).toBeVisible();
 await expect(dialog).not.toContainText('缩略图暂不可用');await expect(dialog).toContainText('第 1 / 1 页');
});

test('broken thumbnail shows a fallback and can retry without opening original images',async({page})=>{
 let broken=true;
 await page.route('https://fabric-related-fixture.invalid/**',route=>broken?route.fulfill({status:404,body:''}):route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#b77c8a"/></svg>'}));
 await page.goto(fabric+'?linkedImages=1');await page.getByRole('button',{name:'查看 F018 关联产品 5 个',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.locator('tbody tr').first()).toContainText('加载失败');
 await expect(dialog).toContainText('G0076-1-F018');broken=false;
 await dialog.getByRole('button',{name:'重试缩略图',exact:true}).click();
 const image=dialog.getByRole('img',{name:'花型 G0076-1',exact:true});await expect(image).toBeVisible();
 await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
});
