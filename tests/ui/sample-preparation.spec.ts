// AC-177
import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const entry='/tools/ui-preview/entries/ui-ux-scan-selection.html?directory&batch';
test.beforeEach(async({page})=>{
 page.on('pageerror',e=>{throw e;});
 // Optional prebuilt-file transport for environments without loopback access; same real UI assets.
 if(process.env.FABRIC_PREPARATION_STATIC_SITE)await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),root=path.resolve(process.env.FABRIC_PREPARATION_STATIC_SITE!),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep))return route.abort();
  try{await route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'} as Record<string,string>)[path.extname(file)]??'application/octet-stream'});}catch{await route.fulfill({status:404,body:'not found'});}
 });
});
for(const width of [1440,360])test('preparation summary four fields, exact selection and return focus '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(entry);await page.getByRole('button',{name:'多选',exact:true}).click();
 const open=page.getByRole('button',{name:'查看汇总',exact:true});await expect(open).toBeDisabled();
 await page.getByRole('checkbox',{name:'勾选选样单 林女士 #11'}).check();await page.getByRole('checkbox',{name:'勾选选样单 王女士 #12'}).check();
 await page.getByRole('button',{name:'搜索选样单',exact:true}).click();await page.getByRole('searchbox').fill('林女士');await expect(page.getByRole('article')).toHaveCount(1);
 await open.click();const summary=page.getByRole('region',{name:'备样汇总'});await expect(summary).toBeVisible();
 await expect(summary.locator('th')).toHaveText(['色卡编号','配色缩略图','份数','客户／联系人']);await expect(summary.locator('[data-preparation-row]')).toHaveCount(7);
 await expect(summary.getByText('G0886-1',{exact:true})).toBeVisible();await expect(summary.getByText('林女士／未指定',{exact:true})).toHaveCount(6);
 await expect(summary.getByRole('img').first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:'artifacts/sample-preparation/summary-'+width+'.png',fullPage:true});
 await page.keyboard.press('Escape');await expect(summary).toHaveCount(0);await expect(open).toBeFocused();await expect(page.getByRole('searchbox')).toHaveValue('林女士');await expect(page.getByRole('checkbox',{name:'勾选选样单 林女士 #11'})).toBeChecked();await expect(page.getByText('已选 2 单',{exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/sample-preparation/directory-'+width+'.png',fullPage:true});
});
test('summary failure retries, image failures retain recipients and revoked access clears private data',async({page})=>{
 await page.goto(entry+'&networkImages&badAsset');await page.getByRole('button',{name:'多选',exact:true}).click();await page.getByRole('checkbox',{name:'勾选选样单 林女士 #11'}).check();
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failNext=true;});await page.getByRole('button',{name:'查看汇总',exact:true}).click();
 const summary=page.getByRole('region',{name:'备样汇总'});await expect(summary.getByRole('alert')).toContainText('读取失败');await summary.getByRole('button',{name:'重试',exact:true}).click();
 await expect(summary.locator('[data-preparation-row]')).toHaveCount(6);await expect(summary.getByRole('button',{name:'重试花型 G0886-1 缩略图'})).toBeVisible();await expect(summary.getByText('林女士／未指定',{exact:true})).toHaveCount(6);
 await summary.getByRole('button',{name:'返回客户选样',exact:true}).click();await expect(page.getByRole('checkbox',{name:'勾选选样单 林女士 #11'})).toBeChecked();
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.deny=true;});await page.getByRole('button',{name:'查看汇总',exact:true}).click();await expect(summary).toHaveCount(0);await expect(page.getByRole('article')).toHaveCount(0);await expect(page.getByText('已选 1 单',{exact:true})).toHaveCount(0);
});
test('unresolved card uses existing review and closing summary during loading ignores the late response',async({page})=>{
 await page.goto(entry+'&reviewIssues');await page.getByRole('button',{name:'多选',exact:true}).click();await page.getByRole('checkbox',{name:'勾选选样单 林女士 #11'}).check();await page.getByRole('button',{name:'查看汇总',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('的色卡需核对');await page.getByRole('button',{name:'核对色卡',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 await page.goto(entry);await page.getByRole('button',{name:'多选',exact:true}).click();await page.getByRole('checkbox',{name:'勾选选样单 林女士 #11'}).check();
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.deferSummary=true;});await page.getByRole('button',{name:'查看汇总',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'正在汇总'})).toBeVisible();await page.keyboard.press('Escape');
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.releaseSummary?.();});await expect(page.getByRole('region',{name:'备样汇总'})).toHaveCount(0);await expect(page.getByRole('button',{name:'查看汇总',exact:true})).toBeFocused();
});
test('same company different contacts count separately and long recipient names wrap at both widths',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});await page.goto(entry);
  await page.evaluate(()=>{
   const groups=(window as any).scanSelectionFixture.groups,name='超长服饰客户名称用于核对备样名单完整展示';
   groups[0].session.customerReference=name;groups[0].session.contactName='张女士（设计开发负责人）';groups[0].selected.clear();groups[0].selected.add('100');
   groups[1].session.customerReference=name;groups[1].session.contactName='李先生（采购与面料开发联系人）';groups[1].selected.clear();groups[1].selected.add('100');
   groups.push({...groups[1],session:{...groups[1].session,id:'13'}});
  });
  await page.getByRole('button',{name:'搜索选样单',exact:true}).click();await page.getByRole('searchbox').fill('超长服饰');await expect(page.getByRole('article')).toHaveCount(3);
  await page.getByRole('button',{name:'多选',exact:true}).click();for(const checkbox of await page.getByRole('checkbox').all())await checkbox.check();await page.getByRole('button',{name:'查看汇总',exact:true}).click();
  const summary=page.getByRole('region',{name:'备样汇总'}),row=summary.locator('[data-preparation-row]');await expect(row).toHaveCount(1);await expect(row.locator('[data-preparation-quantity] strong')).toHaveText('2');
  await expect(row.locator('[data-preparation-recipients]>div')).toHaveCount(2);await expect(row).toContainText('张女士（设计开发负责人）');await expect(row).toContainText('李先生（采购与面料开发联系人）');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:'artifacts/sample-preparation/long-recipients-'+width+'.png',fullPage:true});
 }
});
