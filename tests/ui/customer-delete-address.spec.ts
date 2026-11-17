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
  await dialog.getByText('更多联系方式',{exact:true}).click();
  await address.fill('浙江省杭州市联系人专用地址');
  await page.screenshot({path:'artifacts/customer-contact-reuse/profile-'+width+'.png'});
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('button',{name:'查看档案',exact:true}).click();
  await expect(dialog.getByText('专用地址 浙江省杭州市联系人专用地址',{exact:true})).toBeVisible();
  await expect(dialog.getByText('浙江省杭州市西湖区文一路88号3幢201室',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'编辑',exact:true}).click();
  await dialog.getByText('更多联系方式',{exact:true}).click();
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

test('customer editing puts the four everyday fields first and fits a full-length address',async({page})=>{
 for(const [width,height] of [[1366,768],[360,800]]){
  await page.setViewportSize({width,height});await page.goto(entry);
  const original='浙江省绍兴市柯桥区中国轻纺城国际面料采购中心东区二层北门入内沿主通道到第六排再向西至梭织样品接待处'.repeat(3).slice(0,100);
  await page.evaluate(address=>{
   const {profile}=(window as any).customerQa;
   Object.assign(profile,{region:address,brands:['原有品牌'],notes:'原有备注'});
   Object.assign(profile.contacts[0],{phone:'13812345678',wechat:'example-wechat',address:'另一处收货点'});
  },original);
  await page.getByRole('button',{name:'编辑客户',exact:true}).click();
  const dialog=page.getByRole('dialog');
  const form=dialog.getByRole('form',{name:'客户档案表单'});
  const name=form.getByRole('textbox',{name:'客户名称',exact:true});
  const address=form.getByRole('textbox',{name:'详细地址',exact:true});
  const person=form.getByRole('textbox',{name:'联系人1姓名',exact:true});
  const phone=form.getByRole('textbox',{name:'联系人1电话',exact:true});
  await expect(address).toHaveValue(original);
  expect(await address.evaluate(el=>el.tagName)).toBe('TEXTAREA');
  expect(await address.evaluate(el=>el.scrollHeight)).toBeLessThanOrEqual(await address.evaluate(el=>el.clientHeight+1));
  const addressBox=(await address.boundingBox())!;
  expect(addressBox.width).toBeGreaterThan(width===360?250:400);
  expect(addressBox.height).toBeGreaterThanOrEqual(112);
  for(const field of [name,address,person,phone])await expect(field).toBeInViewport({ratio:1});
  expect(await dialog.locator('.customer-dialog-body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(await dialog.locator('.customer-dialog-body').evaluate(el=>el.clientWidth+1));
  await expect(form.getByRole('textbox',{name:'品牌',exact:true})).toBeHidden();
  await expect(form.getByRole('textbox',{name:'联系人1微信',exact:true})).toBeHidden();
  await page.screenshot({path:'artifacts/customer-edit-layout/edit-'+width+'.png'});
  await form.getByText('更多资料',{exact:true}).click();
  await expect(form.getByRole('textbox',{name:'品牌',exact:true})).toHaveValue('原有品牌');
  await form.getByText('更多资料',{exact:true}).click();
  await name.fill('林女士客户更新');
  await address.fill('浙江省绍兴市柯桥区面料中心\n北门二楼样品收货处');
  await person.fill('林女士更新');
  await phone.fill('13912345678');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).customerQa.profile)).toMatchObject({
   displayName:'林女士客户更新',region:'浙江省绍兴市柯桥区面料中心 北门二楼样品收货处',brands:['原有品牌'],notes:'原有备注',
   contacts:[{name:'林女士更新',phone:'13912345678',wechat:'example-wechat',address:'另一处收货点'}]
  });
  await page.getByRole('button',{name:'编辑客户',exact:true}).click();
  await expect(address).toHaveValue('浙江省绍兴市柯桥区面料中心 北门二楼样品收货处');
  await expect(phone).toHaveValue('13912345678');
 }
});

test('editing a customer without contacts shows empty name and phone without creating a contact on save',async({page})=>{
 await page.goto(entry);
 await page.evaluate(()=>{(window as any).customerQa.profile.contacts=[];});
 await page.getByRole('button',{name:'编辑客户',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('textbox',{name:'联系人1姓名',exact:true})).toHaveValue('');
 await expect(dialog.getByRole('textbox',{name:'联系人1电话',exact:true})).toHaveValue('');
 await dialog.getByRole('textbox',{name:'详细地址',exact:true}).fill('测试地址');
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).customerQa.profile.contacts)).toEqual([]);
});

test('paste recognition previews the fields and updates only the editor draft until Save',async({page})=>{
 for(const width of [1366,360]){
  await page.setViewportSize({width,height:800});await page.goto(entry);
  await page.getByRole('button',{name:'编辑客户',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'编辑客户'});
  const open=editor.getByRole('button',{name:'粘贴识别'});
  await open.click();
  const dialog=page.getByRole('dialog',{name:'粘贴识别联系方式'});
  const raw=dialog.getByRole('textbox',{name:'收货或联系文字'});
  await expect(raw).toBeFocused();
  await raw.fill('收货人：赵女士\n电话：13900139000\n地址：浙江省绍兴市柯桥区纺织大道66号');
  await dialog.getByRole('button',{name:'识别',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'联系人姓名',exact:true})).toHaveValue('赵女士');
  await expect(dialog.getByRole('textbox',{name:'电话',exact:true})).toHaveValue('13900139000');
  await expect(dialog.getByRole('textbox',{name:'客户详细地址',exact:true})).toHaveValue('浙江省绍兴市柯桥区纺织大道66号');
  await page.screenshot({path:'artifacts/customer-contact-paste/preview-'+width+'.png'});
  await dialog.getByRole('button',{name:'填入表单',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(editor.getByRole('textbox',{name:'联系人1姓名',exact:true})).toHaveValue('赵女士');
  await expect(editor.getByRole('textbox',{name:'详细地址',exact:true})).toHaveValue('浙江省绍兴市柯桥区纺织大道66号');
  expect(await page.evaluate(()=>(window as any).customerQa.rowVersion)).toBe('1');
  await editor.getByRole('button',{name:'保存',exact:true}).click();
  await expect(editor).toHaveCount(0);
  expect(await page.evaluate(()=>(window as any).customerQa.profile)).toMatchObject({
   displayName:'林女士客户',region:'浙江省绍兴市柯桥区纺织大道66号',contacts:[{name:'赵女士',phone:'13900139000'}]
  });
 }
});

test('ambiguous phones require confirmation and multiple contacts require a target',async({page})=>{
 await page.goto(entry);
 await page.evaluate(()=>{(window as any).customerQa.profile.contacts.push({name:'第二联系人',phone:'13700000000',wechat:'existing'});});
 await page.getByRole('button',{name:'编辑客户',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'编辑客户'}),open=editor.getByRole('button',{name:'粘贴识别'});
 await open.click();
 const dialog=page.getByRole('dialog',{name:'粘贴识别联系方式'});
 await dialog.getByRole('textbox',{name:'收货或联系文字'}).fill('姓名：赵女士\n电话：13800001234 或 13900005678');
 await dialog.getByRole('button',{name:'识别',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('电话');
 await expect(dialog.getByRole('textbox',{name:'电话',exact:true})).toHaveValue('');
 const apply=dialog.getByRole('button',{name:'填入表单'});
 await expect(apply).toBeDisabled();
 await dialog.getByRole('combobox',{name:'填入联系人'}).selectOption('1');
 await apply.click();
 await expect(dialog).toHaveCount(0);
 await expect(editor.getByRole('textbox',{name:'联系人1姓名',exact:true})).toHaveValue('林女士');
 await expect(editor.getByRole('textbox',{name:'联系人2姓名',exact:true})).toHaveValue('赵女士');
 await expect(editor.getByRole('textbox',{name:'联系人2电话',exact:true})).toHaveValue('13700000000');
 await open.click();
 await page.keyboard.press('Escape');
 await expect(editor).toBeVisible();
 await expect(open).toBeFocused();
 expect(await page.evaluate(()=>(window as any).customerQa.rowVersion)).toBe('1');
});

test('new customer shows the focused layout and can save reviewed contact text',async({page})=>{
 const address='浙江省绍兴市柯桥区中国轻纺城国际面料采购中心东区二层北门入内沿主通道到第六排再向西至梭织样品接待处'.repeat(3).slice(0,100);
 for(const [width,height] of [[1366,768],[360,800]]){
  await page.setViewportSize({width,height});await page.goto(entry,{waitUntil:'domcontentloaded'});
  const trigger=page.getByRole('button',{name:'新建客户',exact:true});
  await trigger.click();
  const editor=page.getByRole('dialog',{name:'新建客户'});
  const name=editor.getByRole('textbox',{name:'客户名称',exact:true}),street=editor.getByRole('textbox',{name:'详细地址',exact:true});
  const person=editor.getByRole('textbox',{name:'联系人1姓名',exact:true}),phone=editor.getByRole('textbox',{name:'联系人1电话',exact:true});
  await expect(street).toHaveJSProperty('tagName','TEXTAREA');
  for(const field of [name,street,person,phone])await expect(field).toBeInViewport({ratio:1});
  await expect(editor.getByRole('textbox',{name:'品牌',exact:true})).toBeHidden();
  await editor.getByText('更多资料',{exact:true}).click();
  await expect(editor.getByRole('textbox',{name:'品牌',exact:true})).toBeVisible();
  await editor.getByText('更多资料',{exact:true}).click();

  const open=editor.getByRole('button',{name:'粘贴识别',exact:true});
  const preview=page.getByRole('dialog',{name:'粘贴识别联系方式'});
  const raw=preview.getByRole('textbox',{name:'收货或联系文字'});
  const pasted=width===360?address+'，13900139000、赵女士':'联系人：赵女士\n电话：13900139000\n地址：'+address;
  const plain=width===1366;
  await open.click();await expect(raw).toBeFocused();
  await raw.fill(plain?'abc,13900139000,xxxxxx':pasted);
  await preview.getByRole('button',{name:'识别',exact:true}).click();
  await expect(preview.getByRole('textbox',{name:'联系人姓名',exact:true})).toHaveValue(plain?'abc':'赵女士');
  await expect(preview.getByRole('textbox',{name:'电话',exact:true})).toHaveValue('13900139000');
  await expect(preview.getByRole('textbox',{name:'客户详细地址',exact:true})).toHaveValue(plain?'xxxxxx':address);
  await page.screenshot({path:`artifacts/customer-create-layout/recognition-${width}.png`});
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);await expect(open).toBeFocused();await expect(street).toHaveValue('');
  await open.click();await raw.fill(pasted);
  await preview.getByRole('button',{name:'识别',exact:true}).click();
  await preview.getByRole('button',{name:'填入表单',exact:true}).click();
  await expect(open).toBeFocused();
  await expect(name).toHaveValue('');await expect(street).toHaveValue(address);
  await expect(person).toHaveValue('赵女士');await expect(phone).toHaveValue('13900139000');
  expect(await street.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  expect(await editor.locator('.customer-dialog-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>(window as any).customerQa.created.length)).toBe(0);

  await name.fill('演示新客户');
  await page.screenshot({path:`artifacts/customer-create-layout/new-${width}.png`});
  await name.fill('林女士客户');
  const save=editor.getByRole('button',{name:'保存',exact:true});
  await save.click();
  await expect(editor.getByRole('alert')).toHaveText('该客户名称已存在，请修改后再保存。');
  await expect(street).toHaveValue(address);
  await name.fill('演示新客户');
  await save.click();
  await expect(editor).toHaveCount(0);await expect(trigger).toBeFocused();
  await expect(page.getByRole('button',{name:'演示新客户',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as any).customerQa.created.map((item:any)=>item.profile))).toMatchObject([
   {displayName:'演示新客户',region:address,contacts:[{name:'赵女士',phone:'13900139000'}]},
  ]);
 }
});

test('new customer can be saved with only a name',async({page})=>{
 await page.goto(entry,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'新建客户',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'新建客户'});
 await editor.getByRole('textbox',{name:'客户名称',exact:true}).fill('只填写名称的客户');
 await editor.getByRole('button',{name:'保存',exact:true}).click();
 await expect(editor).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).customerQa.created.map((item:any)=>item.profile))).toMatchObject([
  {displayName:'只填写名称的客户',region:null,contacts:[]},
 ]);
});
