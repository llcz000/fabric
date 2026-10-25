import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const entry='/tools/ui-preview/entries/ui-ux-wechat-route.html';
const token='a'.repeat(43);
const ref=(char:string)=>'display:'+char.repeat(43);
const color=(no:number,product:string,displays:string[],details:string[],effects:string[])=>({
 colorwayNo:no,productNo:product,
 displayImages:displays.map(x=>({previewRef:ref(x)})),
 detailImages:details.map(x=>({previewRef:ref(x)})),
 effectImages:effects.map(x=>({previewRef:ref(x)}))
});
const fixture={available:true,card:{
 cardNo:'SC-G0886-F018',fabricNo:'F018',fabricName:'轻薄雪纺',composition:'聚酯纤维 100%',
 weightValue:80,weightUnit:'gsm',widthCm:145,colorways:[
  color(1,'G0886-1-F018',['b','c'],['d'],['e']),
  color(2,'G0886-2-F018',['f'],[],['g'])
 ]
}};
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="440" height="330"><rect width="440" height="330" fill="#d2a6a1"/><circle cx="160" cy="120" r="70" fill="#e6cbbb"/><path d="M0 200 Q120 80 200 220 T440 170" stroke="#8a9d83" stroke-width="35" fill="none"/><text x="220" y="309" text-anchor="middle" font-size="14">TEST FIXTURE • NOT REAL FABRIC</text></svg>';
const setup=async(page:Page,fn?:(request:{url:string;headers:Record<string,string>})=>void)=>{
 await page.route('**/api/public/cards/'+token,async route=>{
  fn?.({url:route.request().url(),headers:await route.request().allHeaders()});
  await route.fulfill({json:fixture,status:200,headers:{'Cache-Control':'no-store'}});
 });
 await page.route('**/api/public/cards/'+token+'/images/*',async route=>{
  await route.fulfill({status:200,contentType:'image/svg+xml',body:svg,headers:{'Cache-Control':'no-store'}});
 });
};
test('live frontend /c/ fetch path renders whitelisted DTO and authorized image paths without sending session cookies',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50'});
 await context.addCookies([{name:'internal_session',value:'test-only-do-not-use',url:'http://127.0.0.1:52992'}]);
 const page=await context.newPage();
 const observed:Array<{url:string;headers:Record<string,string>}>=[];
 await setup(page,v=>observed.push(v));
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'SC-G0886-F018'})).toBeVisible();
 await expect(page).toHaveTitle('SC-G0886-F018 · 轻薄雪纺｜面料花型展示');
 await expect(page.getByRole('button',{name:'刷新色卡产品'})).toHaveCount(0);
 const rows=await page.locator('dl > div').evaluateAll(els=>els.map(el=>Math.round(el.getBoundingClientRect().top)));
 expect(rows).toHaveLength(3);
 expect(new Set(rows).size).toBe(1);
 await expect(page.getByRole('heading',{name:'G0886-2-F018'})).toBeVisible();
 await expect(page.locator('article')).toHaveCount(2);
 expect(observed.length).toBeGreaterThan(0);
 expect(observed.every(x=>x.url.endsWith('/api/public/cards/'+token))).toBe(true);
 expect(observed.every(x=>!('cookie' in x.headers))).toBe(true);
 await expect(page.locator('img').first()).toHaveAttribute('loading','eager');
 const imageSrc=await page.locator('img').first().getAttribute('src');
 expect(imageSrc).toBe('/api/public/cards/'+token+'/images/'+'b'.repeat(43));
 const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
 expect(size.scroll).toBeLessThanOrEqual(size.client+1);
 await page.getByRole('link',{name:'配色 2'}).tap();
 expect(new URL(page.url()).hash).toBe('#colorway-2');
 await mkdir('artifacts/ui-ux-pilot',{recursive:true});
 await page.screenshot({path:'artifacts/ui-ux-pilot/wechat-real-frontend-api-mock.png',fullPage:true});
 const first=page.getByRole('button',{name:'查看大图 G0886-1-F018 面料大图 1'});
 await first.tap();
 const dialog=page.getByRole('dialog',{name:'G0886-1-F018 面料大图 1大图'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'关闭大图'})).toHaveCount(0);
 await dialog.getByRole('button',{name:'点击图片返回 G0886-1-F018 面料大图 1'}).tap();
 await expect(dialog).not.toBeVisible();
 await expect(first).toBeFocused();
 await first.tap();
 await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
 await context.close();
});
test('rejected or disabled card fails closed with no public product data',async({page})=>{
 await page.route('**/api/public/cards/'+token,route=>route.fulfill({status:404,json:{error:'Pattern unavailable'}}));
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'暂不可用'})).toBeVisible();
 await expect(page.locator('article')).toHaveCount(0);
 await expect(page.getByRole('heading',{name:/G0886/})).toHaveCount(0);
});
test('temporary public API failure shows retry and recovers to current publication',async({page})=>{
 let calls=0;
 await page.route('**/api/public/cards/'+token,async route=>{
  calls++;
  await route.fulfill(calls===1?{status:503,body:'Service unavailable'}:{status:200,json:fixture});
 });
 await page.route('**/api/public/cards/'+token+'/images/*',route=>route.fulfill({contentType:'image/svg+xml',body:svg}));
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('alert')).toContainText('资料暂不可用，请稍后重试');
 await expect(page.getByRole('button',{name:'刷新色卡产品'})).toHaveCount(0);
 await page.getByRole('button',{name:'重试加载'}).click();
 await expect(page.getByRole('heading',{name:'SC-G0886-F018'})).toBeVisible();
 expect(calls).toBeGreaterThanOrEqual(2);
});
test('failed image can retry exact authorized preview URL without losing colorway or changing token',async({page})=>{
 await page.route('**/api/public/cards/'+token,route=>route.fulfill({status:200,json:fixture}));
 let tries=0;
 await page.route('**/api/public/cards/'+token+'/images/*',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:svg}));
 await page.route('**/api/public/cards/'+token+'/images/'+'b'.repeat(43),async route=>{
  tries++;
  await route.fulfill(tries===1?{status:502,body:'gateway timeout'}:{status:200,contentType:'image/svg+xml',body:svg,headers:{'Cache-Control':'no-store'}});
 });
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('button',{name:'重新加载图片 G0886-1-F018 面料大图 1'})).toBeVisible();
 await page.getByRole('button',{name:'重新加载图片 G0886-1-F018 面料大图 1'}).click();
 await expect(page.getByRole('button',{name:'查看大图 G0886-1-F018 面料大图 1'})).toBeVisible();
 await expect(page.locator('img').first()).toHaveJSProperty('naturalWidth',440);
 expect(tries).toBe(2);
});
test('whitelist parser blocks unapproved extra fields instead of exposing internal data',async({page})=>{
 await page.route('**/api/public/cards/'+token,route=>route.fulfill({status:200,json:{
  available:true,card:{...fixture.card,internalCost:1337,customerPhone:'PRIVATE'}
 }}));
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('alert')).toContainText('资料暂不可用，请稍后重试');
 await expect(page.locator('article')).toHaveCount(0);
 await expect(page.getByText('PRIVATE')).toHaveCount(0);
});
test('slow mobile connection keeps a readable loading state then shows the latest colorways',async({page})=>{
 await page.route('**/api/public/cards/'+token,async route=>{
  await new Promise(resolve=>setTimeout(resolve,1100));
  await route.fulfill({status:200,json:fixture,headers:{'Cache-Control':'no-store'}});
 });
 await page.route('**/api/public/cards/'+token+'/images/*',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:svg}));
 await page.setViewportSize({width:375,height:812});
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('status',{name:''}).filter({hasText:'正在读取色卡产品'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'SC-G0886-F018'})).toBeVisible();
 await expect(page.locator('article')).toHaveCount(2);
});
test('permanently revoked image stays a safe retry prompt and never requests a different media path',async({page})=>{
 await page.route('**/api/public/cards/'+token,route=>route.fulfill({json:fixture}));
 const requested:string[]=[];
 await page.route('**/api/public/cards/'+token+'/images/*',async route=>{
  requested.push(new URL(route.request().url()).pathname);
  await route.fulfill({status:403,body:'Access denied',headers:{'Cache-Control':'no-store'}});
 });
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 const retry=page.getByRole('button',{name:'重新加载图片 G0886-1-F018 面料大图 1'});
 await expect(retry).toBeVisible();
 await retry.click();
 await expect(retry).toBeVisible();
 expect(requested.length).toBeGreaterThanOrEqual(2);
 expect(requested.every(x=>x.startsWith('/api/public/cards/'+token+'/images/'))).toBe(true);
 await expect(page.getByText(/private|internal_session|客户资料|成本/)).toHaveCount(0);
});
