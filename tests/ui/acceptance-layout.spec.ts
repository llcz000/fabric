import {test,expect,type Locator} from '@playwright/test';

const entry='/tools/ui-preview/entries/ui-ux-internal-';
const evidence='artifacts/ui-ux-pilot/acceptance-layout';
async function touchSize(locator:Locator,minimum:number){
 await expect(locator).toBeVisible();
 const box=await locator.boundingBox();
 expect(box?.width).toBeGreaterThanOrEqual(minimum);
 expect(box?.height).toBeGreaterThanOrEqual(minimum);
}

for(const width of [360,1440]){
 test('pattern original controls keyboard focus and preserves gallery navigation at '+width,async({page})=>{
  await page.setViewportSize({width,height:800});
  await page.route('https://fabric-related-fixture.invalid/**',route=>route.fulfill({
   contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="navy"/></svg>'
  }));
  await page.goto(entry+'patterns.html?gallery=1&dimensions');
  await page.getByRole('textbox',{name:'搜索编号'}).fill('G0068');
  const trigger=page.getByRole('button',{name:'查看花型原图 G0068-1',exact:true});
  await trigger.click();
  const dialog=page.getByRole('dialog',{name:/花型原图 G0068-/});
  const close=dialog.getByRole('button',{name:'关闭原图'});
  await expect(close).toBeFocused();
  await touchSize(close,width===360?44:40);
  const next=dialog.getByRole('button',{name:'下一配色原图'});
  await touchSize(next,width===360?44:40);
  await page.keyboard.press('Shift+Tab');
  await expect(next).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('img',{name:'花型原图 G0068-2'})).toBeVisible();
  await expect(close).toBeFocused();
  await page.screenshot({path:evidence+'-pattern-dialog-'+width+'.png'});
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole('button',{name:'编辑花型及配色 G0068',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'编辑花型 G0068'});
  const nested=editor.getByRole('button',{name:'查看花型原图 G0068-1',exact:true});
  await nested.click();
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(nested).toBeFocused();
 });

 test('document result and one preview entry are reachable at '+width,async({page})=>{
  await page.setViewportSize({width,height:800});
  await page.goto(entry+'chrome.html?documents');
  const advanced=page.getByRole('button',{name:'更多筛选'});
  const no=page.locator('input[name="productNo"]');
  const region=page.getByRole('region',{name:'单据列表，可左右滚动'});
  const order=region.getByRole('row').filter({hasText:'XS20261029-047'});
  const item=order.getByRole('button',{name:'预览 / Excel',exact:true});
  if(width===360){
   await expect(no).toBeHidden();
   await expect(advanced).toHaveAttribute('aria-expanded','false');
   await advanced.click();
   await no.fill('G0001');
   await advanced.click();
   await expect(no).toBeHidden();
   await expect(advanced).toHaveAccessibleDescription('其他筛选已填写');
   await advanced.click();
   await expect(no).toHaveValue('G0001');
   await page.getByRole('button',{name:'查询',exact:true}).click();
   await no.clear();
   await advanced.click();
   await expect(advanced).toHaveAccessibleDescription('其他筛选已生效');
   await advanced.click();
   await page.getByRole('button',{name:'清除筛选'}).click();
   await expect(no).toHaveValue('');
   await advanced.click();
  }else{
   await expect(no).toBeVisible();
   await expect(advanced).toBeHidden();
  }
  await expect(item).toHaveCount(1);
  if(width===360){
   const box=(await item.boundingBox())!;
   const bounds=(await region.boundingBox())!;
   expect(box.x).toBeGreaterThanOrEqual(bounds.x);
   expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width);
   expect(box.y+box.height).toBeLessThanOrEqual(800);
   await touchSize(item,44);
  }
  await page.screenshot({path:evidence+'-documents-'+width+'.png'});
  await item.click();
  const preview=page.getByRole('region',{name:'V2单据打印预览'});
  const title=preview.getByRole('heading',{name:'单据预览 · 销售发货码单',exact:true});
  const sheet=preview.getByRole('region',{name:'单据纸面'});
  await expect(sheet).toBeVisible();
  if(width===360){
   await expect(title).toBeInViewport();
   await expect(preview.getByText('左右滑动查看整张单据')).toBeVisible();
   expect(await sheet.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   await touchSize(preview.getByRole('button',{name:'浏览器打印'}),44);
  }else await expect(title).toBeHidden();
  await page.screenshot({path:evidence+'-preview-'+width+'.png'});
  await page.emulateMedia({media:'print'});
  await expect(title).toBeHidden();
  await expect(sheet.locator('[data-v2-print-sheet] h2')).toHaveText('销售发货码单');
  await page.emulateMedia({media:'screen'});
  await preview.getByRole('button',{name:'返回查询'}).click();
  await expect(item).toBeVisible();
 });
}

test('phone keeps long names compact and exposes full values in the existing details',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.goto('/tools/ui-preview/entries/ui-ux-scan-selection.html?directory');
 const customer='非常长的客户公司名称用于验证手机选样显示'.repeat(8).slice(0,160);
 const contact='很长的客户联系人名称用于验证手机显示'.repeat(7).slice(0,110);
 await page.evaluate(({customer,contact})=>{
  Object.assign((window as any).scanSelectionFixture.groups[0].session,{customerReference:customer,contactName:contact});
 },{customer,contact});
 await page.getByRole('button',{name:'搜索选样单',exact:true}).click();
 await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill(customer.slice(0,12));
 const row=page.getByRole('article').first();
 const name=row.getByRole('button',{name:'选样明细 '+customer+' '+contact,exact:true});
 for(const text of [name.getByText(customer,{exact:true}),row.getByText(contact,{exact:true})]){
  await expect(text).toBeVisible();
  await expect(text).toHaveCSS('-webkit-line-clamp','2');
  expect(await text.evaluate(el=>el.clientHeight)).toBeLessThanOrEqual(34);
 }
 await expect(row.getByRole('button',{name:/^导出 Excel/})).toBeInViewport();
 await expect(row.getByRole('button',{name:/^选样单更多操作/})).toBeInViewport();
 await page.screenshot({path:evidence+'-samples-360.png'});
 await name.click();
 const title=page.getByRole('heading',{name:customer+' · 选样'});
 for(const text of [title,page.getByText('联系人 · '+contact,{exact:true})]){
  await expect(text).toBeVisible();
  expect(await text.evaluate(el=>el.scrollWidth<=el.clientWidth&&el.scrollHeight<=el.clientHeight&&getComputedStyle(el).whiteSpace==='normal')).toBe(true);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 await page.screenshot({path:evidence+'-sample-detail-360.png'});
});

test('phone libraries keep primary touches usable and show a swipe hint on wide tables',async({page})=>{
 test.setTimeout(120_000);
 await page.setViewportSize({width:360,height:800});
 await page.goto(entry+'patterns.html?dimensions',{waitUntil:'domcontentloaded'});
 const patterns=page.getByRole('table',{name:'花型母版列表'});
 const firstPattern=patterns.getByRole('row').filter({has:page.getByRole('button',{name:/^编辑花型及配色/})}).first();
 await expect(firstPattern).toBeVisible();
 await touchSize(page.getByRole('button',{name:'新增花型',exact:true}),44);
 await touchSize(firstPattern.getByRole('button',{name:/^编辑花型及配色/}),44);
 await touchSize(firstPattern.getByRole('button',{name:/^查看 .* 关联产品/}),44);
 expect(await patterns.evaluate(table=>table.scrollWidth)).toBeLessThanOrEqual(await patterns.evaluate(table=>table.clientWidth)+1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 await page.screenshot({path:evidence+'-patterns-360.png'});
 for(const [key,url,button] of [
  ['fabrics',entry+'fabrics.html','列设置'],
  ['products',entry+'fabrics.html?products=1','列设置']
 ]){
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await expect(page.getByText('左右滑动查看全部字段',{exact:true})).toBeVisible();
  await touchSize(page.getByRole('button',{name:button,exact:true}),44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({path:evidence+'-'+key+'-360.png'});
 }
 await page.route('https://fabric-related-fixture.invalid/**',route=>route.fulfill({
  contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="navy"/></svg>'
 }));
 for(const width of [360,1440]){
  await page.setViewportSize({width,height:800});
  const minimum=width===360?44:40;
  await page.goto(entry+'fabrics.html?products=1&linkedImages=1',{waitUntil:'domcontentloaded'});
  const image=page.getByRole('button',{name:/^查看花型原图/}).first();
  await image.click();
  const original=page.getByRole('dialog',{name:/^花型原图/});
  await expect(original.getByRole('img')).toBeVisible();
  await touchSize(original.getByRole('button',{name:'关闭图片预览'}),minimum);
  await page.screenshot({path:evidence+'-product-dialog-'+width+'.png'});
  await page.keyboard.press('Escape');
  await expect(image).toBeFocused();
  await page.goto(entry+'cards.html',{waitUntil:'domcontentloaded'});
  const qr=page.getByRole('button',{name:/^放大色卡二维码/}).first();
  await touchSize(qr,minimum);
  await page.screenshot({path:evidence+'-cards-'+width+'.png'});
  await qr.click();
  await touchSize(page.getByRole('button',{name:'关闭二维码'}),minimum);
  await page.screenshot({path:evidence+'-card-dialog-'+width+'.png'});
  await page.keyboard.press('Escape');
  await expect(qr).toBeFocused();
 }
});

test('dashboard date actions fit both viewports and meet the button size rules',async({page})=>{
 for(const width of [360,1440]){
  await page.setViewportSize({width,height:800});
  await page.goto(entry+'chrome.html?stats');
  await expect(page.getByRole('region',{name:'核心经营指标'})).toBeVisible();
  const minimum=width===360?44:40;
  for(const name of ['近 7 天','近 30 天','本月','全部','查询统计','重置']){
   await touchSize(page.getByRole('button',{name,exact:true}),minimum);
  }
  const recent=page.getByRole('button',{name:'近 7 天'});
  await recent.click();
  await expect(recent).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'重置'}).click();
  await expect(page.getByRole('button',{name:'全部',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:evidence+'-dashboard-'+width+'.png'});
 }
});

test('phone preview exposes the paper type for samples, sales and deposits',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 for(const [type,title] of [['sample','样布码单'],['bulk','销售发货码单'],['deposit','定金单']]){
  await page.goto(entry+'chrome.html?documents&type='+type);
  await page.getByRole('button',{name:'预览 / Excel',exact:true}).click();
  await expect(page.getByRole('heading',{name:'单据预览 · '+title})).toBeInViewport();
  const sheet=page.getByRole('region',{name:'单据纸面'});
  await expect(sheet.locator('[data-v2-print-sheet] h2')).toHaveText(title);
  await sheet.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(()=>sheet.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 }
});
