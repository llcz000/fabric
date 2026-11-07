// AC-127 / DOC-01
import {test,expect} from '@playwright/test';
const entry='/tools/ui-preview/entries/ui-ux-internal-chrome.html?documents';

test('document deletion needs one confirmation without retyping the number, at desktop and 360px',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});await page.goto(entry);
  const remove=page.getByRole('button',{name:'确认删除',exact:true});await remove.click();
  const dialog=page.getByRole('dialog',{name:'确认删除单据'});
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('XS20261029-047');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:'取消',exact:true})).toBeFocused();
  expect(await page.evaluate(()=>(window as any).documentQa.deletes)).toBe(0);
  await page.screenshot({path:`artifacts/document-delete/confirmation-${width}.png`});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();expect(await page.evaluate(()=>(window as any).documentQa.deletes)).toBe(0);
  await remove.click();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(remove).toBeFocused();
  await remove.click();await dialog.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(page.getByText('没有符合条件的单据，可清除筛选后重试。')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).documentQa.deletes)).toBe(1);
 }
});

test('failed deletion keeps the document and allows retry without typing its number',async({page})=>{
 await page.goto(entry);await page.evaluate(()=>{(window as any).documentQa.fail=true;});
 await page.getByRole('button',{name:'确认删除',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'确认删除单据'});
 await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('保存失败');
 expect(await page.evaluate(()=>(window as any).documentQa.deleted)).toBe(false);
 await page.evaluate(()=>{(window as any).documentQa.fail=false;});
 await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).documentQa.deletes)).toBe(2);
});
