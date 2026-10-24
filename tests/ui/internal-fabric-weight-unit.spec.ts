import {test,expect} from '@playwright/test';

test('weight unit and number remain fully visible when editing at desktop and narrow widths',async({page})=>{
 for(const viewport of [1440,1100,390]){
  await page.setViewportSize({width:viewport,height:900});
  await page.goto('/ui-ux-internal-fabrics.html',{waitUntil:'domcontentloaded'});
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button',{name:'编辑'}).first().click();
  const row=page.locator('tbody tr').first();
  const weightCell=row.locator('td').nth(3);
  const input=row.getByRole('textbox',{name:'克重数值'});
  const select=row.getByRole('combobox',{name:'克重单位'});
  await expect(input).toHaveValue('80');
  await expect(select).toHaveValue('gsm');
  await expect(select.locator('option')).toHaveText(['—','gsm','mm']);
  const rects=await weightCell.evaluate(cell=>{
   const input=cell.querySelector('input'),select=cell.querySelector('select');
   if(!input||!select)throw Error('Missing weight editors');
   const a=cell.getBoundingClientRect(),i=input.getBoundingClientRect(),s=select.getBoundingClientRect();
   return {cell:{left:a.left,right:a.right,width:a.width},input:{left:i.left,right:i.right,width:i.width},
    select:{left:s.left,right:s.right,width:s.width}};
  });
  expect(rects.cell.width).toBeGreaterThanOrEqual(185);
  expect(rects.input.width).toBeGreaterThanOrEqual(69);
  expect(rects.select.width).toBeGreaterThanOrEqual(86);
  expect(rects.input.left).toBeGreaterThanOrEqual(rects.cell.left+1);
  expect(rects.select.left-rects.input.right).toBeGreaterThanOrEqual(5);
  expect(rects.select.right).toBeLessThanOrEqual(rects.cell.right-1);
  await select.scrollIntoViewIfNeeded();
  await expect(select).toBeVisible();
  await select.selectOption('mm');
  await expect(select).toHaveValue('mm');
  await select.selectOption('gsm');
  await expect(select).toHaveValue('gsm');
  await expect(input).toHaveValue('80');
  if(viewport===1440)await page.screenshot({path:'artifacts/ui-ux-pilot/fabric-library-weight-unit-fixed-desktop.png',fullPage:true});
  if(viewport===390){
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
   await page.screenshot({path:'artifacts/ui-ux-pilot/fabric-library-weight-unit-fixed-mobile.png',fullPage:true});
  }
 }
});

test('existing mm, unset weight and default create gsm retain their exact values',async({page})=>{
 await page.goto('/ui-ux-internal-fabrics.html',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'编辑'}).nth(1).click();
 const row=page.locator('tbody tr').nth(1);
 await expect(row.getByRole('textbox',{name:'克重数值'})).toHaveValue('16.5');
 await expect(row.getByRole('combobox',{name:'克重单位'})).toHaveValue('mm');
 await page.getByRole('button',{name:'取消',exact:true}).click();

 await expect(page.getByRole('checkbox',{name:'包含停用'})).toHaveCount(0);
 await expect(page.locator('tbody tr')).toHaveCount(3);
 await page.getByRole('button',{name:'编辑'}).nth(2).click();
 const blank=page.locator('tbody tr').nth(2);
 await expect(blank.getByRole('textbox',{name:'克重数值'})).toHaveValue('');
 await expect(blank.getByRole('combobox',{name:'克重单位'})).toHaveValue('');
 await page.getByRole('button',{name:'取消',exact:true}).click();

 await page.getByRole('button',{name:'新增面料'}).click();
 const created=page.locator('tbody tr').first();
 await expect(created.getByRole('textbox',{name:'克重数值'})).toHaveValue('');
 await expect(created.getByRole('combobox',{name:'克重单位'})).toHaveValue('gsm');
 await page.screenshot({path:'artifacts/ui-ux-pilot/fabric-library-weight-unit-fixed-new.png',fullPage:true});
});
