import {test,expect} from '@playwright/test';
const entries=[
 {name:'products',url:'/tools/ui-preview/entries/ui-ux-internal-fabrics.html?products=1',region:'产品列表，可左右滚动查看全部字段'},
 {name:'cards',url:'/tools/ui-preview/entries/ui-ux-internal-cards.html',region:'色卡列表，可横向滚动'}
];
for(const entry of entries){
 test(entry.name+' action column scrolls with the table on mobile and stays sticky on desktop',async({page})=>{
  for(const width of [360,767,1440]){
   await page.setViewportSize({width,height:900});
   await page.goto(entry.url);
   const scroll=page.getByRole('region',{name:entry.region,exact:true});
   const cell=scroll.locator('tbody td.col-actions').first(),head=scroll.locator('thead th.col-actions').first();
   await expect(cell).toBeAttached();
   const expected=width<768?'static':'sticky';
   await expect(cell).toHaveCSS('position',expected);
   await expect(head).toHaveCSS('position',expected);
   const before=await cell.boundingBox(),bounds=await scroll.boundingBox();
   if(width===360){
    expect(before!.x).toBeGreaterThan(bounds!.x+bounds!.width-5);
    await page.screenshot({path:'artifacts/ui-ux-pilot/mobile-'+entry.name+'-start.png'});
   }
   await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
   await expect.poll(async()=>await cell.evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(bounds!.x+bounds!.width+1);
   if(width===360){
    const after=await cell.boundingBox();
    expect(before!.x-after!.x).toBeGreaterThan(100);
    await page.screenshot({path:'artifacts/ui-ux-pilot/mobile-'+entry.name+'-actions.png'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   }
  }
 });
}
