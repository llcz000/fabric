import {test,expect} from '@playwright/test';
import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';

const assets=path.resolve('artifacts/ui-ux-pilot/fixture-media');
const selected={b:'fabric-a.webp',c:'fabric-b.webp',d:'detail.webp',e:'look.webp'} as const;
const all=Object.values(selected).map(f=>path.join(assets,f));
const token='a'.repeat(43);
const ref=(id:string)=>({previewRef:'display:'+id.repeat(43)});
test('local real G0626 textile imagery: mobile renders actual fabric/detail/look photos with readable sizing and zoom',async({browser})=>{
 test.skip(!all.every(existsSync),'Local authorized image fixtures not present on this machine; never download production media');
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const page=await context.newPage();
 const requests:string[]=[];
 await page.route('https://**',route=>route.abort());
 const fixture={available:true,card:{
  cardNo:'G0626-F018',fabricNo:'F018',fabricName:'轻薄雪纺',composition:'聚酯纤维 100%',
  weightValue:75,weightUnit:'gsm',widthCm:145,
  colorways:[{colorwayNo:1,productNo:'G0626-1-F018',displayImages:[ref('b'),ref('c')],detailImages:[ref('d')],effectImages:[ref('e')]}]
 }};
 await page.route('**/api/public/cards/'+token,route=>route.fulfill({json:fixture,status:200,headers:{'Cache-Control':'no-store'}}));
 await page.route('**/api/public/cards/'+token+'/images/*',async route=>{
  requests.push(route.request().url());
  const id=new URL(route.request().url()).pathname.split('/').at(-1)?.charAt(0) as keyof typeof selected|undefined;
  const file=id?selected[id]:undefined;
  if(!file){await route.fulfill({status:404,body:'Unavailable'});return;}
  const buf=await readFile(path.join(assets,file));
  await route.fulfill({status:200,contentType:'image/webp',body:buf,headers:{'Cache-Control':'no-store'}});
 });
 await page.goto('/ui-ux-wechat-route.html',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'G0626-F018'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'G0626-1-F018'})).toBeVisible();
 const first=page.locator('img').first();
 await expect(first).toHaveJSProperty('naturalWidth',720);
 await expect(first).toHaveJSProperty('naturalHeight',960);
 await page.getByRole('button',{name:'查看大图 G0626-1-F018 效果图 1'}).scrollIntoViewIfNeeded();
 await expect(page.getByRole('button',{name:'查看大图 G0626-1-F018 效果图 1'}).locator('img')).toHaveJSProperty('naturalWidth',720);
 await page.screenshot({path:'artifacts/ui-ux-pilot/wechat-real-fabric-g0626-mobile.png',fullPage:true});
 const before=await page.locator('img').count();
 await page.getByRole('button',{name:'查看大图 G0626-1-F018 效果图 1'}).tap();
 const dialog=page.getByRole('dialog',{name:'G0626-1-F018 效果图 1大图'});
 await expect(dialog).toBeVisible();
 await page.screenshot({path:'artifacts/ui-ux-pilot/wechat-real-fabric-g0626-zoom.png'});
 await dialog.getByRole('button',{name:'点击图片返回 G0626-1-F018 效果图 1'}).tap();
 await expect(dialog).toBeHidden();
 expect(before).toBe(4);
 expect(requests.length).toBeGreaterThanOrEqual(4);
 expect(requests.every(url=>url.startsWith('http://127.0.0.1:52992/api/public/cards/'+token+'/images/'))).toBe(true);
 const bytes=await Promise.all(all.map(f=>stat(f)));
 expect(bytes.every(b=>b.size<150_000)).toBe(true);
 await context.close();
});