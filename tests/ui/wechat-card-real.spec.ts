import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const path='/tools/ui-preview/entries/ui-ux-wechat-review.html';
test('WeChat-like 390px mobile gallery keeps all content and image actions within viewport',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50'});
 const page=await context.newPage();
 await page.goto(path,{waitUntil:'domcontentloaded'});
 const gallery=page.getByRole('main',{name:'色卡花型产品公开展示'});
 await expect(gallery).toBeVisible();
 await expect(page.getByRole('heading',{name:'G0886-F018'})).toBeVisible();
 await expect(gallery.locator('article')).toHaveCount(3);
 const widths=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 expect(widths.scroll).toBeLessThanOrEqual(widths.client+1);
 await expect(page.getByRole('link',{name:'配色 3'})).toHaveCSS('min-height','44px');
 await page.getByRole('link',{name:'配色 3'}).tap();
 expect(new URL(page.url()).hash).toBe('#colorway-3');
 const firstImg=page.locator('img').first();
 await expect(firstImg).toHaveAttribute('loading','eager');
 await expect(firstImg).toHaveAttribute('fetchPriority','high');
 const images=page.locator('img');
 await expect(images.nth(1)).toHaveAttribute('loading','lazy');
 await mkdir('artifacts/ui-ux-pilot',{recursive:true});
 await page.screenshot({path:'artifacts/ui-ux-pilot/wechat-390-real-component.png',fullPage:true});
 const trigger=page.getByRole('button',{name:/查看大图 G0886-1-F018 面料大图 1/});
 await trigger.tap();
 const dialog=page.getByRole('dialog',{name:/G0886-1-F018 面料大图 1大图/});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'关闭大图'})).toHaveCount(0);
 await dialog.getByRole('button',{name:'点击图片返回 G0886-1-F018 面料大图 1'}).tap();
 await expect(dialog).toBeHidden();
 await context.close();
});
test('375px and 430px H5 browser layouts have no horizontal document overflow or internal controls',async({browser})=>{
 for(const width of [375,430]){
  const page=await browser.newPage({viewport:{width,height:812},hasTouch:true,isMobile:true});
  await page.goto(path,{waitUntil:'domcontentloaded'});
  const state=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  expect(state.scroll).toBeLessThanOrEqual(state.client+1);
  await expect(page.getByRole('button',{name:/编辑|删除|下单|内部选样/})).toHaveCount(0);
  await page.close();
 }
});