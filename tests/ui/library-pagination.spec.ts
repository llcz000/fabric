// AC-09
import {test,expect} from '@playwright/test';

const entries='/tools/ui-preview/entries/';
const cases=[
 {name:'面料',file:'fabric',entry:'ui-ux-internal-fabrics.html?pagination=1',pages:3,
  rows:'tbody tr',lastCount:2,lastRow:'P098'},
 {name:'产品',file:'product',entry:'ui-ux-internal-fabrics.html?products=1&sorting=1',pages:3,
  rows:'tbody tr',lastCount:44},
 {name:'色卡',file:'card',entry:'ui-ux-internal-cards.html?sorting=1',pages:2,
  rows:'tbody tr',lastCount:22},
 {name:'模特',file:'model',entry:'ui-ux-model-gallery.html?pagination=1',pages:3,
  rows:'article',lastCount:2,lastRow:'M00101'},
];

for(const library of cases){
 test(library.name+'库顶部和底部均可直接跳页',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fabric-model-preview.invalid/**',route=>route.fulfill({
   contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#e2ded9"/></svg>'
  }));
  await page.goto(entries+library.entry);
  const top=page.getByRole('navigation',{name:library.name+'列表顶部分页',exact:true});
  const bottom=page.getByRole('navigation',{name:library.name+'分页',exact:true});
  const rows=page.locator(library.rows);
  await expect(rows).toHaveCount(50);
  await expect(top).toContainText('第 1 / '+library.pages+' 页');
  await expect(bottom).toContainText('第 1 / '+library.pages+' 页');
  const first=(await rows.first().textContent())??'';
  await page.screenshot({path:'artifacts/library-pagination/'+library.file+'-1440.png'});

  await page.setViewportSize({width:360,height:800});
  await expect(top.getByRole('textbox',{name:'目标页码'})).toBeVisible();
  await page.screenshot({path:'artifacts/library-pagination/'+library.file+'-360.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const jump=top.getByRole('button',{name:'跳转'});
  expect((await jump.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await top.getByRole('textbox',{name:'目标页码'}).fill(String(library.pages));
  await jump.click();
  await expect(rows).toHaveCount(library.lastCount);
  if(library.lastRow)await expect(rows.first()).toContainText(library.lastRow);
  await expect(top).toContainText('第 '+library.pages+' / '+library.pages+' 页');
  await expect(bottom.getByRole('button',{name:'下一页'})).toBeDisabled();
  await bottom.scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/library-pagination/'+library.file+'-bottom-360.png'});
  await bottom.getByRole('textbox',{name:'目标页码'}).fill('1');
  await bottom.getByRole('textbox',{name:'目标页码'}).press('Enter');
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toHaveText(first,{ignoreCase:false});
  await expect(top).toContainText('第 1 / '+library.pages+' 页');
  await expect(bottom.getByRole('button',{name:'上一页'})).toBeDisabled();
  expect(errors).toEqual([]);
 });
}
