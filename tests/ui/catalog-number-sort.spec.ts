// AC-150
import {test,expect} from '@playwright/test';

const products='/tools/ui-preview/entries/ui-ux-internal-fabrics.html?products=1&sorting=1';
const cards='/tools/ui-preview/entries/ui-ux-internal-cards.html?sorting=1';

test.beforeEach(async({page})=>{
 page.on('pageerror',error=>{throw error;});
});

test('product number sorts globally by master and numeric colorway, skips fabrics, resets pagination and clears',async({page})=>{
 await page.goto(products);
 const rows=page.locator('tbody tr'),numbers=rows.locator('td:nth-child(2)');
 await expect(rows).toHaveCount(50);
 await expect(numbers.first()).toHaveText('G8-2-F999');
 await page.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(numbers.first()).toHaveText('G11-10-F999');
 const header=page.getByRole('columnheader',{name:'货号',exact:true});
 await header.getByRole('button').click();
 await expect(header).toHaveAttribute('aria-sort','ascending');
 await expect(numbers.first()).toHaveText('G1-2-F999');
 expect(await numbers.allTextContents()).toEqual(expect.arrayContaining(['G1-2-F001','G1-10-F999','G1-10-F001']));
 const seen:string[]=[];
 for(let index=0;index<3;index++){
  await expect(rows).toHaveCount(index===2?44:50);
  seen.push(...await numbers.allTextContents());
  if(index<2)await page.getByRole('button',{name:'下一页',exact:true}).click();
 }
 expect(seen).toHaveLength(144);expect(new Set(seen).size).toBe(144);
 expect(seen.indexOf('G8-2-F999')).toBeLessThan(seen.indexOf('G15-2-F999'));
 expect(seen.indexOf('G15-2-F999')).toBeLessThan(seen.indexOf('G100-2-F999'));
 await header.getByRole('button').click();
 await expect(header).toHaveAttribute('aria-sort','descending');
 await expect(numbers.first()).toHaveText('G100-10-F001');
 await page.getByRole('textbox',{name:'货号',exact:true}).fill('G8-');
 await expect(rows).toHaveCount(4);
 await expect(numbers.first()).toHaveText('G8-10-F001');
 await header.getByRole('button').click();
 await expect(header).toHaveAttribute('aria-sort','none');
 await expect(numbers.first()).toHaveText('G8-2-F999');
 await page.screenshot({path:'artifacts/ui-ux-pilot/product-number-sort.png',fullPage:true});
});

test('card number sorts all pages by master while preserving separate complete fabric card numbers',async({page})=>{
 await page.goto(cards);
 const rows=page.locator('tbody tr'),numbers=rows.locator('[data-card-field="cardNo"] > div:first-child');
 await expect(rows).toHaveCount(50);
 await page.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(rows).toHaveCount(22);
 const header=page.getByRole('columnheader',{name:'色卡编号',exact:true});
 await header.getByRole('button').click();
 await expect(header).toHaveAttribute('aria-sort','ascending');
 await expect(rows).toHaveCount(50);
 await expect(numbers.first()).toHaveText('G1-F999');
 await expect(numbers.nth(1)).toHaveText('G1-F001');
 const seen=await numbers.allTextContents();
 await page.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(rows).toHaveCount(22);seen.push(...await numbers.allTextContents());
 expect(seen).toHaveLength(72);expect(new Set(seen).size).toBe(72);
 expect(seen.indexOf('G8-F999')).toBeLessThan(seen.indexOf('G15-F999'));
 expect(seen.indexOf('G15-F999')).toBeLessThan(seen.indexOf('G100-F999'));
 await header.getByRole('button').click();
 await expect(header).toHaveAttribute('aria-sort','descending');
 await expect(numbers.first()).toHaveText('G100-F001');
 await header.getByRole('button').click();
 await expect(header).toHaveAttribute('aria-sort','none');
 await expect(numbers.first()).toHaveText('G35-F001');
 await page.screenshot({path:'artifacts/ui-ux-pilot/card-number-sort.png',fullPage:true});
});

test('pattern number header sorts globally and resets a later page',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-patterns.html');
 const table=page.getByRole('table',{name:'花型母版列表'}),masters=table.locator('[role=cell]:first-child strong');
 const footer=page.getByRole('navigation',{name:'花型分页'});
 await expect(masters.first()).toHaveText('G0076');
 await footer.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(masters.first()).toHaveText('G0056');
 const header=table.getByRole('columnheader').first();
 await header.getByRole('button').click();
 await expect(header).toHaveAttribute('aria-sort','ascending');
 await expect(masters.first()).toHaveText('G0001');
 await expect(footer).toContainText('第 1 / 4 页');
 await footer.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(masters.first()).toHaveText('G0021');
 await header.getByRole('button').click();
 await expect(header).toHaveAttribute('aria-sort','descending');
 await expect(masters.first()).toHaveText('G0076');
 await page.screenshot({path:'artifacts/ui-ux-pilot/pattern-number-sort.png',fullPage:true});
});


test('360px number sorting remains reachable when color-card table headers are hidden',async({page})=>{
 await page.setViewportSize({width:360,height:900});await page.goto(cards);
 const sort=page.getByRole('button',{name:/^色卡编号排序/});await expect(sort).toBeVisible();expect((await sort.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await sort.click();await expect(page.locator('tbody tr').first().locator('[data-card-field="cardNo"]')).toContainText('G1-F999');await expect(sort).toHaveAttribute('aria-label','色卡编号排序：升序');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);await page.screenshot({path:'artifacts/catalog-customer-update/card-sort-360.png'});await sort.click();await expect(sort).toHaveAttribute('aria-label','色卡编号排序：降序');await sort.click();await expect(sort).toHaveAttribute('aria-label','色卡编号排序：默认');
 await page.goto(products);const header=page.getByRole('columnheader',{name:'货号',exact:true});await header.getByRole('button').click();await expect(page.locator('tbody tr td:nth-child(2)').first()).toHaveText('G1-2-F999');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);await page.screenshot({path:'artifacts/catalog-customer-update/product-sort-360.png'});
});
