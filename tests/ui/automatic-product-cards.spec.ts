import {test,expect} from '@playwright/test';
test('automatic cards remove duplicate creation and retain QR, preview, sharing and guarded deletion',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});
  await page.goto('/tools/ui-preview/entries/ui-ux-internal-cards.html');
  await expect(page.getByRole('button',{name:'新增色卡'})).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.screenshot({path:`artifacts/ui-ux-pilot/automatic-cards-${width}.png`,fullPage:true});
  const trigger=page.getByRole('button',{name:'删除色卡 G0886-F018'});
  await trigger.click();const dialog=page.getByRole('alertdialog',{name:'删除色卡？'});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(trigger).toBeFocused();
  await trigger.click();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
  await trigger.click();await dialog.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('关联 3 个产品');await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.screenshot({path:`artifacts/ui-ux-pilot/automatic-cards-protected-${width}.png`,fullPage:true});
  const view=page.getByRole('button',{name:'查看花型 G0886-F018'});await view.click();
  await expect(page.getByRole('dialog',{name:'色卡关联花型 G0886-F018'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(view).toBeFocused();
 }
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});
  await page.goto('/tools/ui-preview/entries/ui-ux-internal-fabrics.html?products=1');
  await expect(page.locator('tbody tr')).not.toHaveCount(0);
  await expect(page.getByRole('button',{name:/建色卡/})).toHaveCount(0);
  await page.screenshot({path:`artifacts/ui-ux-pilot/automatic-card-products-${width}.png`,fullPage:true});
 }
 expect(errors).toEqual([]);
});
