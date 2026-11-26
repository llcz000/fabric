import {expect, test} from '@playwright/test';

const entry = '/tools/ui-preview/entries/ui-ux-internal-patterns.html?dimensions=1&gallery=1&image-variants=1';
const review = '/tools/ui-preview/entries/ui-ux-internal-patterns.html?dimensions=1&grid-review=1&start-grid=1';
const evidence = 'artifacts/pattern-image-grid/';
type GridRequest = {path:string;variant?:string;ids?:string[]};

for(const {width,columns} of [{width:1440,columns:10},{width:1280,columns:10},{width:360,columns:2}]){
 // AC-178
 test(width+'px 下平铺列数正确，滚动后仍可搜索和筛选',async({page})=>{
  await page.setViewportSize({width,height:720});
  await page.goto(review+'&shell=1&grid-large=1');
  const grid=page.getByRole('list',{name:'花型配色图片'});
  const filterbar=page.getByRole('search',{name:'花型筛选'});
  const search=filterbar.getByRole('textbox',{name:'搜索编号'});
  await expect(grid.getByRole('button',{name:'查看花型原图 G2000-1'})).toBeVisible();
  expect(await grid.evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(columns);
  await expect.poll(async()=>{
   await page.evaluate(()=>window.scrollTo(0,420));
   return page.evaluate(()=>window.scrollY);
  }).toBeGreaterThan(200);
  await expect.poll(async()=>Math.round((await filterbar.boundingBox())!.y)).toBe(0);
  await expect(search).toBeInViewport();
  expect(await search.evaluate(element=>{
   const {x,y,width,height}=element.getBoundingClientRect();
   return document.elementFromPoint(x+width/2,y+height/2)===element;
  })).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const trigger=filterbar.getByRole('button',{name:/^题材标签/});
  await trigger.click();
  const topic=page.getByRole('button',{name:'油画花卉',exact:true});
  await expect(topic).toBeInViewport();
  await page.screenshot({path:'artifacts/pattern-grid-toolbar/sticky-topic-'+width+'.png'});
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.screenshot({path:'artifacts/pattern-grid-toolbar/sticky-'+width+'.png'});
  await search.fill('G0001-1');
  await expect(grid.getByRole('listitem')).toHaveCount(1);
  await expect(grid.getByRole('button',{name:'查看花型原图 G0001-1'})).toBeVisible();
  await filterbar.getByRole('button',{name:'列表',exact:true}).click();
  await expect(search).toHaveValue('G0001-1');
 });
}

// AC-178
test('看图按配色展示，预览关闭后原位继续，并保留列表查询条件', async ({page}) => {
 await page.route('https://fabric-related-fixture.invalid/**', route => route.fulfill({
  contentType:'image/svg+xml',
  body:'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72"><rect width="96" height="72" fill="#38685a"/></svg>',
 }));
 await page.goto(entry);
 const search = page.getByRole('textbox', {name:'搜索编号'});
 await search.fill('G0068');
 await page.getByRole('button', {name:'看图', exact:true}).click({timeout:2500});
 const grid = page.getByRole('list', {name:'花型配色图片'});
 await expect(grid.getByRole('listitem')).toHaveCount(2);
 await expect(page.getByRole('navigation', {name:'花型分页', exact:true})).toHaveCount(0);
 const tile = grid.getByRole('button', {name:'查看花型原图 G0068-1'});
 await tile.click();
 const original = page.getByRole('dialog', {name:'花型原图 G0068-1'});
 await expect(original.getByRole('button', {name:'复制配色号'})).toBeVisible();
 await original.getByRole('button', {name:'关联产品'}).click();
 const linked = page.getByRole('dialog', {name:'配色关联产品 G0068-1'});
 await expect(linked.getByText('暂无关联产品')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(original.getByRole('button', {name:'关联产品'})).toBeFocused();
 await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('dialog', {name:'花型原图 G0068-2'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(tile).toBeFocused();
 await page.getByRole('button', {name:'列表', exact:true}).click();
 await expect(search).toHaveValue('G0068');
 await expect(page.getByRole('navigation', {name:'花型分页', exact:true})).toBeVisible();
});

for (const width of [1440, 360]) {
 // AC-178
 test('看图、配色号、关联产品和窄屏布局 '+width+'px', async ({page}) => {
  await page.setViewportSize({width,height:width===1440?900:800});
  await page.addInitScript(() => {
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{
    sessionStorage.setItem('pattern-review-clipboard',value);
   }}});
  });
  await page.goto(review);
  const grid=page.getByRole('list',{name:'花型配色图片'});
  const tile=grid.getByRole('button',{name:'查看花型原图 G0076-1'});
  await tile.getByRole('img').evaluate((image:HTMLImageElement)=>image.decode());
  const first = grid.getByRole('listitem').nth(0);
  const second = grid.getByRole('listitem').nth(1);
  const firstRect = await first.boundingBox(), secondRect = await second.boundingBox();
  expect(firstRect?.y).toBe(secondRect?.y);
  expect(secondRect!.x).toBeGreaterThan(firstRect!.x);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:evidence+'grid-'+width+'.png'});
  await tile.click();
  const original=page.getByRole('dialog',{name:'花型原图 G0076-1'});
  await original.getByRole('img',{name:'花型原图 G0076-1'}).evaluate((image:HTMLImageElement)=>image.decode());
  await original.getByRole('button',{name:'复制配色号'}).click();
  await expect(original.getByText('配色号已复制')).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('pattern-review-clipboard'))).toBe('G0076-1');
  await page.screenshot({path:evidence+'original-'+width+'.png'});
  await original.getByRole('button',{name:'关联产品'}).click();
  const linked=page.getByRole('dialog',{name:'配色关联产品 G0076-1'});
  for (const suffix of ['F018','F032']) {
   const row=linked.getByRole('row').filter({hasText:'G0076-1-'+suffix});
   await expect(row).toBeVisible();
   await expect(row.getByRole('link',{name:'查看产品'})).toHaveAttribute('href',/productId=/);
  }
  await page.screenshot({path:evidence+'products-'+width+'.png'});
  await page.keyboard.press('Escape');
  await expect(original.getByRole('button',{name:'关联产品'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(tile).toBeFocused();
 });
}

// AC-178
test('后续批次失败保留已浏览图片，修改题材和排序后继续读取新条件',async({page})=>{
 await page.goto(review+'&grid-page-error=1');
 const grid=page.getByRole('list',{name:'花型配色图片'});
 await expect(grid.getByRole('listitem').first()).toHaveText('G0076-1');
 await grid.getByRole('listitem').last().scrollIntoViewIfNeeded();
 const error=page.getByRole('alert').filter({hasText:'花型加载失败'});
 await expect(error).toBeVisible();
 const count=await grid.getByRole('listitem').count();
 await error.getByRole('button',{name:'重试'}).click();
 await expect.poll(()=>grid.getByRole('listitem').count()).toBeGreaterThan(count);
 await expect(grid.getByRole('listitem').first()).toHaveText('G0076-1');
 const sort=page.getByRole('combobox',{name:'花型排序'});
 await sort.selectOption('numberAsc');
 await expect(grid.getByRole('listitem').first()).toHaveText('G0001-1');
 await page.getByRole('button',{name:/^题材标签/}).click();
 await page.getByRole('button',{name:'油画花卉',exact:true}).click();
 await page.keyboard.press('Escape');
 await expect(grid.getByRole('listitem').nth(2)).toHaveText('G0003-1');
 await page.getByRole('button',{name:'列表',exact:true}).click();
 await expect(page.getByRole('columnheader',{name:/花型号/})).toHaveAttribute('aria-sort','ascending');
 await expect(page.getByRole('button',{name:/^题材标签.*1/})).toBeVisible();
});

// AC-178
test('单张缩略图解码失败后可单独重试',async({page})=>{
 await page.goto(review+'&grid-thumbnail-error=1');
 const retry=page.getByRole('button',{name:'重试缩略图 G0076-1'});
 await expect(retry).toBeVisible();
 const neighboring=page.getByRole('button',{name:'查看花型原图 G0075-1'}).getByRole('img');
 await neighboring.evaluate((image:HTMLImageElement)=>image.decode());
 await retry.click();
 await page.getByRole('button',{name:'查看花型原图 G0076-1'}).getByRole('img')
  .evaluate((image:HTMLImageElement)=>image.decode());
 await expect(retry).toHaveCount(0);
});

// AC-178
test('2,000 个母版首屏按需取图，滚动跨批无重复配色，精确配色可核对同母版',async({page})=>{
 await page.goto(review+'&grid-large=1');
 const grid=page.getByRole('list',{name:'花型配色图片'});
 await expect(grid.getByRole('button',{name:'查看花型原图 G2000-1'})).toBeVisible();
 const readRequests=()=>page.evaluate(()=>((window as Window & {gridRequests?:GridRequest[]}).gridRequests??[]).slice());
 // Allow enough pages to fill the viewport and its scroll lookahead at the chosen density.
 const initialTileBudget=await grid.evaluate(element=>{
  const style=getComputedStyle(element);
  const columns=style.gridTemplateColumns.split(' ').length;
  const rowHeight=element.firstElementChild!.getBoundingClientRect().height+parseFloat(style.rowGap);
  return (Math.ceil((innerHeight+300)/rowHeight)+1)*columns;
 });
 const initial=await readRequests();
 const initialPages=initial.filter(item=>item.path.startsWith('/api/v2/pattern-catalog?'))
  .map(item=>new URLSearchParams(item.path.split('?')[1]));
 expect(initialPages.length).toBeGreaterThan(0);
 expect(initialPages.every(query=>query.get('limit')==='20')).toBe(true);
 expect(initialPages.length).toBeLessThanOrEqual(1+Math.ceil(initialTileBudget/20));
 expect(initial.some(item=>item.variant==='original'||item.path.startsWith('/api/v2/products?'))).toBe(false);
 const gridEnd=page.locator('.pattern-grid-end');
 for (let i=0;i<3;i++){
  const count=await grid.getByRole('listitem').count();
  await gridEnd.scrollIntoViewIfNeeded();
  await expect.poll(()=>grid.getByRole('listitem').count()).toBeGreaterThan(count);
 }
 const codes=await grid.locator('.pattern-image-code').allTextContents();
 expect(new Set(codes).size).toBe(codes.length);
 expect(codes[0]).toBe('G2000-1');
 const afterScroll=await readRequests();
 const gridThumbnails=afterScroll.filter(item=>item.variant==='thumbnail').slice(1);
 expect(gridThumbnails.length).toBeGreaterThan(0);
 expect(gridThumbnails.every(item=>item.ids!.length<=48)).toBe(true);
 expect(afterScroll.some(item=>item.variant==='original')).toBe(false);
 await page.getByRole('textbox',{name:'搜索编号'}).fill('G0001-2');
 const hit=grid.getByRole('button',{name:'查看花型原图 G0001-2'});
 await expect(grid.getByRole('listitem')).toHaveCount(1);
 await hit.click();
 await page.getByRole('button',{name:'上一配色原图'}).click();
 await expect(page.getByRole('dialog',{name:'花型原图 G0001-1'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(hit).toBeFocused();
});
