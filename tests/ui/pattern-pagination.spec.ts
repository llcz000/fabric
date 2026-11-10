import {test,expect} from '@playwright/test';
test('both pattern pagination bars jump directly and stay in sync',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-patterns.html');
 const top=page.getByRole('navigation',{name:'花型列表顶部分页',exact:true});
 const bottom=page.getByRole('navigation',{name:'花型分页',exact:true});
 const rows=page.getByRole('table',{name:'花型母版列表'}).getByRole('row');
 await expect(top).toContainText('第 1 / 4 页');
 await expect(bottom).toContainText('第 1 / 4 页');
 await page.screenshot({path:'artifacts/library-pagination/pattern-360.png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 const input=top.getByRole('textbox',{name:'目标页码'});
 await input.fill('5');
 await input.press('Enter');
 await expect(top.getByRole('alert')).toHaveText('请输入 1–4 之间的整数页码');
 await expect(input).toBeFocused();
 await expect(bottom).toContainText('第 1 / 4 页');
 await input.press('Escape');
 await expect(input).toHaveValue('');
 await expect(top.getByRole('alert')).toHaveCount(0);
 await input.fill('4');
 await input.press('Enter');
 await expect(top).toContainText('第 4 / 4 页');
 await expect(bottom).toContainText('第 4 / 4 页');
 await expect(rows).toHaveCount(17);
 await expect(bottom.getByRole('button',{name:'下一页'})).toBeDisabled();
 await bottom.scrollIntoViewIfNeeded();
 await page.screenshot({path:'artifacts/library-pagination/pattern-bottom-360.png'});
 await bottom.getByRole('textbox',{name:'目标页码'}).fill('2');
 await bottom.getByRole('button',{name:'跳转'}).click();
 await expect(top).toContainText('第 2 / 4 页');
 await expect(bottom).toContainText('第 2 / 4 页');
 await expect(rows).toHaveCount(21);
 await page.getByRole('textbox',{name:'搜索编号'}).fill('G0001');
 await expect(top).toContainText('第 1 / 1 页');
 await expect(bottom).toContainText('第 1 / 1 页');
 await expect(bottom.getByRole('button',{name:'跳转'})).toBeDisabled();
});

test('76 masters / 144 versions: all four pages complete and unique, last-page controls and filtering reset',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-patterns.html');
 const footer=page.getByRole('navigation',{name:'花型分页'});
 await expect(footer).toContainText('共 76 个花型 · 144 个配色');
 await expect(footer).toContainText('第 1 / 4 页');
 await expect(footer.getByRole('button',{name:'上一页'})).toBeDisabled();
 await page.screenshot({path:'artifacts/library-pagination/pattern-1440.png'});
 await page.screenshot({path:'artifacts/ui-ux-pilot/pattern-pagination-first.png',fullPage:true});
 const masters=new Set<string>(),versions=new Set<string>();
 for(let i=1;i<=4;i++){
  await expect(footer).toContainText('第 '+i+' / 4 页');
  const rows=page.getByRole('table',{name:'花型母版列表'}).getByRole('row');
  await expect(rows).toHaveCount(i===4?17:21);
  for(const name of await rows.locator('[role=cell]:first-child strong').allTextContents()){expect(masters.has(name)).toBeFalsy();masters.add(name);}
  for(const name of await page.locator('strong[title]').allTextContents()){expect(versions.has(name)).toBeFalsy();versions.add(name);}
  if(i<4)await footer.getByRole('button',{name:'下一页'}).click();
 }
 expect(masters.size).toBe(76);expect(versions.size).toBe(144);
 await expect(footer.getByRole('button',{name:'下一页'})).toBeDisabled();
 await page.screenshot({path:'artifacts/ui-ux-pilot/pattern-pagination-last.png',fullPage:true});
 await page.getByRole('textbox',{name:'搜索编号'}).fill('G0001');
 await expect(footer).toContainText('共 1 个花型 · 2 个配色');
 await expect(footer).toContainText('第 1 / 1 页');
});
test('out-of-range page recovers after concurrent catalog shrink',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-patterns.html?shrink=1');
 const footer=page.getByRole('navigation',{name:'花型分页'});
 for(let i=1;i<=3;i++){await expect(footer).toContainText('第 '+i+' / 4 页');await footer.getByRole('button',{name:'下一页'}).click();}
 await expect(footer).toContainText('共 2 个花型');
 await expect(footer).toContainText('第 1 / 1 页');
 await expect(page.getByRole('table',{name:'花型母版列表'}).getByRole('row')).toHaveCount(3);
});

test('bulk import explains replacement and a failed lower colorway does not block the next image',async({page})=>{
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-patterns.html');
 await page.getByRole('button',{name:'导入花型库',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'批量导入花型库'});
 await expect(dialog).toContainText('已删除编号可复用');
 await expect(dialog).toContainText('已有同编号将替换图片');
 await dialog.getByLabel('选择多个文件').setInputFiles([
  {name:'G0008-1.jpg',mimeType:'image/jpeg',buffer:Buffer.from('bad')},
  {name:'G0008-2.jpg',mimeType:'image/jpeg',buffer:Buffer.from('ok')},
 ]);
 await page.screenshot({path:'artifacts/ui-ux-pilot/pattern-import-replacement.png',fullPage:true});
 await dialog.getByRole('button',{name:'开始导入 2 张'}).click();
 await expect(dialog).toContainText('成功 1 张，失败 1 张，暂停 0 张');
 await expect(dialog).toContainText('G0008-2');
 await page.screenshot({path:'artifacts/ui-ux-pilot/pattern-import-continues.png',fullPage:true});
});
