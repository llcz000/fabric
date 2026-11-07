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

test('long customer and contact names remain readable with separate touch targets and read-only details',async({page})=>{
 for(const width of [360,1440]){
  await page.setViewportSize({width,height:800});await page.goto(entry);
  await page.evaluate(()=>{const group=(window as any).scanSelectionFixture.groups[0];group.session.customerReference='超长客户名称用于确认手机单行完整名称可访问';});
  await page.getByRole('button',{name:'搜索选样单',exact:true}).click();await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('超长');
  const row=page.getByRole('article').first(),name=row.getByRole('button',{name:/^选样明细 超长/});await expect(name).toBeVisible();await expect(name).toHaveAttribute('title','超长客户名称用于确认手机单行完整名称可访问');
  const boxes=await Promise.all([name,row.locator('time'),row.getByText('6 款 · 1 张色卡'),row.getByRole('button',{name:/^导出 Excel/}),row.getByRole('button',{name:/^选样单更多操作/})].map(el=>el.boundingBox()));
  for(const box of boxes){expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);}
  expect(boxes[0]!.height).toBeGreaterThanOrEqual(44);expect(boxes[0]!.width).toBeGreaterThanOrEqual(44);expect(boxes[0]!.x+boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x);
  expect(boxes[4]!.width).toBeGreaterThanOrEqual(44);expect(boxes[4]!.height).toBeGreaterThanOrEqual(44);
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(88);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:'artifacts/sample-directory/name-entry-'+width+'.png',fullPage:true});
  const more=row.getByRole('button',{name:/^选样单更多操作/});await more.click();await expect(page.getByRole('button',{name:'删除选样单',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/sample-directory/more-'+width+'.png',fullPage:true});await page.keyboard.press('Escape');
  await more.click();await page.getByRole('button',{name:'删除选样单',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.screenshot({path:'artifacts/sample-directory/delete-confirm-'+width+'.png',fullPage:true});await page.keyboard.press('Escape');
  await page.evaluate(()=>{(window as any).scanSelectionFixture.groups[0].session.canManage=false;});await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('超长客户');await expect(more).toHaveCount(0);await name.click();await expect(page.getByRole('region',{name:'客户选样明细'})).toBeVisible();await page.screenshot({path:'artifacts/sample-directory/name-details-'+width+'.png',fullPage:true});
 }
});
test.beforeEach(async({page})=>{page.on('pageerror',e=>{throw e;});});
test('compact directory keeps customer contacts visible, hides search until requested and has no manual refresh',async({page})=>{
 await page.setViewportSize({width:360,height:800});await page.goto(entry);
 await expect(page.getByRole('button',{name:'新建选样单',exact:true})).toBeVisible();
 await expect(page.getByRole('searchbox',{name:'搜索选样单客户'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'刷新列表',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'列表更多操作',exact:true})).toHaveCount(0);
 const first=page.getByRole('article').first();await expect(first).toContainText('林女士');await expect(first).toContainText('6 款');await expect(first).toContainText('1 张色卡');expect((await first.boundingBox())!.y).toBeLessThan(300);expect((await first.boundingBox())!.height).toBeLessThanOrEqual(88);
 await page.getByRole('button',{name:'搜索选样单',exact:true}).click();const input=page.getByRole('searchbox',{name:'搜索选样单客户'});await expect(input).toBeFocused();await input.fill('无此客户');await expect(page.getByText('没有匹配的选样单')).toBeVisible();await input.fill('林女士');await expect(first).toContainText('林女士');await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'搜索选样单',exact:true})).toBeFocused();
 
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
test('customer selection actions share the document-list button hierarchy at desktop and phone widths',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});await page.goto(entry);
  const minHeight=width===360?44:40;
  const primary=page.getByRole('button',{name:'新建选样单',exact:true}),multi=page.getByRole('button',{name:'多选',exact:true}),search=page.getByRole('button',{name:'搜索选样单',exact:true});
  await expect(primary).toHaveClass(/v2-business-button-primary/);await expect(multi).toHaveClass(/v2-business-button/);await expect(search).toHaveClass(/v2-business-icon-button/);
  expect(await primary.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(0, 83, 218)');expect(await multi.evaluate(el=>getComputedStyle(el).borderColor)).toBe('rgb(195, 198, 215)');
  const row=page.getByRole('article').first(),rowExport=row.getByRole('button',{name:/^导出 Excel/}),more=row.getByRole('button',{name:/^选样单更多操作/});
  await expect(rowExport).toHaveClass(/v2-business-button/);await expect(more).toHaveClass(/v2-business-icon-button/);
  for(const target of [primary,multi,search,rowExport,more]){const box=await target.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(minHeight);}
  const idleBackground=await multi.evaluate(el=>getComputedStyle(el).backgroundColor);await multi.click();await expect(multi).toHaveAttribute('aria-pressed','true');expect(await multi.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(idleBackground);
  await search.click();const searchCancel=page.getByRole('button',{name:'取消',exact:true});await expect(searchCancel).toHaveClass(/v2-business-button/);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();
  const panel=page.getByRole('region',{name:'客户选样明细'}),continueScan=page.getByRole('button',{name:'继续扫码',exact:true});
  const manual=panel.getByRole('button',{name:'人工补选',exact:true}),exportDetails=panel.getByRole('button',{name:'导出 Excel',exact:true});
  await expect(continueScan).toHaveClass(/v2-business-button-primary/);await expect(manual).toHaveClass(/v2-business-button/);await expect(exportDetails).toHaveClass(/v2-business-button/);
  await page.screenshot({path:'artifacts/sample-directory/button-hierarchy-details-'+width+'.png',fullPage:true});
  await continueScan.click();
  const scan=page.getByRole('region',{name:'扫码选样',exact:true}),look=scan.getByRole('button',{name:'看图选款',exact:true}),camera=scan.getByRole('button',{name:'继续扫码',exact:true});
  await expect(look).toHaveClass(/v2-business-button/);await expect(camera).toHaveClass(/v2-business-button-primary/);await expect(scan.getByRole('button',{name:'完成选样',exact:true})).toHaveClass(/v2-business-button/);
  await look.click();const dialog=page.getByRole('dialog',{name:'人工补选'}),selectAll=dialog.getByRole('button',{name:'全选本卡 G0626-F018',exact:true}),add=dialog.getByRole('button',{name:'加入色卡 G0626-F018',exact:true});
  await expect(selectAll).toHaveClass(/v2-business-button/);await expect(add).toHaveClass(/v2-business-button-primary/);
  await page.screenshot({path:'artifacts/sample-directory/button-hierarchy-manual-'+width+'.png',fullPage:true});
  await page.keyboard.press('Escape');await expect(look).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
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
test('export downloads one real ten-column selection workbook from the current order; failure stays retryable',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-scan-selection.html');await page.getByRole('button',{name:/林女士.*选择/}).click();await expect(page.getByRole('checkbox')).toHaveCount(6);await page.getByRole('checkbox',{name:'配色 G0886-2',exact:true}).click();await page.getByRole('button',{name:'完成选样'}).click();
 const order=page.getByRole('article').first();const downloaded=page.waitForEvent('download');await order.getByRole('button',{name:/^导出 Excel 林女士$/}).click();const download=await downloaded;const exportToast=page.getByRole('region',{name:'操作提示'}).getByRole('status').filter({hasText:'Excel 已导出'});await expect(exportToast).toBeVisible();await expect(page.getByRole('region',{name:'客户选样'}).getByText('Excel 已导出',{exact:true})).toHaveCount(0);await expect(exportToast).toHaveCount(0,{timeout:5200});expect(download.suggestedFilename()).toMatch(/林女士_20261026_色卡\.xlsx$/);const path=await download.path();const wb=new ExcelJS.Workbook();await wb.xlsx.load(await fs.readFile(path!));expect(wb.worksheets[0].getRow(1).values).toEqual([undefined,'色卡编号','品名','成分','克重','门幅','二维码','选样单号','客户','联系人','选样日期']);expect(wb.worksheets[0].rowCount).toBe(2);expect(wb.worksheets[0].getCell('A2').text).toBe('G0886-F018');
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

test('details export the whole current order using the same ten-column selection workbook at desktop and phone sizes',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});await page.goto(entry);
  await page.evaluate(()=>{const f=(window as any).scanSelectionFixture;f.state.known.add('13');f.state.selected.add('200');});
  await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();const panel=page.getByRole('region',{name:'客户选样明细'});
  await expect(panel.getByText('G0886-1',{exact:true})).toBeVisible();await expect(panel.getByText('G0886-1-F018',{exact:true})).toHaveCount(0);await expect(panel.locator('[title="G0886-1-F018"]')).toHaveCount(0);
  await panel.locator('[data-selection-item]').first().check();const exported=page.waitForEvent('download');await panel.getByRole('button',{name:'导出 Excel',exact:true}).click();const download=await exported;const exportToast=page.getByRole('region',{name:'操作提示'}).getByRole('status').filter({hasText:'Excel 已导出'});await expect(exportToast).toBeVisible();await expect(panel.getByText('Excel 已导出',{exact:true})).toHaveCount(0);if(width===1440)await expect(exportToast).toHaveCount(0,{timeout:5200});expect(download.suggestedFilename()).toBe('林女士_20261025_色卡.xlsx');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await fs.readFile((await download.path())!));const sheet=workbook.worksheets[0];expect(sheet.getRow(1).values).toEqual([undefined,'色卡编号','品名','成分','克重','门幅','二维码','选样单号','客户','联系人','选样日期']);expect(sheet.rowCount).toBe(3);expect([sheet.getCell('A2').text,sheet.getCell('A3').text]).toEqual(['G0886-F018','G0626-F018']);
  await expect(panel.locator('[data-selection-item]').first()).toBeChecked();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:'artifacts/selection-details/details-'+width+'.png',fullPage:true});
 }
});
test('details export failures retain choices and retry; permission loss clears the private details',async({page})=>{
 await page.goto(entry);await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();const panel=page.getByRole('region',{name:'客户选样明细'}),button=panel.getByRole('button',{name:'导出 Excel',exact:true});await panel.locator('[data-selection-item]').first().check();
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failExport=true;});await button.click();await expect(panel.getByRole('alert')).toContainText('导出失败');await expect(button).toBeEnabled();await expect(panel.locator('[data-selection-item]').first()).toBeChecked();const next=page.waitForEvent('download');await button.click();await next;
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.deny=true;});await button.click();await expect(page.getByRole('alert')).toContainText('访问权限已失效');await expect(page.locator('[data-selection-item]')).toHaveCount(0);await expect(page.getByRole('heading',{name:'林女士 · 选样'})).toHaveCount(0);
});
test('read-only details keep Excel export available and empty details disable it',async({page})=>{
 await page.goto(entry);await page.evaluate(()=>{(window as any).scanSelectionFixture.groups[0].session.canManage=false;});await page.getByRole('button',{name:'搜索选样单',exact:true}).click();await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('林');await expect(page.getByRole('button',{name:'选样单更多操作 林女士'})).toHaveCount(0);await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();let panel=page.getByRole('region',{name:'客户选样明细'});await expect(panel.getByRole('button',{name:'导出 Excel',exact:true})).toBeEnabled();await expect(panel.locator('[data-selection-item]')).toHaveCount(0);
 await page.goto(entry);await page.evaluate(()=>{(window as any).scanSelectionFixture.state.selected.clear();});await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();panel=page.getByRole('region',{name:'客户选样明细'});await expect(panel.getByRole('button',{name:'导出 Excel',exact:true})).toBeDisabled();
});

test('pattern-based removal confirmation cancels without writes and restores focus at both widths',async({page})=>{
 for(const width of [1440,360]){await page.setViewportSize({width,height:900});await page.goto(entry);await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();const panel=page.getByRole('region',{name:'客户选样明细'}),choice=panel.locator('[data-selection-item]').first();await choice.check();const before=await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length),remove=panel.getByRole('button',{name:/^移除所选/});await remove.click();await expect(page.getByRole('alertdialog',{name:'从本次选样移除所选配色？'})).toBeVisible();await page.screenshot({path:'artifacts/selection-details/remove-confirm-'+width+'.png'});await page.keyboard.press('Escape');await expect(remove).toBeFocused();await expect(choice).toBeChecked();expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length)).toBe(before);}
});


test('historical customer selections can be deleted while details stay read-only, with cancel and retry at both widths',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});await page.goto(entry);
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.evaluate(()=>{const s=(window as any).scanSelectionFixture.groups[0].session;s.canManage=false;s.canDelete=true;s.customerReference='历史选样';});
  await page.getByRole('button',{name:'搜索选样单',exact:true}).click();await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('历史');await expect(page.getByRole('button',{name:'选样明细 历史选样',exact:true})).toBeVisible();
  const more=page.getByRole('button',{name:'选样单更多操作 历史选样',exact:true});await expect(more).toBeVisible();
  await page.getByRole('button',{name:'选样明细 历史选样',exact:true}).click();const panel=page.getByRole('region',{name:'客户选样明细'});
  await expect(panel.locator('[data-selection-item]')).toHaveCount(0);await expect(panel.getByRole('button',{name:'人工补选',exact:true})).toHaveCount(0);
  await page.screenshot({path:'artifacts/historical-selection-delete/readonly-'+width+'.png'});
  await page.getByRole('button',{name:'返回客户选样',exact:true}).click();await expect(more).toBeVisible();await more.click();
  await expect(page.getByRole('button',{name:'删除选样单',exact:true})).toBeVisible();await page.screenshot({path:'artifacts/historical-selection-delete/menu-'+width+'.png'});
  const writes=()=>page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length);
  await page.getByRole('button',{name:'删除选样单',exact:true}).click();const dialog=page.getByRole('alertdialog',{name:'删除选样单？'});await expect(dialog).toBeVisible();
  await page.screenshot({path:'artifacts/historical-selection-delete/confirm-'+width+'.png'});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(more).toBeFocused();expect(await writes()).toBe(0);
  await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failNext=true;});
  await more.click();await page.getByRole('button',{name:'删除选样单',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('删除未确认');await expect(page.getByRole('article')).toHaveCount(1);
  await more.click();await page.getByRole('button',{name:'删除选样单',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(page.getByRole('article')).toHaveCount(0);expect(await writes()).toBe(2);await page.screenshot({path:'artifacts/historical-selection-delete/deleted-'+width+'.png'});
 }
});


test('explicit deletion denial hides the menu even when selection editing is allowed',async({page})=>{
 await page.goto(entry);await expect(page.getByRole('article')).toHaveCount(1);
 await page.evaluate(()=>{const s=(window as any).scanSelectionFixture.groups[0].session;s.canManage=true;s.canDelete=false;s.customerReference='删除权限独立';});
 await page.getByRole('button',{name:'搜索选样单',exact:true}).click();await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('删除权限');
 await expect(page.getByRole('button',{name:'选样明细 删除权限独立',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'选样单更多操作 删除权限独立'})).toHaveCount(0);
});


test('directory shows the assigned contact separately and handles missing and long contact names at both widths',async({page})=>{
 for(const width of [360,1440]){
  await page.setViewportSize({width,height:800});await page.goto(entry);
  const contact='长联系人姓名用于验证完整信息可见且不撑宽列表';
  const customerName=await page.evaluate(value=>{const session=(window as any).scanSelectionFixture.groups[0].session;session.contactName=value;return session.customerReference as string;},contact);
  await page.getByRole('button',{name:'搜索选样单',exact:true}).click();const input=page.getByRole('searchbox',{name:'搜索选样单客户'});await input.fill(customerName.slice(0,1));
  const row=page.getByRole('article').first(),contacts=row.locator('[data-session-contacts]'),name=row.getByRole('button',{name:'选样明细 '+customerName+' '+contact,exact:true});
  await expect(contacts).toHaveText(contact);await expect(contacts).toHaveAttribute('title',contact);
  await contacts.click();await expect(page.getByRole('region',{name:'客户选样明细'})).toHaveCount(0);
  const nameBox=await name.boundingBox();expect(nameBox!.height).toBeGreaterThanOrEqual(44);expect(nameBox!.width).toBeGreaterThanOrEqual(44);
  for(const target of [row.getByRole('button',{name:/^导出 Excel/}),row.getByRole('button',{name:/^选样单更多操作/})]){const box=await target.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.x+box!.width).toBeLessThanOrEqual(width);}
  await expect(row.locator('time')).toHaveText('2026-10-25');await expect(row).toContainText('6 款 · 1 张色卡');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:'artifacts/sample-directory/contacts-'+width+'.png',fullPage:true});
  await page.evaluate(()=>{delete (window as any).scanSelectionFixture.groups[0].session.contactName;});await input.fill(customerName.slice(0,2));await expect(contacts).toHaveText('未指定');
  await page.evaluate(()=>{(window as any).scanSelectionFixture.groups[0].session.contactName=null;});await input.fill(customerName);await expect(contacts).toHaveText('未指定');
 }
});

test('ordinary orders and saved edits keep one contact per company selection',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:800});await page.goto(entry+'&multiContacts');
  const old=page.getByRole('button',{name:'选样明细 云间服饰',exact:true});
  await old.click();
  const edit=page.getByRole('button',{name:'编辑本单联系人',exact:true});await edit.click();
  const dialog=page.getByRole('dialog',{name:'编辑本单联系人'}),contact=dialog.getByRole('combobox',{name:'本单联系人'});
  await expect(contact).toHaveValue('current');await contact.selectOption({label:'王先生'});
  await page.screenshot({path:'artifacts/sample-directory/contact-edit-'+width+'.png'});
  await page.keyboard.press('Escape');await expect(edit).toBeFocused();
  await expect(page.getByText('联系人 · 未指定')).toBeVisible();
  await edit.click();await contact.selectOption({label:'王先生'});await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByText('联系人 · 王先生')).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'勾选配色 G0886-1，色卡 G0886-F018'})).toBeVisible();
  await page.getByRole('button',{name:'返回客户选样',exact:true}).click();
  await page.getByRole('button',{name:'新建选样单',exact:true}).click();
  await page.getByRole('button',{name:/云间服饰.*选择/}).click();
  await expect(page.getByRole('heading',{name:'选择联系人'})).toBeVisible();
  await page.screenshot({path:'artifacts/sample-directory/contact-choice-'+width+'.png'});
  await page.getByRole('button',{name:'陈女士',exact:true}).click();
  await expect(page.getByRole('heading',{name:'云间服饰',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'完成选样',exact:true}).click();
  await expect(page.getByRole('button',{name:'选样明细 云间服饰 陈女士',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'选样明细 云间服饰 王先生',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'搜索选样单',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('王先生');
  await expect(page.getByRole('button',{name:'选样明细 云间服饰 陈女士',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'选样明细 云间服饰 王先生',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});

test('batch mode preserves checked orders through failure and review, then downloads once',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:800});await page.goto(entry+'&batch&reviewIssues');
  const multi=page.getByRole('button',{name:'多选',exact:true});await multi.click();
  const submit=page.getByRole('button',{name:'批量导出 Excel',exact:true});
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox',{name:'勾选选样单 林女士 #11'}).check();
  await page.getByRole('checkbox',{name:'勾选选样单 王女士 #12'}).check();
  await page.getByRole('button',{name:'搜索选样单',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索选样单客户'}).fill('林女士');
  await expect(page.getByRole('checkbox',{name:'勾选选样单 王女士 #12'})).toHaveCount(0);
  await expect(page.getByText('已选 2 单')).toBeVisible();
  await page.screenshot({path:'artifacts/sample-directory/batch-export-'+width+'.png'});
  await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failNext=true;});
  await submit.click();await expect(page.getByRole('alert')).toContainText('已保留勾选');
  await expect(page.getByRole('checkbox',{name:'勾选选样单 林女士 #11'})).toBeChecked();
  await submit.click();await expect(page.getByRole('alert')).toContainText('林女士 · #11 的色卡需核对');
  const reviewButton=page.getByRole('button',{name:'核对色卡',exact:true});
  const dialog=page.getByRole('dialog',{name:'核对导出色卡'});
  await reviewButton.click();await expect(dialog).toBeVisible();
  await page.screenshot({path:'artifacts/sample-directory/batch-review-'+width+'.png'});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(reviewButton).toBeFocused();
  await reviewButton.click();await dialog.getByRole('checkbox',{name:'全选可更新条目'}).check();
  await dialog.getByRole('button',{name:'确认更新所选'}).click();
  await dialog.getByRole('button',{name:'完成核对'}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已选 2 单')).toBeVisible();
  const downloadPromise=page.waitForEvent('download');await submit.click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^客户选样汇总_.*\.xlsx$/);
  expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.batchRequests)).toEqual([['11','12'],['11','12']]);
  const notice=page.getByRole('region',{name:'操作提示'}).getByRole('status').filter({hasText:'已导出 2 张选样单'});
  await expect(notice).toBeVisible();
  await page.screenshot({path:'artifacts/sample-directory/batch-notice-'+width+'.png'});
  await expect(notice).toHaveCount(0,{timeout:5200});
  await expect(page.getByText('已选 2 单')).toBeVisible();
  await page.getByRole('button',{name:'取消多选'}).click();await expect(multi).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});
