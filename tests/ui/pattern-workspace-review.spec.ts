import {expect,test} from '@playwright/test';

const entry='/tools/ui-preview/entries/ui-ux-internal-patterns.html';
const proof='artifacts/pattern-workspace-review/';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfU0AAAAASUVORK5CYII=','base64');

test('canceling a new master preserves list state and restores focus',async({page})=>{
 await page.goto(entry+'?dimensions=1');
 const number=page.getByRole('textbox',{name:'搜索编号'});
 await number.fill('G00');
 await page.getByRole('button',{name:'按花型号排序 升序'}).click();
 const list=page.getByRole('navigation',{name:'花型列表顶部分页'});
 await list.getByRole('textbox',{name:'目标页码'}).fill('2');
 await list.getByRole('textbox',{name:'目标页码'}).press('Enter');
 await expect(list).toContainText('第 2 / 4 页');
 const create=page.getByRole('button',{name:'新增花型'});
 await create.click();
 await page.getByRole('dialog',{name:'新增花型'}).getByRole('textbox',{name:'花型编号'}).fill('G9999');
 await page.keyboard.press('Escape');
 await page.getByRole('alertdialog').getByRole('button',{name:'确认关闭'}).click();
 await expect(create).toBeFocused();
 await expect(number).toHaveValue('G00');
 await expect(list).toContainText('第 2 / 4 页');
 await expect(page.getByRole('columnheader').first()).toHaveAttribute('aria-sort','ascending');
 await page.screenshot({path:proof+'desktop.png'});
});

test('topic filter returns focus and separates custom maintenance',async({page})=>{
 await page.goto(entry+'?dimensions=1');
 const trigger=page.getByRole('button',{name:/^题材标签/});
 await trigger.click();
 await page.getByRole('button',{name:'油画花卉',exact:true}).focus();
 await page.keyboard.press('Escape');
 await expect(trigger).toBeFocused();
 await expect(trigger).toHaveAttribute('aria-expanded','false');
 await trigger.click();
 await expect(page.getByRole('button',{name:'已归档题材',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'管理自定义题材'}).click();
 await expect(page.getByRole('button',{name:'删除自定义题材 已归档题材'})).toBeEnabled();
 await expect(page.getByRole('textbox',{name:'添加自定义题材'})).toBeVisible();
 await expect(page.getByRole('button',{name:'油画花卉',exact:true})).toHaveCount(0);
 await page.getByRole('textbox',{name:'搜索编号'}).click();
 await expect(trigger).toHaveAttribute('aria-expanded','false');
});

test('mobile shows relevant actions and a failed upload preview can be retried without losing draft',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 let broken=true;
 await page.route('https://fabric-related-fixture.invalid/**',route=>route.fulfill({
  status:200,contentType:'image/svg+xml',
  body:broken?'invalid image':'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="teal"/></svg>'
 }));
 await page.goto(entry+'?dimensions=1&linkedImages=1&gallery=1&image-variants=1');
 const table=page.getByRole('table',{name:'花型母版列表'});
 await expect(page.getByRole('button',{name:'查看 G0076 关联产品 21 个'})).toBeInViewport();
 await expect(page.getByRole('button',{name:'编辑花型及配色 G0076'})).toBeInViewport();
 expect(await table.evaluate(node=>node.scrollWidth)).toBeLessThanOrEqual(360);
 await page.screenshot({path:proof+'mobile.png'});
 await page.setViewportSize({width:390,height:800});
 await expect(page.getByRole('button',{name:'查看 G0076 关联产品 21 个'})).toBeInViewport();
 expect(await table.evaluate(node=>node.scrollWidth)).toBeLessThanOrEqual(390);
 await page.setViewportSize({width:360,height:800});
 await page.getByRole('button',{name:'编辑花型及配色 G0076'}).click();
 const editor=page.getByRole('dialog',{name:'编辑花型 G0076'});
 await editor.getByRole('button',{name:'添加配色'}).click();
 const save=editor.getByRole('button',{name:'保存新配色'});
 await expect(save).toBeInViewport();
 await editor.getByRole('textbox',{name:'新版本备注'}).fill('保留备注');
 await editor.locator('input[aria-label="新配色花型图"]').setInputFiles({name:'color.png',mimeType:'image/png',buffer:png});
 await expect(editor.getByRole('alert')).toContainText('缩略图无法显示');
 await expect(save).toBeDisabled();
 await page.screenshot({path:proof+'mobile-upload-error.png'});
 broken=false;
 await editor.getByRole('button',{name:'重试图片'}).click();
 await expect(editor.getByRole('img',{name:'新配色花型图'})).toBeVisible();
 await expect(editor.getByRole('textbox',{name:'新版本备注'})).toHaveValue('保留备注');
 await save.click();
 await expect(editor.getByText('G0076-3',{exact:true})).toBeVisible();
 await editor.getByRole('button',{name:'关闭配色编辑'}).click();
 await page.getByRole('button',{name:'编辑花型及配色 G0076'}).click();
 const original=editor.getByRole('button',{name:'查看花型原图 G0076-3'});
 await expect(original).toBeVisible();
 broken=true;
 await original.click();
 const viewer=page.getByRole('dialog',{name:'花型原图 G0076-3'});
 await expect(viewer.getByRole('alert')).toContainText('原图无法显示');
 await page.screenshot({path:proof+'mobile-original-error.png'});
 broken=false;
 await viewer.getByRole('button',{name:'重试原图'}).click();
 await expect.poll(()=>viewer.getByRole('img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(64);
 await page.keyboard.press('Escape');
 await expect(original).toBeFocused();
});

test('batch previews exact existing targets and retries only failed files',async({page})=>{
 await page.goto(entry+'?retry-import');
 await page.getByRole('button',{name:'导入花型库'}).click();
 const dialog=page.getByRole('dialog',{name:'批量导入花型库'});
 await dialog.getByLabel('选择多个文件').setInputFiles(['G0008-1.png','G9000-2.png','无编号.png'].map(name=>({name,mimeType:'image/png',buffer:png})));
 await expect(dialog).toContainText('新增 1 张 · 替换 1 张');
 await expect(dialog.getByRole('list',{name:'导入预览'})).toContainText('替换 G0008-1.png');
 await expect(dialog.getByRole('list',{name:'无法导入的文件'})).toContainText('无编号.png');
 await page.screenshot({path:proof+'desktop-import.png'});
 await dialog.getByRole('button',{name:'开始导入 2 张'}).click();
 await expect(dialog).toContainText('成功 1 张，失败 1 张，暂停 0 张');
 await dialog.getByRole('button',{name:'仅重试失败 1 张'}).click();
 await expect(dialog).toContainText('成功 2 张，失败 0 张，暂停 0 张');
});
