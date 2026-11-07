// V2-08, V2-09, V2-10 / AC-84, AC-163, AC-164
import {test,expect} from '@playwright/test';
const directory='/tools/ui-preview/entries/ui-ux-scan-selection.html?directory';
test.beforeEach(async({page})=>{await page.route('https://fabric-scan-fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="pink"/></svg>'}));});

test('details survive reload and browser back/forward without retaining customer data in storage',async({page})=>{
 await page.goto(directory);await page.getByRole('button',{name:'选样明细 林女士'}).click();
 await expect(page).toHaveURL(/sessionId=11/);await page.reload();
 await expect(page.getByRole('region',{name:'客户选样明细',exact:true})).toBeVisible();
 await expect(page.locator('[data-selected-card]')).toHaveCount(1);
 for(const width of [1440,360]){await page.setViewportSize({width,height:900});await expect(page.locator('[data-selected-card] img')).toHaveCount(6);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'artifacts/sample-detail-fixes/details-'+width+'.png',fullPage:true});}
 expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('林女士'))).toBe(false);
 await page.getByRole('button',{name:'返回客户选样',exact:true}).click();
 await expect(page.getByRole('button',{name:'新建选样单',exact:true})).toBeVisible();await expect(page).not.toHaveURL(/sessionId=/);
 await page.goBack();await expect(page.locator('[data-selected-card]')).toHaveCount(1);
 await page.goForward();await expect(page.getByRole('button',{name:'新建选样单',exact:true})).toBeVisible();
});

test('a missing or unauthorized routed session remains an explicit error with a working return action',async({page})=>{
 for(const suffix of ['&denyDetails#/samples?sessionId=11','#/samples?sessionId=999']){
  await page.goto(directory+suffix);await expect(page.getByRole('alert')).toHaveText('无权查看或选样单不存在');
  await expect(page.getByRole('button',{name:'新建选样单',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'返回客户选样',exact:true}).click();await expect(page.getByRole('button',{name:'新建选样单',exact:true})).toBeVisible();
 }
});

test('one missing asset does not blank the other colorways and failed thumbnails can retry',async({page})=>{
 await page.route('https://fabric-scan-fixture.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="pink"/></svg>'}));
 await page.goto(directory+'&networkImages&badAsset');await page.getByRole('button',{name:'选样明细 林女士'}).click();
 await expect(page.locator('[data-selected-card] img')).toHaveCount(5);
 await expect(page.getByRole('button',{name:'重试花型 G0886-1 缩略图'})).toBeVisible();
 await expect(page.getByRole('checkbox',{name:'勾选配色 G0886-1，色卡 G0886-F018',exact:true})).not.toBeChecked();
 await page.getByRole('button',{name:'重试花型 G0886-1 缩略图'}).click();
 await expect(page.getByRole('checkbox',{name:'勾选配色 G0886-1，色卡 G0886-F018',exact:true})).not.toBeChecked();
});

test('transient image batch failure recovers automatically and an expired image gets a fresh signature once',async({page})=>{
 let first=true;await page.route('https://fabric-scan-fixture.invalid/**',route=>{if(first){first=false;return route.fulfill({status:403,body:'Expired signature'});}return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="pink"/></svg>'});});
 await page.goto(directory+'&networkImages&failImagesOnce');await page.getByRole('button',{name:'选样明细 林女士'}).click();
 await expect(page.locator('[data-selected-card] img')).toHaveCount(6);
 await expect.poll(()=>page.locator('[data-selected-card] img').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0))).toBe(true);
 expect((await page.evaluate(()=>(window as any).sampleImageRequests)).length).toBeLessThanOrEqual(4);
});

test('only the current twenty cards request image signatures, including after delayed pagination',async({page})=>{
 await page.goto(directory+'&networkImages&manyCards');await page.getByRole('button',{name:'选样明细 林女士'}).click();
 await expect(page.locator('[data-selected-card]')).toHaveCount(20);
 await expect.poll(()=>page.evaluate(()=>(window as any).sampleImageRequests.flat().length)).toBe(25);
 const firstPageIds=await page.evaluate(()=>(window as any).sampleImageRequests.flat());
 await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.locator('[data-selected-card]')).toHaveCount(5);
 await expect.poll(()=>page.evaluate(()=>(window as any).sampleImageRequests.flat().length)).toBe(30);
 const allIds=await page.evaluate(()=>(window as any).sampleImageRequests.flat());expect(allIds.slice(25).some((id:string)=>firstPageIds.includes(id))).toBe(false);
});
test.beforeEach(async({page})=>{page.on('pageerror',error=>{throw error;});await page.route('https://fabric-card-fixture.invalid/**',route=>{const id=Number(route.request().url().match(/(\d+)\.svg/)?.[1]??1);return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${['#ede5df','#d9e7ec','#e9dce8','#e3e8d8'][id%4]}"/><path d="M0 100Q70 30 120 40" fill="none" stroke="#607369" stroke-width="2"/><circle cx="55" cy="45" r="20" fill="#ae7286"/></svg>`});});});
test('card library directly displays every colorway, keeps different fabrics separate and never opens originals',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-cards.html');const row=page.locator('table tbody tr').first();
 await expect(row.getByRole('img')).toHaveCount(6);await expect(page.getByRole('button',{name:/查看花型/})).toHaveCount(0);
 await row.getByRole('img').first().click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.screenshot({path:'artifacts/card-colorways/library-1440.png',fullPage:true});
});
test('details group six colorways into one card row and show only pattern-colorway numbers at both sizes',async({page})=>{
 for(const width of [1440,360]){await page.setViewportSize({width,height:900});await page.goto(directory);await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();
  await expect(page.locator('[data-selected-card]')).toHaveCount(1);await expect(page.locator('[data-selection-item]')).toHaveCount(6);await expect(page.getByText('G0886-6',{exact:true})).toBeVisible();await expect(page.getByText('G0886-6-F018',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:'artifacts/card-colorways/details-'+width+'.png',fullPage:true});
 }
});
test('manual picker directly shows candidates and selected labels; explicit canceled-color restoration survives failed add',async({page})=>{
 await page.setViewportSize({width:360,height:900});await page.goto(directory);await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();await page.getByRole('button',{name:'人工补选',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'人工补选'});await expect(dialog.getByRole('button',{name:'G0886-F018',exact:true})).toHaveCount(0);
 const selected=dialog.getByRole('checkbox',{name:'配色 G0886-1-F018',exact:true});await expect(selected).toBeVisible();await expect(selected).toBeDisabled();await expect(dialog.getByText('本单已选',{exact:true})).toHaveCount(6);
 const candidate=dialog.getByRole('checkbox',{name:'配色 G0626-1-F018',exact:true});await expect(candidate).not.toBeChecked();await candidate.check();
 await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failNext=true;});await dialog.getByRole('button',{name:'加入色卡 G0626-F018'}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(candidate).toBeChecked();
 await page.screenshot({path:'artifacts/card-colorways/manual-error-360.png',fullPage:true});
 await dialog.getByRole('button',{name:'加入色卡 G0626-F018'}).click();await expect(candidate).toBeDisabled();await expect(dialog.getByRole('status')).toBeVisible();
 await page.screenshot({path:'artifacts/card-colorways/manual-360.png',fullPage:true});
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'人工补选',exact:true})).toBeFocused();await expect(page.locator('[data-selected-card]')).toHaveCount(2);
});
test('ordinary first selection searches by full card number without adding a whole card',async({page})=>{
 await page.goto(directory);await page.getByRole('button',{name:'新建选样单',exact:true}).click();await page.getByRole('button',{name:/林女士.*选择/}).click();
 const trigger=page.getByRole('button',{name:'看图选款',exact:true});await trigger.click();const dialog=page.getByRole('dialog',{name:'人工补选'});
 await expect(dialog.getByRole('checkbox',{name:'配色 G0886-1-F018',exact:true})).not.toBeChecked();
 await expect(dialog.getByText('输入色卡编码',{exact:true})).toHaveCount(0);
 await dialog.getByRole('textbox',{name:'色卡搜索',exact:true}).fill('G0626-F018');await dialog.getByRole('button',{name:'搜索色卡',exact:true}).click();
 await expect(dialog.getByRole('article')).toHaveCount(1);await expect(dialog.getByRole('checkbox',{name:'配色 G0626-1-F018',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.selected.size)).toBe(0);expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.writes.filter((p:string)=>p.endsWith('/scan')).length)).toBe(0);
 await page.screenshot({path:'artifacts/card-colorways/search-picker-1440.png',fullPage:true});
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});
test('same pattern on different fabrics remains separate after manual addition',async({page})=>{
 await page.goto(directory);await page.getByRole('button',{name:'选样明细 林女士',exact:true}).click();await page.evaluate(()=>{(window as any).scanSelectionFixture.addOtherFabric();});await page.getByRole('button',{name:'人工补选',exact:true}).click();const dialog=page.getByRole('dialog',{name:'人工补选'});
 await dialog.getByRole('checkbox',{name:'配色 G0886-1-F025',exact:true}).check();await dialog.getByRole('button',{name:'加入色卡 G0886-F025'}).click();await page.keyboard.press('Escape');
 await expect(page.locator('[data-selected-card]')).toHaveCount(2);await expect(page.getByRole('article',{name:'已选色卡 G0886-F018',exact:true})).toBeVisible();await expect(page.getByRole('article',{name:'已选色卡 G0886-F025',exact:true})).toBeVisible();
 await page.screenshot({path:'artifacts/card-colorways/different-fabrics-1440.png',fullPage:true});
});

test('phone card library shows the whole card row and its colorways without horizontal scrolling',async({page})=>{
 await page.setViewportSize({width:360,height:900});await page.goto('/tools/ui-preview/entries/ui-ux-internal-cards.html');const row=page.locator('tbody tr').first();await expect(row.getByRole('img')).toHaveCount(6);
 const region=page.getByRole('region',{name:'色卡列表，可横向滚动'});expect(await region.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 const last=row.getByRole('figure').last();const bounds=await last.boundingBox();expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(360);await expect(row.getByRole('button',{name:'分享花型产品 G0886-F018'})).toBeVisible();
 await page.screenshot({path:'artifacts/card-colorways/library-360.png',fullPage:true});
});

test('first visual selection failure leaves the modal retryable and cancelable without losing the chosen subset',async({page})=>{
 await page.goto(directory);await page.getByRole('button',{name:'新建选样单',exact:true}).click();await page.getByRole('button',{name:/林女士.*选择/}).click();const trigger=page.getByRole('button',{name:'看图选款',exact:true});await trigger.click();const dialog=page.getByRole('dialog',{name:'人工补选'}),choice=dialog.getByRole('checkbox',{name:'配色 G0626-1-F018',exact:true}),join=dialog.getByRole('button',{name:'加入色卡 G0626-F018'});
 await choice.check();await page.evaluate(()=>{(window as any).scanSelectionFixture.state.failNext=true;});await join.click();await expect(dialog.getByRole('alert')).toContainText('保存未确认');await expect(choice).toBeChecked();await expect(join).toBeEnabled();await expect(dialog.getByRole('button',{name:'关闭人工补选'})).toBeEnabled();
 await join.click();await expect(choice).toBeDisabled();await expect(dialog.getByRole('status')).toContainText('已加入');await page.keyboard.press('Escape');await expect(trigger).toBeFocused();expect(await page.evaluate(()=>(window as any).scanSelectionFixture.state.selected.size)).toBe(1);
});

test('a permanently broken thumbnail stops automatic retries and its manual retry never selects the colorway',async({page})=>{
 await page.setViewportSize({width:360,height:900});let attempts=0;
 await page.route('https://fabric-scan-fixture.invalid/**',route=>{if(route.request().url().includes('000000000100')){attempts++;return route.fulfill({status:403,body:'Unavailable'});}return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>'});});
 await page.goto(directory+'&networkImages');await page.getByRole('button',{name:'选样明细 林女士'}).click();
 const retry=page.getByRole('button',{name:'重试花型 G0886-1 缩略图'});await expect(retry).toBeEnabled();expect(attempts).toBe(2);
 await retry.click();await expect.poll(()=>attempts).toBe(3);await expect(retry).toBeEnabled();
 await expect(page.getByRole('checkbox',{name:'勾选配色 G0886-1，色卡 G0886-F018',exact:true})).not.toBeChecked();
 await page.screenshot({path:'artifacts/sample-detail-fixes/thumbnail-error-360.png',fullPage:true});
});
