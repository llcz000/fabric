// AC-12, AC-58, AC-64
import {test,expect} from '@playwright/test';

const path='/tools/ui-preview/entries/ui-ux-internal-patterns.html?deletion-review=1';
const proof='artifacts/deletion-guidance/';
test('sales can check deletion blockers without opening related documents',async({page})=>{
 await page.goto(path+'&sales=1');
 await page.getByRole('button',{name:'删除花型 G0076',exact:true}).click();
 const decision=page.getByRole('alertdialog',{name:'删除花型确认'});
 await expect(decision).toContainText('请联系管理员核对关联单据。');
 await decision.getByRole('button',{name:'查看关联产品'}).click();
 const products=page.getByRole('dialog',{name:'花型关联产品 G0076'});
 await expect(products.getByText('请联系管理员核对关联单据',{exact:true})).toBeVisible();
 await expect(products.getByRole('link',{name:'查看关联单据'})).toHaveCount(0);
 await expect(products.getByRole('link',{name:'去产品库处理'}).first()).toBeVisible();
 await page.screenshot({path:'artifacts/product-document-query/pattern-sales.png'});
});
test('blocked pattern deletion leads to the exact product and its documents',async({page})=>{
 page.on('pageerror',error=>{throw error;});
 await page.goto(path);
 const remove=page.getByRole('button',{name:'删除花型 G0076',exact:true});
 await remove.click();
 const decision=page.getByRole('alertdialog',{name:'删除花型确认'});
 const references=decision.getByRole('button',{name:'查看关联产品'});
 await expect(decision).toContainText('关联 21 款产品，其中 1 款被单据引用');
 await expect(decision.getByRole('button',{name:'确认删除'})).toHaveCount(0);
 await page.screenshot({path:proof+'master-desktop.png'});
 await references.click();
 const products=page.getByRole('dialog',{name:'花型关联产品 G0076'});
 await expect(products.getByRole('link',{name:'查看关联单据'})).toHaveAttribute('href','#/documents?productId=1&refNo=G0076-1-F018');
 await expect(products.getByRole('link',{name:'去产品库处理'}).first()).toHaveAttribute('href','#/products?productId=1&refNo=G0076-1-F018&status=all');
 await page.screenshot({path:proof+'products-desktop.png'});
 await page.keyboard.press('Escape');
 await expect(products).toHaveCount(0);
 await expect(decision).toBeVisible();
 await expect(references).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(decision).toHaveCount(0);
 await expect(remove).toBeFocused();
});

test('360px shows colorway scope and recovers from failed precheck and new references',async({page})=>{
 page.on('pageerror',error=>{throw error;});
 test.setTimeout(60000);
 await page.setViewportSize({width:360,height:900});
 await page.goto(path);
 await page.getByRole('button',{name:'编辑花型及配色 G0076',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'编辑花型 G0076'});
 await editor.getByRole('button',{name:'删除',exact:true}).click();
 const color=page.getByRole('alertdialog',{name:'删除配色确认'});
 await expect(color).toContainText('删除配色 G0076-1');
 await expect(color).toContainText('关联 21 款产品');
 await page.screenshot({path:proof+'colorway-mobile.png'});
 await color.getByRole('button',{name:'查看关联产品'}).click();
 const products=page.getByRole('dialog',{name:'配色关联产品 G0076-1'});
 await expect(products.getByRole('link',{name:'查看关联单据'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
 await page.screenshot({path:proof+'products-mobile.png'});
 await page.keyboard.press('Escape');
 await page.keyboard.press('Escape');
 await expect(editor).toBeVisible();
 await editor.getByRole('button',{name:'关闭配色编辑'}).click();
 const decision=page.getByRole('alertdialog',{name:'删除花型确认'});
 await page.getByRole('button',{name:'更多操作 G0072',exact:true}).click();
 await page.getByRole('button',{name:'删除花型 G0072',exact:true}).click();
 await expect(decision).toContainText('1 张有效色卡');
 await expect(decision.getByRole('link',{name:'去色卡库核对'})).toHaveAttribute('href','#/cards?query=G0072');
 await expect(decision.getByRole('button',{name:'确认删除'})).toHaveCount(0);
 await decision.getByRole('button',{name:'关闭'}).click();
 await page.getByRole('button',{name:'更多操作 G0073',exact:true}).click();
 await page.getByRole('button',{name:'删除花型 G0073',exact:true}).click();
 await expect(decision.getByRole('alert')).toContainText('关联检查失败');
 await expect(decision.getByRole('button',{name:'确认删除'})).toHaveCount(0);
 await decision.getByRole('button',{name:'重试'}).click();
 await expect(decision.getByRole('button',{name:'确认删除'})).toBeEnabled();
 await decision.getByRole('button',{name:'取消'}).click();
 await page.getByRole('button',{name:'更多操作 G0074',exact:true}).click();
 await page.getByRole('button',{name:'删除花型 G0074',exact:true}).click();
 await decision.getByRole('button',{name:'确认删除'}).click();
 await expect(decision.getByRole('alert')).toContainText('重新检查');
 await expect(decision).toContainText('关联 1 款产品，其中 1 款被单据引用');
 await expect(decision.getByRole('button',{name:'确认删除'})).toHaveCount(0);
 await decision.getByRole('button',{name:'关闭'}).click();
});

for(const width of [1440,360]){
 test('whole pattern deletion keeps the toast in view and clears it ('+width+'px)',async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto(path);
  if(width===360)await page.getByRole('button',{name:'更多操作 G0075',exact:true}).click();
  const unreferenced=page.getByRole('button',{name:'删除花型 G0075',exact:true});
  await unreferenced.click();
  await page.getByRole('alertdialog',{name:'删除花型确认'}).getByRole('button',{name:'确认删除'}).click();
  const message='整个花型 G0075 及全部配色已删除。';
  const toast=page.getByRole('region',{name:'操作提示'}).getByText(message,{exact:true});
  await expect(toast).toBeInViewport();
  await page.screenshot({path:proof+'pattern-delete-toast-'+width+'.png'});
  await expect(unreferenced).toHaveCount(0);
  await expect(page.getByRole('region',{name:'V2 花型库'}).getByText(message,{exact:true})).toHaveCount(0);
  await expect(toast).toHaveCount(0);
 });
}
