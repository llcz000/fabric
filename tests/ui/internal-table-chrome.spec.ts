import {test,expect} from '@playwright/test';
const url='/tools/ui-preview/entries/ui-ux-internal-chrome.html';
test.beforeEach(async({page})=>{
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.evaluate(()=>localStorage.removeItem('fabric.ui.qa.columns'));
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'列设置组件 · 独立交互验收'})).toBeVisible();
});
test('shared column settings: keyboard escape closes and returns focus to trigger',async({page})=>{
 const trigger=page.getByRole('button',{name:'列设置'});
 await trigger.focus();await page.keyboard.press('Enter');
 await expect(trigger).toHaveAttribute('aria-expanded','true');
 const panel=page.getByRole('group',{name:'列显示设置'});
 await expect(panel).toBeVisible();
 await expect(trigger).toHaveAttribute('aria-controls',await panel.getAttribute('id')||'');
 const checkbox=panel.getByRole('checkbox',{name:'克重'});
 await checkbox.focus();await page.keyboard.press('Space');
 await expect(checkbox).not.toBeChecked();
 await expect(page.locator('table thead th')).toHaveCount(3);
 await page.keyboard.press('Escape');
 await expect(panel).toBeHidden();
 await expect(trigger).toHaveAttribute('aria-expanded','false');
 await expect(trigger).toBeFocused();
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.locator('table thead th')).toHaveCount(3);
 await trigger.click();
 await panel.getByRole('button',{name:'恢复默认列'}).click();
 await expect(page.locator('table thead th')).toHaveCount(4);
 await expect(trigger).toBeFocused();
 await expect(panel).toBeHidden();
});
test('shared column menu outside pointer click closes without stealing external focus',async({page})=>{
 const trigger=page.getByRole('button',{name:'列设置'});
 await trigger.click();
 await expect(page.getByRole('group',{name:'列显示设置'})).toBeVisible();
 await page.getByRole('button',{name:'页面其它操作'}).click();
 await expect(page.getByRole('group',{name:'列显示设置'})).toBeHidden();
 await expect(page.getByRole('button',{name:'页面其它操作'})).toBeFocused();
});
test('sortable headers retain asc desc reset order and visible columns',async({page})=>{
 const no=page.getByRole('button',{name:/品号/});
 await no.click();
 await expect(page.locator('tbody tr').first().locator('td').first()).toHaveText('A1');
 await no.click();
 await expect(page.locator('tbody tr').first().locator('td').first()).toHaveText('B2');
 await no.click();
 await expect(page.locator('tbody tr').first().locator('td').first()).toHaveText('B2');
 await expect(page.getByRole('columnheader',{name:'品号'})).toHaveAttribute('aria-sort','none');
});
