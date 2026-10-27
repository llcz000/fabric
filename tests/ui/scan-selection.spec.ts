// AC-163, AC-164
import {test,expect,type Page} from '@playwright/test';
import QRCode from 'qrcode';
const entry='/tools/ui-preview/entries/ui-ux-scan-selection.html';
async function ready(page:Page){await page.goto(entry);await page.getByRole('button',{name:/林女士.*选择/}).click();await expect(page.getByRole('region',{name:'扫码选样',exact:true})).toBeVisible();await expect(page.getByRole('status').filter({hasText:'已自动保存'})).toBeVisible();}
async function enterCode(page:Page,value:string){await page.getByText('其他添加方式',{exact:true}).click();await page.getByRole('textbox',{name:'输入色卡编码'}).fill(value);await page.getByRole('button',{name:'加入',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已自动保存'})).toBeVisible();}
test.beforeEach(async({page})=>{
 page.on('pageerror',e=>{throw e;});
 await page.route('https://fabric-scan-fixture.invalid/**',route=>{
  const id=Number(route.request().url().match(/(\d+)\.svg/)?.[1]??1),colors=['#ede5df','#d9e7ec','#e9dce8','#e3e8d8','#ebd6d2','#e6e1ef'];
  return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="${colors[id%6]}"/><g fill="none" stroke="#6f7c70" stroke-width="2" opacity=".65"><path d="M10 180Q95 90 55 0M100 180Q120 90 170 0M0 60Q90 95 180 30"/></g><g fill="#ae7286" opacity=".7">${[0,1,2,3,4].map(i=>`<ellipse cx="${30+i*31}" cy="${25+(i%3)*48}" rx="17" ry="12" transform="rotate(${i*32} ${30+i*31} ${25+(i%3)*48})"/>`).join('')}</g></svg>`});
 });
});
test('scan entry shows only customer confirmation and selecting once adds the first card exactly once',async({page})=>{
 await page.goto(entry);await expect(page.getByRole('heading',{name:'先选择客户'})).toBeVisible();
 for(const name of ['新建选样单','查看色卡花型','刷新列表'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/林女士.*选择/}).click();await expect(page.getByRole('checkbox')).toHaveCount(6);
 for(const box of await page.getByRole('checkbox').all())await expect(box).toBeChecked();
 await expect(page.getByText('已选 6/6')).toBeVisible();await expect(page.getByRole('button',{name:'继续扫码'})).toBeEnabled();
 expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.filter((x:string)=>x.endsWith('/scan')).length)).toBe(1);
});
test('partial selection autosaves, rescan preserves it and explicit recheck restores it',async({page})=>{
 await ready(page);const box=page.getByRole('checkbox',{name:'配色 G0886-2',exact:true});await box.click();await expect(box).not.toBeChecked();await expect(page.getByText('已选 5/6')).toBeVisible();
 await enterCode(page,'SCAN_FIXTURE_FIRST_CARD_TOKEN_12345');await expect(box).not.toBeChecked();await expect(page.getByText('已选过，保留原有配色选择')).toBeVisible();
 await box.click();await expect(box).toBeChecked();await expect(page.getByText('已选 6/6')).toBeVisible();
 await page.getByRole('button',{name:'完成选样'}).click();await page.getByRole('button',{name:'选样明细 林女士'}).click();await expect(page.locator('[data-selection-item]')).toHaveCount(6);await expect(page.getByRole('checkbox',{name:'勾选货号 G0886-2-F018'})).toBeVisible();
});
test('save failure keeps the desired selection and retry safely handles a lost successful response',async({page})=>{
 await ready(page);await page.evaluate(()=>{(window as any).scanSelectionFixture.state.loseNextResponse=true;});
 const box=page.getByRole('checkbox',{name:'配色 G0886-3',exact:true});await box.click();await expect(box).not.toBeChecked();
 await expect(page.getByRole('alert')).toContainText('保存未确认');await expect(page.getByRole('button',{name:'完成选样'})).toBeDisabled();
 await page.getByRole('button',{name:'重试保存'}).click();await expect(page.getByRole('status').filter({hasText:'已自动保存'})).toBeVisible();await expect(box).not.toBeChecked();
});
test('new scans appear first, whole-card removal and undo preserve the previous subset',async({page})=>{
 await ready(page);await page.getByRole('checkbox',{name:'配色 G0886-2',exact:true}).click();await expect(page.getByText('已选 5/6')).toBeVisible();
 await enterCode(page,'SCAN_FIXTURE_SECOND_CARD_TOKEN_12345');await expect(page.getByRole('article').first()).toHaveAttribute('aria-label','已加入色卡 G0626-F018');
 await page.getByRole('button',{name:'移除色卡 G0886-F018'}).click();await expect(page.getByRole('article',{name:'已加入色卡 G0886-F018'})).toHaveCount(0);
 await page.getByRole('button',{name:'撤销移除'}).click();await expect(page.getByText('已选 5/6')).toBeVisible();await expect(page.getByRole('checkbox',{name:'配色 G0886-2',exact:true})).not.toBeChecked();
});
test('camera cancel and Escape keep selection, restore focus and never write',async({page})=>{
 await ready(page);await page.evaluate(()=>{Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});}}});});
 const before=await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length);
 const scan=page.getByRole('button',{name:'继续扫码'});await scan.click();await expect(page.getByRole('dialog',{name:'实时扫码色卡'})).toBeVisible();await page.keyboard.press('Escape');await expect(scan).toBeFocused();
 await expect(page.getByText('已选 6/6')).toBeVisible();expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length)).toBe(before);
});
test('customer quick creation uses name only and cancellation or invalid card never creates a session',async({page})=>{
 await page.goto(entry);await page.getByRole('searchbox',{name:'搜索选样客户'}).fill('新客户');await page.getByRole('button',{name:'新建客户“新客户”并选样'}).click();await expect(page.getByRole('heading',{name:'新客户',exact:true})).toBeVisible();await expect(page.getByRole('checkbox')).toHaveCount(6);
 await page.goto(entry+'?invalidCard');await expect(page.getByRole('alert')).toContainText('不可用');expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.filter((p:string)=>p.endsWith('/with-sample-session')).length)).toBe(0);
 await expect(page.getByRole('button',{name:/林女士.*选择/})).toBeDisabled();
 await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('heading',{name:'客户选样',exact:true})).toBeVisible();
});
test('360px and desktop retain direct colorways and reachable scan/finish controls',async({page})=>{
 for(const width of [360,1440]){await page.setViewportSize({width,height:800});await ready(page);await page.getByRole('checkbox',{name:'配色 G0886-2',exact:true}).click();await expect(page.getByText('已选 5/6')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for(const name of ['继续扫码','完成选样']){const box=await page.getByRole('button',{name,exact:true}).boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.y+box!.height).toBeLessThanOrEqual(800);}
  await page.screenshot({path:`artifacts/ui-ux-pilot/scan-selection-${width}.png`,fullPage:true});
 }
});

test('a revoked session reported as 404 clears customer and image data after a mutation',async({page})=>{
 await ready(page);await page.evaluate(()=>{const state=(window as any).scanSelectionFixture.state;state.denyStatus=404;state.deny=true;});
 await page.getByRole('checkbox',{name:'配色 G0886-2',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('当前选样不可访问');await expect(page.getByRole('heading',{name:'林女士',exact:true})).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.locator('article img')).toHaveCount(0);
});
test('the same manual card query can be retried after a temporary search failure',async({page})=>{
 await ready(page);await page.getByText('其他添加方式',{exact:true}).click();await page.getByRole('button',{name:'搜索色卡并选择配色'}).click();
 const dialog=page.getByRole('dialog',{name:'人工补选'});await dialog.getByPlaceholder('色卡编号、花型编号、面料品号或品名').fill('G0626');
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failSearch=true;});await dialog.getByRole('button',{name:'搜索色卡'}).click();await expect(dialog.getByRole('alert')).toContainText('色卡检索失败');
 await dialog.getByRole('button',{name:'重试检索'}).click();await expect(dialog.getByRole('button',{name:'加入色卡 G0626-F018'})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'加入色卡 G0626-F018'})).toBeDisabled();
});

test('successful camera recognition adds the next card without another confirmation',async({page})=>{
 await ready(page);
 const qr=QRCode.create('SCAN_FIXTURE_SECOND_CARD_TOKEN_12345',{errorCorrectionLevel:'M'}),size=qr.modules.size,modules=Array.from(qr.modules.data);
 await page.evaluate(({size,modules})=>{
  const side=(size+8)*8,stream={getTracks:()=>[{stop(){}}]};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>stream}});
  Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{configurable:true,set(){}});
  Object.defineProperty(HTMLVideoElement.prototype,'videoWidth',{configurable:true,get:()=>side});Object.defineProperty(HTMLVideoElement.prototype,'videoHeight',{configurable:true,get:()=>side});HTMLMediaElement.prototype.play=async()=>{};
  const pixels=new Uint8ClampedArray(side*side*4);for(let y=0;y<side;y++)for(let x=0;x<side;x++){const r=Math.floor(y/8)-4,c=Math.floor(x/8)-4,v=r>=0&&r<size&&c>=0&&c<size&&modules[r*size+c]?0:255,index=(y*side+x)*4;pixels[index]=v;pixels[index+1]=v;pixels[index+2]=v;pixels[index+3]=255;}
  CanvasRenderingContext2D.prototype.drawImage=()=>{};CanvasRenderingContext2D.prototype.getImageData=()=>({data:pixels,width:side,height:side,colorSpace:'srgb'}) as ImageData;
 },{size,modules});
 await page.getByRole('button',{name:'继续扫码'}).click();await expect(page.getByRole('article',{name:'已加入色卡 G0626-F018'})).toBeVisible();await expect(page.getByRole('checkbox')).toHaveCount(9);await expect(page.getByRole('dialog',{name:'实时扫码色卡'})).toHaveCount(0);
});

test('keyboard toggles keep focus and completed whole-card removals stay out of the reopened active list',async({page})=>{
 await ready(page);const box=page.getByRole('checkbox',{name:'配色 G0886-2',exact:true});await box.focus();await page.keyboard.press('Space');await expect(box).not.toBeChecked();await expect(box).toBeFocused();await expect(page.getByText('已选 5/6')).toBeVisible();
 await page.getByRole('button',{name:'移除色卡 G0886-F018'}).click();await expect(page.getByRole('article')).toHaveCount(0);await page.getByRole('button',{name:'完成选样'}).click();await page.getByRole('button',{name:'选样明细 林女士'}).click();await expect(page.getByRole('button',{name:'继续扫码'})).toBeEnabled();await expect(page.getByText('暂无已选产品')).toBeVisible();
});

test('product feedback remains accessible from the saved selection management entry',async({page})=>{
 await ready(page);await page.getByRole('button',{name:'完成选样'}).click();await page.getByRole('button',{name:'选样明细 林女士'}).click();await expect(page.getByRole('button',{name:'继续扫码'})).toBeEnabled();await page.getByRole('tab',{name:'产品反馈'}).click();await expect(page.getByRole('tab',{name:'产品反馈'})).toHaveAttribute('aria-selected','true');
});

test('mobile saved selection details have one scan entry, no customer reassignment, no extra refresh and no product-feedback association',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await ready(page);
 await page.getByRole('button',{name:'完成选样'}).click();
 await page.getByRole('button',{name:'选样明细 林女士'}).click();
 await expect(page.getByRole('region',{name:'客户选样明细'})).toBeVisible();
 const productNo=page.getByText('G0886-1-F018',{exact:true});await expect(productNo).toBeVisible();
 const bounds=await productNo.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(360);
 await expect(page.getByRole('button',{name:'继续扫码',exact:true})).toHaveCount(1);
 await expect(page.getByRole('form',{name:'扫码加入选样'})).toHaveCount(0);
 for(const label of ['更改客户关联','关联客户档案','修改客户','刷新'])await expect(page.getByRole('button',{name:label,exact:true})).toHaveCount(0);
 const region=page.getByRole('region',{name:'客户选样明细'});
 expect((await region.boundingBox())!.y).toBeLessThan(240);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 await page.screenshot({path:'artifacts/sample-directory/details-360.png',fullPage:true});
 await page.getByRole('tab',{name:'产品反馈'}).click();
 await expect(page.getByRole('region',{name:'产品反馈'})).toBeVisible();
 await expect(page.getByText('关联产品（可选）')).toHaveCount(0);
 await expect(page.getByRole('checkbox',{name:/^关联 /})).toHaveCount(0);
 await page.screenshot({path:'artifacts/sample-directory/feedback-360.png',fullPage:true});
 await page.getByRole('tab',{name:'选样明细'}).click();
 await page.getByRole('button',{name:'继续扫码',exact:true}).click();
 await expect(page.getByRole('region',{name:'扫码选样'})).toBeVisible();
});

test('manual add is explicit: closed/reopened modal never restores cancelled colors and mobile card list has no preselection',async({page})=>{
 await page.setViewportSize({width:360,height:800});await ready(page);
 await page.getByRole('checkbox',{name:'配色 G0886-2',exact:true}).uncheck();
 await expect(page.getByText('已选 5/6')).toBeVisible();
 await page.getByRole('button',{name:'完成选样'}).click();
 await page.getByRole('button',{name:'选样明细 林女士'}).click();
 const trigger=page.getByRole('button',{name:'人工补选'});
 await trigger.click();
 const dialog=page.getByRole('dialog',{name:'人工补选'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('checkbox')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'加入色卡 G0886-F018'})).toBeDisabled();
 await dialog.getByRole('button',{name:'G0886-F018',exact:true}).click();
 const choices=dialog.getByRole('checkbox',{name:/^配色 G0886-/});
 await expect(choices).toHaveCount(6);
 for(const choice of await choices.all())await expect(choice).not.toBeChecked();
 await expect(dialog.getByRole('button',{name:'加入色卡 G0886-F018'})).toBeDisabled();
 const close=dialog.getByRole('button',{name:'关闭人工补选'});
 await expect(close).toHaveAttribute('title','关闭');
 await expect(dialog.getByText('关闭补选',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 await page.screenshot({path:'artifacts/sample-directory/manual-add-360.png',fullPage:true});
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.selected.has('101'))).toBe(false);
 await trigger.click();const reopened=page.getByRole('dialog',{name:'人工补选'});
 await reopened.getByRole('button',{name:'G0886-F018',exact:true}).click();
 await reopened.getByRole('checkbox',{name:'配色 G0886-2-F018',exact:true}).check();
 await expect(reopened.getByRole('button',{name:'加入色卡 G0886-F018'})).toBeEnabled();
 await reopened.getByRole('button',{name:'加入色卡 G0886-F018'}).click();
 await expect(reopened.getByText(/恢复 1 款/)).toBeVisible();
 await expect(reopened.getByRole('button',{name:'加入色卡 G0886-F018'})).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.selected.has('101'))).toBe(true);
});
test('manual add supports explicit select-all and clear without creating any write, desktop remains compact',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await ready(page);
 await page.getByRole('button',{name:'完成选样'}).click();
 await page.getByRole('button',{name:'选样明细 林女士'}).click();
 await page.getByRole('button',{name:'人工补选'}).click();
 const dialog=page.getByRole('dialog',{name:'人工补选'});
 const before=await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length);
 const row=dialog.getByRole('article',{name:'可补选色卡 G0886-F018'});
 await row.getByRole('button',{name:'G0886-F018',exact:true}).click();
 await row.getByRole('button',{name:'全选本卡 G0886-F018'}).click();
 for(const choice of await row.getByRole('checkbox').all())await expect(choice).toBeChecked();
 await expect(row.getByRole('button',{name:'加入色卡 G0886-F018'})).toBeEnabled();
 await row.getByRole('button',{name:'清空本卡 G0886-F018 的选择'}).click();
 await expect(row.getByRole('button',{name:'加入色卡 G0886-F018'})).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.length)).toBe(before);
 await page.screenshot({path:'artifacts/sample-directory/manual-add-1440.png',fullPage:true});
 await dialog.getByRole('button',{name:'关闭人工补选'}).click();
 await expect(dialog).toHaveCount(0);
});

test('failed manual add retains selected colorway for retry, successful retry clears temporary choice',async({page})=>{
 await ready(page);
 await page.getByRole('button',{name:'完成选样'}).click();
 await page.getByRole('button',{name:'选样明细 林女士'}).click();
 await page.getByRole('button',{name:'人工补选'}).click();
 const dialog=page.getByRole('dialog',{name:'人工补选'});
 await dialog.getByRole('button',{name:'G0626-F018',exact:true}).click();
 const checked=dialog.getByRole('checkbox',{name:'配色 G0626-1-F018'});
 await checked.check();
 await page.evaluate(()=>(window as any).scanSelectionFixture.state.failNext=true);
 await dialog.getByRole('button',{name:'加入色卡 G0626-F018'}).click();
 await expect(dialog.getByRole('alert')).toContainText('补选失败');
 await expect(checked).toBeChecked();
 expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.selected.has('200'))).toBe(false);
 await dialog.getByRole('button',{name:'加入色卡 G0626-F018'}).click();
 await expect(dialog.getByRole('status')).toContainText('新增 1 款');
 await expect(checked).not.toBeChecked();
 await expect(dialog.getByRole('button',{name:'加入色卡 G0626-F018'})).toBeDisabled();
 expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.selected.has('200'))).toBe(true);
});
