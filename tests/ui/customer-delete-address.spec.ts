// AC-146 / AC-105
import {test,expect} from '@playwright/test';
const entry='/tools/ui-preview/entries/ui-ux-internal-chrome.html?customers';

// AC-146
test('each associated document type prevents a delete confirmation on desktop and mobile',async({page})=>{
 for(const width of [1440,360])for(const type of ['sample','bulk','deposit']){
  await page.setViewportSize({width,height:900});await page.goto(entry);
  await page.evaluate(type=>{const qa=(window as any).customerQa;qa.selections=0;qa.documents[type]=1;},type);
  await page.getByRole('button',{name:'删除客户',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('还有 1 张单据');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).customerQa.deletes)).toBe(0);
  await page.screenshot({path:`artifacts/customer-order-name/delete-${type}-${width}.png`});
 }
});

test('a document created after preview blocks the delete request; clearing all documents restores confirmation',async({page})=>{
 await page.goto(entry);await page.evaluate(()=>{const qa=(window as any).customerQa;qa.selections=0;qa.documents.deposit=1;qa.previewDocuments={sample:0,bulk:0,deposit:0};});
 await page.getByRole('button',{name:'删除客户',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();
 await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByRole('alert')).toContainText('先删除关联单据');
 expect(await page.evaluate(()=>(window as any).customerQa.deleted)).toBe(false);
 await page.evaluate(()=>{const qa=(window as any).customerQa;qa.documents.deposit=0;qa.previewDocuments=null;});
 const remove=page.getByRole('button',{name:'删除客户',exact:true});await remove.click();await expect(page.getByRole('alertdialog')).toBeVisible();
 await page.keyboard.press('Escape');await expect(remove).toBeFocused();
 await remove.click();await page.getByRole('button',{name:'确认删除',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).customerQa.deleted)).toBe(true);
});
test.beforeEach(async({page})=>{page.on('pageerror',e=>{throw e;});});
test('customer rename rejects a duplicate and keeps the draft available to correct',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});
  await page.goto(entry);
  const edit=page.getByRole('button',{name:'编辑客户',exact:true});
  await edit.click();
  const dialog=page.getByRole('dialog');
  const name=dialog.getByRole('textbox',{name:'客户名称',exact:true});
  const address=dialog.getByRole('textbox',{name:'详细地址',exact:true});
  await name.fill('已用客户名称');
  await address.fill('编辑中的地址');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(dialog.getByRole('alert')).toHaveText('该客户名称已存在，请修改后再保存。');
  await expect(name).toHaveValue('已用客户名称');
  await expect(address).toHaveValue('编辑中的地址');
  expect(await page.evaluate(()=>(window as any).customerQa.rowVersion)).toBe('1');
  await page.screenshot({path:'artifacts/customer-rename/duplicate-'+width+'.png'});
  await name.fill('更正后的客户名称');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).customerQa.profile)).toMatchObject({displayName:'更正后的客户名称',region:'编辑中的地址'});
  await edit.click();
  await expect(name).toHaveValue('更正后的客户名称');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(await page.evaluate(()=>(window as any).customerQa.rowVersion)).toBe('2');
 }
});
test('customer deletion blocks active selections and preserves the record at desktop and narrow widths',async({page})=>{
 for(const width of [1440,360]){await page.setViewportSize({width,height:900});await page.goto(entry);await page.getByRole('button',{name:'删除客户',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('还有 2 张选样单');await expect(page.getByRole('alert')).toContainText('先删除选样单');await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'林女士客户',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).customerQa.deletes)).toBe(0);
  await page.screenshot({path:'artifacts/catalog-customer-update/delete-blocked-'+width+'.png'});
 }
});
test('customer deletion rechecks a selection created after preview; empty selection permits cancel or explicit deletion',async({page})=>{
 await page.goto(entry);await page.evaluate(()=>{(window as any).customerQa.previewSelections=0;});await page.getByRole('button',{name:'删除客户',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByRole('alert')).toContainText('先删除选样单');expect(await page.evaluate(()=>(window as any).customerQa.deleted)).toBe(false);
 await page.goto(entry);await page.evaluate(()=>{(window as any).customerQa.selections=0;});const remove=page.getByRole('button',{name:'删除客户',exact:true});await remove.click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.keyboard.press('Escape');await expect(remove).toBeFocused();expect(await page.evaluate(()=>(window as any).customerQa.deletes)).toBe(0);await remove.click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByRole('button',{name:'林女士客户',exact:true})).toHaveCount(0);
});
// AC-105
test('a contact can override and clear an address independently of the customer default',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});await page.goto(entry);
  await page.getByRole('button',{name:'编辑客户',exact:true}).click();
  const dialog=page.getByRole('dialog'),address=dialog.getByRole('textbox',{name:'联系人1专用地址',exact:true});
  await dialog.getByText('专用地址',{exact:true}).click();
  await address.fill('浙江省杭州市联系人专用地址');
  await page.screenshot({path:'artifacts/customer-contact-reuse/profile-'+width+'.png'});
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('button',{name:'查看档案',exact:true}).click();
  await expect(dialog.getByText('专用地址 浙江省杭州市联系人专用地址',{exact:true})).toBeVisible();
  await expect(dialog.getByText('浙江省杭州市西湖区文一路88号3幢201室',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'编辑',exact:true}).click();
  await dialog.getByText('专用地址（已填写）',{exact:true}).click();
  await address.clear();
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).customerQa.profile.contacts[0].address)).toBeUndefined();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});
test('detailed address labels preserve existing values through display editing and save at both widths',async({page})=>{
 for(const width of [1440,360]){await page.setViewportSize({width,height:900});await page.goto(entry);await page.getByRole('button',{name:'查看档案',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByText('详细地址',{exact:true})).toBeVisible();await expect(dialog.getByText('浙江省杭州市西湖区文一路88号3幢201室',{exact:true})).toBeVisible();await page.screenshot({path:'artifacts/catalog-customer-update/address-view-'+width+'.png'});await dialog.getByRole('button',{name:'编辑',exact:true}).click();const address=page.getByRole('textbox',{name:'详细地址',exact:true});await expect(address).toHaveValue('浙江省杭州市西湖区文一路88号3幢201室');await expect(page.getByRole('textbox',{name:'地区',exact:true})).toHaveCount(0);await address.fill('浙江省杭州市详细街道66号');await page.screenshot({path:'artifacts/catalog-customer-update/address-edit-'+width+'.png'});await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).customerQa.profile.region)).toBe('浙江省杭州市详细街道66号');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});
