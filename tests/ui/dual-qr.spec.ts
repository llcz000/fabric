// AC-165: physical QR first-use switch and browser preference
import {test,expect} from '@playwright/test';
const entry='/tools/ui-preview/entries/ui-ux-dual-qr.html';
test.beforeEach(async({page})=>{
 await page.route('**/api/public/card-scans/**',route=>{
  if(route.request().url().includes('/images/'))return route.fulfill({status:404,body:''});
  return route.fulfill({status:200,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify({available:true,card:{cardNo:'G0886-F018',fabricNo:'F018',fabricName:'轻薄雪纺',composition:'聚酯纤维 100%',weightValue:80,weightUnit:'gsm',widthCm:145,colorways:[{colorwayNo:1,productNo:'G0886-1-F018',displayImages:[],detailImages:[],effectImages:[]},{colorwayNo:2,productNo:'G0886-2-F018',displayImages:[],detailImages:[],effectImages:[]}]}})});
 });
});
test('360px first entry selects public view, remembers preference and allows switching to employee',async({page})=>{
 await page.setViewportSize({width:360,height:800});await page.goto(entry);
 await expect(page.getByRole('main',{name:'色卡使用方式'})).toBeVisible();
 await expect(page.getByRole('button',{name:/查看色卡.*无需登录/})).toBeVisible();
 await expect(page.getByRole('button',{name:/员工选样.*系统账号登录/})).toBeVisible();
 await page.getByRole('button',{name:/查看色卡.*无需登录/}).click();
 await expect(page.getByRole('heading',{name:'G0886-F018'})).toBeVisible();
 await expect(page.getByText('聚酯纤维 100%')).toBeVisible();
 await page.reload();
 await expect(page.getByRole('main',{name:'色卡使用方式'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'G0886-F018'})).toBeVisible();
 await page.getByRole('button',{name:'配色 2'}).click();await expect(page).toHaveURL(/ui-ux-dual-qr\.html$/);
 await page.getByRole('button',{name:'切换用途'}).click();
 await expect(page.getByRole('main',{name:'色卡使用方式'})).toBeVisible();
 await page.getByRole('button',{name:/员工选样.*系统账号登录/}).click();
 await expect(page.getByRole('main',{name:'已进入内部选样流程'})).toBeVisible();
 await page.reload();await expect(page.getByRole('main',{name:'已进入内部选样流程'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 await page.evaluate(()=>{history.pushState({},'','#/stats');window.dispatchEvent(new Event('fabric-route'));});
 await expect(page.getByRole('button',{name:'切换用途'})).toHaveCount(0);
});
test('visitor choice does not render private UI or require an employee login',async({page})=>{
 await page.goto(entry);await page.getByRole('button',{name:/查看色卡.*无需登录/}).click();
 await expect(page.getByRole('main',{name:'已进入内部选样流程'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'G0886-F018'})).toBeVisible();
});
