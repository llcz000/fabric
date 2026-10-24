import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
for(const mobile of [false,true]){
 test('fabric import template + actual 79-row workbook '+(mobile?'mobile':'desktop'),async({page})=>{
  test.skip(!existsSync('.local/test-inputs/fabric-import-user.xlsx'),'Local authorized workbook is absent; never commit customer input');
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});
  await page.goto('/ui-ux-internal-fabrics.html?import=1');
  await expect(page.getByRole('heading',{name:'模板示例'})).toBeVisible();
  await expect(page.getByLabel('品号来源列')).toHaveCount(0);
  await expect(page.getByLabel('工作表',{exact:true})).toHaveCount(0);
  await page.screenshot({path:'artifacts/ui-ux-pilot/fabric-import-template-'+(mobile?'mobile':'desktop')+'.png'});
  await page.getByLabel('选择XLSX文件').setInputFiles('.local/test-inputs/fabric-import-user.xlsx');
  await page.getByRole('button',{name:'生成预览',exact:true}).click();
  await expect(page.getByText(/新增 79 · 默认跳过 0 · 错误 0/)).toBeVisible();
  const region=page.locator('[role="region"]');
  await expect(region.locator('tbody tr')).toHaveCount(79);
  await expect(region).toContainText('10151-8');
  await expect(region).toContainText('12 mm');
  await expect(region).toContainText('165 gsm');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.screenshot({path:'artifacts/ui-ux-pilot/fabric-import-preview-'+(mobile?'mobile':'desktop')+'.png'});
 });
}
