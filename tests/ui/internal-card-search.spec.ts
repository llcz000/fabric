import {test,expect} from '@playwright/test';
test('real internal card list search supports clear button and Escape without losing input focus',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-cards.html',{waitUntil:'domcontentloaded'});
 const search=page.getByRole('searchbox',{name:'查找色卡'});
 await expect(search).toBeVisible();
 await expect(page.locator('table tbody tr')).toHaveCount(3);
 await search.fill('NO-CARD');
 await expect(page.getByText('没有匹配的色卡')).toBeVisible();
 await expect(page.getByRole('button',{name:'清空色卡搜索'})).toBeVisible();
 await page.getByRole('button',{name:'清空色卡搜索'}).click();
 await expect(search).toHaveValue('');
 await expect(search).toBeFocused();
 await expect(page.locator('table tbody tr')).toHaveCount(3);
 await search.fill('WRONG');
 await search.press('Escape');
 await expect(search).toHaveValue('');
 await expect(search).toBeFocused();
 await expect(page.locator('table tbody tr')).toHaveCount(3);
 await expect(page.getByRole('button',{name:'清空色卡搜索'})).toHaveCount(0);
 await expect(page.locator('table thead button[title*="排序"]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'列设置'})).toBeVisible();
 await expect(page.getByRole('button',{name:'分享花型产品 G0886-F018'})).toBeVisible();
});
test('real color-card table keeps modest fabric name width, 4 actions separated and no header sorting',async({page})=>{
 for(const viewport of [1440,1024,800]){
  await page.setViewportSize({width:viewport,height:900});
  await page.goto('/tools/ui-preview/entries/ui-ux-internal-cards.html',{waitUntil:'domcontentloaded'});
  const row=page.locator('table tbody tr').first();
  await expect(row).toBeVisible();
  await expect(page.getByRole('button',{name:'列设置'})).toBeVisible();
  await expect(page.locator('table thead button')).toHaveCount(0);
  const nameCell=row.locator('td').nth(2);
  const nameWidth=await nameCell.evaluate(el=>el.getBoundingClientRect().width);
  expect(nameWidth).toBeLessThanOrEqual(185);
  const actions=row.locator('td.col-actions');
  const names=['放大色卡二维码','查看花型','分享花型产品','删除色卡'];
  const buttons=await actions.locator('button').all();
  expect(buttons.length).toBe(4);
  const boxes=[];
  for(let i=0;i<buttons.length;i++){
   await expect(buttons[i]).toHaveAttribute('aria-label',new RegExp(names[i]));
   const rect=await buttons[i].boundingBox();
   expect(rect).not.toBeNull();
   expect(rect!.width).toBeGreaterThanOrEqual(35);
   boxes.push(rect!);
  }
  for(let i=1;i<boxes.length;i++)expect(boxes[i].x-(boxes[i-1].x+boxes[i-1].width)).toBeGreaterThanOrEqual(5);
  const cell=await actions.boundingBox();
  expect(cell!.width).toBeGreaterThanOrEqual(198);
  expect(boxes[0].x).toBeGreaterThanOrEqual(cell!.x);
  expect(boxes.at(-1)!.x+boxes.at(-1)!.width).toBeLessThanOrEqual(cell!.x+cell!.width+1);
  if(viewport===1440){
   await page.screenshot({path:'artifacts/ui-ux-pilot/card-library-corrected-desktop.png',fullPage:true});
  }
 }
});
test('actual color-card column settings keep original interaction and preserve mandatory actions',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-cards.html',{waitUntil:'domcontentloaded'});
 const trigger=page.getByRole('button',{name:'列设置'});
 await trigger.click();
 const panel=page.getByRole('group',{name:'列显示设置'});
 await expect(panel).toBeVisible();
 const toggle=panel.getByRole('checkbox',{name:'成分'});
 await toggle.uncheck();
 await expect(page.getByRole('columnheader',{name:'成分'})).toHaveCount(0);
 await expect(page.getByRole('columnheader',{name:'操作'})).toBeVisible();
 await expect(page.locator('td.col-actions button').first()).toBeVisible();
 await toggle.focus();await page.keyboard.press('Escape');
 await expect(trigger).toBeFocused();
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.getByRole('columnheader',{name:'成分'})).toHaveCount(0);
 await trigger.click();
 await panel.getByRole('button',{name:'恢复默认列'}).click();
 await expect(page.getByRole('columnheader',{name:'成分'})).toBeVisible();
 await expect(trigger).toBeFocused();
});

test('page and modal visual review: remove redundant copy and use compact accessible dismiss buttons',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-cards.html',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'实体色卡',exact:true})).toBeVisible();
 await expect(page.getByText('列表与Excel导出')).toHaveCount(0);
 await expect(page.getByText('一张色卡由一个花型母版与一种面料品号唯一绑定')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'新增色卡'})).toBeVisible();
 await page.screenshot({path:'artifacts/ui-ux-pilot/card-library-design-review-desktop.png',fullPage:true});
 const qrTrigger=page.getByRole('button',{name:'放大色卡二维码 G0886-F018'});
 await qrTrigger.click();
 const qr=page.getByRole('dialog',{name:'色卡二维码 G0886-F018'});
 await expect(qr.getByRole('button',{name:'关闭二维码'})).toBeVisible();
 await expect(qr.getByRole('button',{name:'关闭二维码'})).not.toContainText('关闭');
 await page.screenshot({path:'artifacts/ui-ux-pilot/card-library-design-review-qr.png'});
 await qr.getByRole('button',{name:'关闭二维码'}).click();
 await expect(qrTrigger).toBeFocused();
 const viewTrigger=page.getByRole('button',{name:'查看花型 G0886-F018'});
 await viewTrigger.click();
 const viewer=page.getByRole('dialog',{name:'色卡关联花型 G0886-F018'});
 await expect(viewer.getByRole('button',{name:'关闭花型预览'})).toBeVisible();
 await expect(viewer.getByRole('button',{name:'关闭花型预览'})).not.toContainText('关闭');
 await page.screenshot({path:'artifacts/ui-ux-pilot/card-library-design-review-view.png'});
 await page.keyboard.press('Escape');
 await expect(viewer).toBeHidden();
 await expect(viewTrigger).toBeFocused();
 const shareTrigger=page.getByRole('button',{name:'分享花型产品 G0886-F018'});
 await shareTrigger.click();
 const share=page.getByRole('dialog',{name:'分享色卡花型产品'});
 await expect(share.getByRole('button',{name:'关闭分享'})).toBeVisible();
 await expect(share.getByRole('button',{name:'关闭分享'})).not.toContainText('关闭');
 // Local HTTP preview intentionally rejects public HTTPS share URLs; verify the safe failure state.
 await expect(share.getByRole('alert')).toContainText('色卡分享链接读取失败');
 await page.screenshot({path:'artifacts/ui-ux-pilot/card-library-design-review-share.png'});
 await share.getByRole('button',{name:'关闭分享'}).click();
 await expect(shareTrigger).toBeFocused();
 const deleteTrigger=page.getByRole('button',{name:'删除色卡 G0886-F018'});
 await deleteTrigger.click();
 const confirm=page.getByRole('alertdialog',{name:'删除色卡？'});
 await expect(confirm.getByRole('button',{name:'取消'})).toBeVisible();
 await expect(confirm.getByRole('button',{name:'确认删除'})).toBeVisible();
 await page.screenshot({path:'artifacts/ui-ux-pilot/card-library-design-review-delete.png'});
 await confirm.getByRole('button',{name:'取消'}).click();
 await expect(deleteTrigger).toBeFocused();
});
test('compact heading and actions remain usable on narrow internal viewport',async({page})=>{
 await page.setViewportSize({width:390,height:820});
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-cards.html',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'实体色卡'})).toBeVisible();
 await expect(page.getByRole('searchbox',{name:'查找色卡'})).toBeVisible();
 await expect(page.getByRole('button',{name:'新增色卡'})).toBeVisible();
 const width=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 expect(width.scroll).toBeLessThanOrEqual(width.client+1);
 await page.screenshot({path:'artifacts/ui-ux-pilot/card-library-design-review-mobile.png',fullPage:true});
});
