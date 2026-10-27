// AC-164
import {test,expect} from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
const entry='/tools/ui-preview/entries/ui-ux-scan-selection.html?directory';

test('customer name is the only details entry and supports keyboard without making the row clickable',async({page})=>{
 await page.setViewportSize({width:360,height:800});await page.goto(entry);
 const row=page.getByRole('article').first(),name=row.getByRole('button',{name:'选样明细 林女士',exact:true});
 await expect(name).toHaveText('林女士');await expect(row.getByRole('button',{name:'明细',exact:true})).toHaveCount(0);
 await row.locator('time').click();await row.getByText('6 款 · 1 张色卡').click();await row.click({position:{x:1,y:1}});await expect(page.getByRole('region',{name:'客户选样明细'})).toHaveCount(0);
 await name.focus();await page.keyboard.press('Enter');await expect(page.getByRole('region',{name:'客户选样明细'})).toBeVisible();
 await expect(page.locator('[data-selection-item]')).toHaveCount(6);
 await page.getByRole('button',{name:'返回客户选样',exact:true}).click();await name.focus();await page.keyboard.press('Space');await expect(page.getByRole('region',{name:'客户选样明细'})).toBeVisible();
});

test('more closes on outside pointer, Escape, repeated toggle, switching records and entering details',async({page})=>{
 await page.goto(entry);await page.getByRole('button',{name:'新建选样单',exact:true}).click();await page.getByRole('button',{name:/林女士.*选择/}).click();await page.getByRole('button',{name:'完成选样'}).click();
 const rows=page.getByRole('article'),first=rows.nth(0),second=rows.nth(1),more=first.getByRole('button',{name:'选样单更多操作 林女士'}),other=second.getByRole('button',{name:'选样单更多操作 林女士'});
 const deletion=page.getByRole('button',{name:'删除选样单',exact:true});
 await more.click();await expect(deletion).toBeVisible();await page.getByRole('heading',{name:'客户选样',exact:true}).click();await expect(deletion).toHaveCount(0);await expect(more).toHaveAttribute('aria-expanded','false');
 await more.click();await page.keyboard.press('Escape');await expect(deletion).toHaveCount(0);await expect(more).toBeFocused();
 await page.keyboard.press('Space');await expect(deletion).toBeVisible();await more.click();await expect(deletion).toHaveCount(0);
 await more.click();await other.click();await expect(more).toHaveAttribute('aria-expanded','false');await expect(other).toHaveAttribute('aria-expanded','true');await expect(deletion).toHaveCount(1);
 await first.getByRole('button',{name:'选样明细 林女士'}).click();await expect(page.getByRole('region',{name:'客户选样明细'})).toBeVisible();await expect(deletion).toHaveCount(0);
 await page.getByRole('button',{name:'返回客户选样',exact:true}).click();await expect(rows).toHaveCount(2);await expect(deletion).toHaveCount(0);
});

test('delete closes more before confirmation, cancel and failure preserve the order, success removes it',async({page})=>{
 await page.goto(entry);const row=page.getByRole('article').first(),more=row.getByRole('button',{name:'选样单更多操作 林女士'}),deletion=page.getByRole('button',{name:'删除选样单',exact:true});
 await more.click();await deletion.click();const dialog=page.getByRole('alertdialog',{name:'删除选样单？'});await expect(dialog).toBeVisible();await expect(deletion).toHaveCount(0);await expect(dialog).toContainText('林女士 · 2026-10-25');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(more).toBeFocused();await expect(row).toBeVisible();expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length)).toBe(0);
 await more.click();await deletion.click();await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(more).toBeFocused();await expect(deletion).toHaveCount(0);
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failNext=true;});await more.click();await deletion.click();await dialog.getByRole('button',{name:'确认删除'}).click();await expect(page.getByRole('alert')).toContainText('删除未确认');await expect(row).toBeVisible();await expect(deletion).toHaveCount(0);
 await more.click();await deletion.click();await dialog.getByRole('button',{name:'确认删除'}).click();await expect(page.getByRole('article')).toHaveCount(0);await expect(page.getByText('暂无选样单，点击新建开始选样')).toBeVisible();await expect(deletion).toHaveCount(0);
});

test('long names stay single-line with separate touch targets and read-only records keep the name entry',async({page})=>{
 for(const width of [360,1440]){
  await page.setViewportSize({width,height:800});await page.goto(entry);
  await page.evaluate(()=>{const group=(window as any).scanSelectionFixture.groups[0];group.session.customerReference='超长客户名称用于确认手机单行完整名称可访问';});
  await page.getByRole('button',{name:'搜索选样单',exact:true}).click();await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('超长');
  const row=page.getByRole('article').first(),name=row.getByRole('button',{name:/^选样明细 超长/});await expect(name).toBeVisible();await expect(name).toHaveAttribute('title','超长客户名称用于确认手机单行完整名称可访问');
  const boxes=await Promise.all([name,row.locator('time'),row.getByText('6 款 · 1 张色卡'),row.getByRole('button',{name:/^导出 Excel/}),row.getByRole('button',{name:/^选样单更多操作/})].map(el=>el.boundingBox()));
  for(const box of boxes){expect(box).not.toBeNull();expect(box!.y+box!.height/2).toBeCloseTo(boxes[0]!.y+boxes[0]!.height/2,0);}
  expect(boxes[0]!.height).toBeGreaterThanOrEqual(44);expect(boxes[0]!.width).toBeGreaterThanOrEqual(44);expect(boxes[0]!.x+boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x);
  expect(boxes[4]!.width).toBeGreaterThanOrEqual(44);expect(boxes[4]!.height).toBeGreaterThanOrEqual(44);
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(64);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:'artifacts/sample-directory/name-entry-'+width+'.png',fullPage:true});
  const more=row.getByRole('button',{name:/^选样单更多操作/});await more.click();await expect(page.getByRole('button',{name:'删除选样单',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/sample-directory/more-'+width+'.png',fullPage:true});await page.keyboard.press('Escape');
  await more.click();await page.getByRole('button',{name:'删除选样单',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.screenshot({path:'artifacts/sample-directory/delete-confirm-'+width+'.png',fullPage:true});await page.keyboard.press('Escape');
  await page.evaluate(()=>{(window as any).scanSelectionFixture.groups[0].session.canManage=false;});await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('超长客户');await expect(more).toHaveCount(0);await name.click();await expect(page.getByRole('region',{name:'客户选样明细'})).toBeVisible();await page.screenshot({path:'artifacts/sample-directory/name-details-'+width+'.png',fullPage:true});
 }
});
test.beforeEach(async({page})=>{page.on('pageerror',e=>{throw e;});});
test('compact directory uses one-line records, hides search until requested and has no manual refresh',async({page})=>{
 await page.setViewportSize({width:360,height:800});await page.goto(entry);
 await expect(page.getByRole('button',{name:'新建选样单',exact:true})).toBeVisible();
 await expect(page.getByRole('searchbox',{name:'搜索选样单客户'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'刷新列表',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'列表更多操作',exact:true})).toHaveCount(0);
 const first=page.getByRole('article').first();await expect(first).toContainText('林女士');await expect(first).toContainText('6 款');await expect(first).toContainText('1 张色卡');expect((await first.boundingBox())!.y).toBeLessThan(300);expect((await first.boundingBox())!.height).toBeLessThanOrEqual(64);
 await page.getByRole('button',{name:'搜索选样单',exact:true}).click();const input=page.getByRole('searchbox',{name:'搜索选样单客户'});await expect(input).toBeFocused();await input.fill('无此客户');await expect(page.getByText('没有匹配的选样单')).toBeVisible();await input.fill('林女士');await expect(first).toContainText('林女士');await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'搜索选样单',exact:true})).toBeFocused();
 
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
test('new selection combines customer lookup and name-only creation; repeat customer creates a separate dated order',async({page})=>{
 await page.goto(entry);await page.getByRole('button',{name:'新建选样单',exact:true}).click();
 await expect(page.getByRole('button',{name:'已有客户',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'快速建档',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/林女士.*选择/}).click();await expect(page.getByRole('button',{name:'继续扫码'})).toBeEnabled();await page.getByRole('button',{name:'完成选样'}).click();
 const orders=page.getByRole('article');await expect(orders).toHaveCount(2);await expect(orders.nth(0)).toContainText('林女士');await expect(orders.nth(1)).toContainText('林女士');
 await expect(orders.nth(0).locator('time')).toHaveText('2026-10-26');await expect(orders.nth(1).locator('time')).toHaveText('2026-10-25');
 await page.getByRole('button',{name:'新建选样单',exact:true}).click();const input=page.getByRole('searchbox',{name:'搜索选样客户'});await input.fill('新客户');await page.getByRole('button',{name:'新建客户“新客户”并选样'}).click();await expect(page.getByRole('heading',{name:'新客户',exact:true})).toBeVisible();
});
test('cancel and Escape keep customer creation unwritten and restore new button focus',async({page})=>{
 await page.goto(entry);const start=page.getByRole('button',{name:'新建选样单',exact:true});await start.click();await page.getByRole('searchbox',{name:'搜索选样客户'}).fill('不创建的客户');await page.keyboard.press('Escape');await expect(start).toBeFocused();expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length)).toBe(0);
});
test('export downloads one real six-column workbook from the current order; failure stays retryable',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-scan-selection.html');await page.getByRole('button',{name:/林女士.*选择/}).click();await expect(page.getByRole('checkbox')).toHaveCount(6);await page.getByRole('checkbox',{name:'配色 G0886-2',exact:true}).click();await page.getByRole('button',{name:'完成选样'}).click();
 const order=page.getByRole('article').first();const downloaded=page.waitForEvent('download');await order.getByRole('button',{name:/^导出 Excel 林女士$/}).click();const download=await downloaded;expect(download.suggestedFilename()).toMatch(/林女士_20261026_色卡\.xlsx$/);const path=await download.path();const wb=new ExcelJS.Workbook();await wb.xlsx.load(await fs.readFile(path!));expect(wb.worksheets[0].getRow(1).values).toEqual([undefined,'色卡编号','品名','成分','克重','门幅','二维码']);expect(wb.worksheets[0].rowCount).toBe(2);expect(wb.worksheets[0].getCell('A2').text).toBe('G0886-F018');
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failExport=true;});await order.getByRole('button',{name:/^导出 Excel 林女士$/}).click();await expect(page.getByRole('alert')).toContainText('导出失败');await expect(order.getByRole('button',{name:/^导出 Excel 林女士$/})).toBeEnabled();
});
test('desktop and narrow directory/customer picker have compact readable layouts',async({page})=>{
 for(const width of [360,1440]){await page.setViewportSize({width,height:800});await page.goto(entry);await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByRole('button',{name:'新建选样单',exact:true})).toBeEnabled();await page.screenshot({path:'artifacts/sample-directory/directory-'+width+'.png',fullPage:true});
 await page.getByRole('button',{name:'新建选样单',exact:true}).click();await expect(page.getByRole('button',{name:/林女士.*选择/})).toBeVisible();await page.screenshot({path:'artifacts/sample-directory/customer-'+width+'.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}
});

test('whitespace edits preserve an existing customer choice instead of offering only a new duplicate',async({page})=>{
 await page.goto(entry);await page.getByRole('button',{name:'新建选样单',exact:true}).click();const input=page.getByRole('searchbox',{name:'搜索选样客户'});await input.fill('林女士');await expect(page.getByRole('button',{name:/林女士.*选择/})).toBeVisible();await input.fill('林女士 ');await expect(page.getByRole('button',{name:/林女士.*选择/})).toBeVisible();
});
test('legacy pending creation keeps the application leave guard until the request resolves',async({page})=>{
 await page.goto(entry+'&legacy');await page.getByRole('button',{name:'新建选样单',exact:true}).click();await page.getByRole('textbox',{name:'客户名称',exact:true}).fill('旧模式客户');await page.evaluate(()=>{(window as any).scanSelectionFixture.state.deferLegacy=true;});await page.getByRole('button',{name:'新建选样',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.leaveGuard?.()??true)).toBe(false);
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.legacyRelease?.();});await expect(page.getByRole('button',{name:'继续扫码'})).toBeEnabled();
});

test('export permission loss clears the private directory without downloading a file',async({page})=>{
 await page.goto(entry);await expect(page.getByRole('article')).toHaveCount(1);await page.evaluate(()=>{const s=(window as any).scanSelectionFixture.state;s.deny=true;s.denyStatus=404;});await page.getByRole('button',{name:/^导出 Excel 林女士$/}).click();await expect(page.getByRole('alert')).toContainText('访问权限已失效');await expect(page.getByRole('article')).toHaveCount(0);await expect(page.getByText('林女士',{exact:true})).toHaveCount(0);
});
test('customer lookup errors cannot turn into name-only creation and can be retried',async({page})=>{
 await page.goto(entry);await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failCustomerSearch=true;});await page.getByRole('button',{name:'新建选样单',exact:true}).click();await page.getByRole('searchbox',{name:'搜索选样客户'}).fill('新客户');await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'新建客户“新客户”并选样'})).toHaveCount(0);await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.getByRole('button',{name:'新建客户“新客户”并选样'})).toBeVisible();
});
