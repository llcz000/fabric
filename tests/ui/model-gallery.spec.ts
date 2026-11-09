import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
const entry='/tools/ui-preview/entries/ui-ux-model-gallery.html';
const art='artifacts/ui-ux-pilot';
test.beforeEach(async({page})=>{
 page.on('pageerror',err=>{throw err;});
 await page.route('**/__fixtures__/model-upload',route=>route.fulfill({status:200,body:''}));
 await page.route('https://fabric-model-preview.invalid/**',route=>{
  const mixed=new URL(page.url()).searchParams.get('layout')==='mixed';
  const shape=mixed?(route.request().url().includes('cccccccc')?'wide':route.request().url().includes('dddddddd')?'square':'tall'):new URL(page.url()).searchParams.get('shape');
  const [w,h]=route.request().url().includes('/thumbnail.')?[320,320]:shape==='wide'?[420,210]:shape==='square'?[280,280]:[210,420];
  return route.fulfill({contentType:'image/svg+xml',body:
   `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 210 420"><rect width="210" height="420" fill="#f1eeeb"/><path d="M98 30H112L130 60L148 210L162 390H50L62 210L80 60Z" fill="#d8caba" stroke="#8b7b6b" stroke-width="4"/><rect x="2" y="2" width="206" height="416" fill="none" stroke="#346ef6" stroke-width="4"/></svg>`});
 });
});

test('model import reports success and partial failure only in dismissible toast notifications',async({page})=>{
 for(const partial of [false,true]){
  await page.setViewportSize({width:partial?360:1440,height:800});
  await page.goto(entry+(partial?'?import=partial':''));
  await expect(page.getByText('M00002')).toBeVisible();
  const file={name:'model.png',mimeType:'image/png',buffer:Buffer.from('test image')};
  await page.getByLabel('上传模特图片').setInputFiles(partial?[file,{...file,name:'second.png'}]:[file]);
  const toast=page.getByRole('region',{name:'操作提示'});
  await expect(toast.getByRole('status')).toContainText(partial?'已导入 1 / 2 张':'已导入 1 / 1 张');
  if(partial)await expect(toast).toContainText('second.png');
  await expect(page.getByRole('region',{name:'模特图库'}).getByRole('status')).toHaveCount(0);
  await page.screenshot({path:art+'/model-import-toast-'+(partial?'partial-mobile':'success-desktop')+'.png',fullPage:true});
  if(partial)await toast.getByRole('button',{name:'关闭提示'}).click();
  else await expect(toast.getByRole('status')).toHaveCount(0,{timeout:5000});
  await expect(page.getByText(/已导入/)).toHaveCount(0);
  await expect(page.getByText('M00003')).toBeVisible();
 }
});

// AC-170 / AC-174: full model image, including top/bottom and landscape edges.
test('duplicate import shows the server explanation instead of a generic HTTP 409',async({page})=>{
 for(const width of [1440,360]){
 await page.setViewportSize({width,height:800});
 await page.goto(entry+'?import=duplicate');
 await page.getByLabel('上传模特图片').setInputFiles({name:'model.png',mimeType:'image/png',buffer:Buffer.from('test image')});
 const toast=page.getByRole('region',{name:'操作提示'});
 await expect(toast).toContainText('该图片已在模特图库中（M00002），无需重复导入');
 await expect(toast).not.toContainText('HTTP 409');
 await expect(page.getByText('M00003')).toHaveCount(0);
 await page.screenshot({path:art+'/model-gallery-import-conflict-'+width+'.png',fullPage:true});
 await toast.getByRole('button',{name:'关闭提示'}).click();
 }
});

test('gallery uses aligned 3:4 frames for complete tall wide and square images and hides dimensions',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:800});
  await page.goto(entry+'?layout=mixed');
  const images=page.getByRole('img',{name:/模特 M0000/});
  await expect(images).toHaveCount(3);
  for(const image of await images.all()){
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty('complete',true);
  await expect(image).toHaveAttribute('src',/\/display\.svg$/);
  const size=await image.evaluate(img=>{
   const el=img as HTMLImageElement,box=el.getBoundingClientRect();
   const style=getComputedStyle(el);
   return {ratio:box.width/box.height,fit:style.objectFit,position:style.objectPosition,
    width:box.width,frameWidth:el.parentElement!.clientWidth};
  });
  expect(size.ratio).toBeCloseTo(3/4,2);
  expect(size.fit).toBe('contain');
  expect(size.position).toBe('50% 50%');
  expect(size.width).toBeCloseTo(size.frameWidth,0);
  }
  const gallery=page.getByRole('region',{name:'模特图库'});
  await expect(gallery.getByText(/\d+×\d+px|未校准|参考 \d+ cm/)).toHaveCount(0);
  const cards=await gallery.locator('article').evaluateAll(items=>items.map(el=>{
   const rect=el.getBoundingClientRect(),edit=el.querySelector('button')!.getBoundingClientRect();
   return {top:rect.top,height:rect.height,editTop:edit.top};
  }));
  expect(cards[0].top).toBeCloseTo(cards[1].top,0);
  expect(cards[0].height).toBeCloseTo(cards[1].height,0);
  expect(cards[0].editTop).toBeCloseTo(cards[1].editTop,0);
  if(width===1440){expect(cards[0].height).toBeCloseTo(cards[2].height,0);expect(cards[0].editTop).toBeCloseTo(cards[2].editTop,0);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:art+'/model-gallery-aligned-'+width+'.png',fullPage:true});
 }
});
test('gallery shows image, editable category, deletion confirmation and keyboard cancellation on desktop + mobile',async({page})=>{
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:800});
  await page.goto(entry);
  await expect(page.getByRole('heading',{name:'模特图库'})).toBeVisible();
  await expect(page.getByText('M00002')).toBeVisible();
  await page.getByRole('button',{name:'编辑'}).click();
  const dlg=page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await page.screenshot({path:art+'/model-gallery-'+width+'.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
 await page.getByRole('button',{name:'编辑'}).click();
 await page.getByRole('dialog').getByRole('combobox',{name:'服装类别'}).selectOption('top');
 await page.getByRole('dialog').getByRole('button',{name:'保存'}).click();
 await expect(page.getByText('M00002')).toBeVisible();
 await expect(page.getByText(/上衣 · 正面/)).toBeVisible();
 await page.getByRole('button',{name:'删除'}).click();
 await expect(page.getByRole('alertdialog')).toContainText('删除 M00002');
 await page.getByRole('alertdialog').getByRole('button',{name:'取消'}).click();
 await expect(page.getByText('M00002')).toBeVisible();
});
test('gallery replaces only the image of the existing model after saving',async({page})=>{
 const file={name:'replacement.png',mimeType:'image/png',buffer:Buffer.from('test image')};
 let uploads=0;
 page.on('request',request=>{if(request.method()==='PUT'&&request.url().endsWith('/__fixtures__/model-upload'))uploads++;});
 for(const width of [1440,360]){
  uploads=0;
  await page.setViewportSize({width,height:800});
  await page.goto(entry+'?replace=ok');
  const card=page.locator('article').filter({hasText:'M00002'});
  const image=card.getByRole('img');
  const edit=card.getByRole('button',{name:'编辑'});
  const dialog=page.getByRole('dialog');
  const picker=dialog.getByLabel('替换图片（可选）');
  await expect(image).toHaveAttribute('src',/bbbbbbbb/);
  await edit.click();
  await picker.setInputFiles(file);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(image).toHaveAttribute('src',/bbbbbbbb/);
  expect(uploads).toBe(0);
  await edit.click();
  await expect(picker).toHaveValue('');
  await picker.setInputFiles(file);
  await page.screenshot({path:art+'/model-image-replace-'+width+'.png',fullPage:true});
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('已替换模特图片');
  await expect(image).toHaveAttribute('src',/eeeeeeee/);
  expect(uploads).toBe(1);
  await expect(page.locator('article')).toHaveCount(1);
  await edit.click();
  await expect(dialog.getByRole('combobox',{name:'服装类别'})).toHaveValue('dress');
  await expect(dialog.getByLabel('尺寸参考（厘米，可留空）')).toHaveValue('75');
  await expect(dialog.getByRole('textbox',{name:'备注'})).toHaveValue('柔软轻薄');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});

test('gallery keeps the original image and edit dialog on a replacement conflict',async({page})=>{
 await page.goto(entry+'?replace=conflict');
 const image=page.locator('article').getByRole('img');
 await expect(image).toHaveAttribute('src',/bbbbbbbb/);
 await page.getByRole('button',{name:'编辑'}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByLabel('替换图片（可选）').setInputFiles({name:'duplicate.png',mimeType:'image/png',buffer:Buffer.from('test image')});
 await dialog.getByRole('button',{name:'保存',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('该图片已关联模特 M00003');
 await expect(image).toHaveAttribute('src',/bbbbbbbb/);
 await dialog.getByRole('button',{name:'取消'}).click();
 await expect(dialog).toHaveCount(0);
 await expect(page.getByText('M00002')).toBeVisible();
});

test('try-on selects model, respects pattern actual dimension, exports originals and closes with Escape',async({page})=>{
 await page.goto(entry+'?mode=tryon');
 const opener=page.getByRole('button',{name:'打开换装'});
 await opener.click();
 const dialog=page.getByRole('dialog',{name:'生成模特图 G0393-1-F018'});
 await expect(dialog).toContainText('48 × 32 cm');
 await dialog.getByRole('button',{name:/M00002/}).click();
 await dialog.getByRole('combobox',{name:'目标换装部位'}).selectOption('dress');
 await expect(dialog.getByRole('img',{name:'M00002'})).toHaveAttribute('src',/\/display\.svg$/);
 const prompt=dialog.getByRole('textbox',{name:'换装提示词'});
 await expect(prompt).toHaveValue(/48 cm、高 32 cm/);
 await expect(prompt).toHaveValue(/两张原图.*同一次图像编辑/);
 await expect(prompt).toHaveValue(/10% 以内/);
 const download=page.waitForEvent('download');
 await dialog.getByRole('button',{name:/下载素材包/}).click();
 const bundle=await download;
 expect(bundle.suggestedFilename()).toContain('换装素材-G0393-1-F018-M00002.zip');
 const files=unzipSync(await readFile((await bundle.path())!));
 expect(strFromU8(files['03-prompt.txt'])).toBe(await prompt.inputValue());
 expect(JSON.parse(strFromU8(files['04-data.json'])).prompt).toBe(await prompt.inputValue());
 await page.screenshot({path:art+'/model-tryon-desktop.png',fullPage:true});
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(opener).toBeFocused();
 await page.setViewportSize({width:360,height:800});
 await opener.click();
 await dialog.getByRole('button',{name:/M00002/}).click();
 await dialog.getByRole('combobox',{name:'目标换装部位'}).selectOption('dress');
 await page.screenshot({path:art+'/model-tryon-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

// AC-172 / AC-174: select a target explicitly; copy/download the exact edited draft.
test('try-on requires explicit garment and exports edited skirt prompt with matching metadata',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 for(const width of [1440,360]){
  await page.setViewportSize({width,height:900});
  await page.goto(entry+'?mode=tryon&layout=mixed');
  const opener=page.getByRole('button',{name:'打开换装'});
  await opener.click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:/M00002/}).click();
  const target=dialog.getByRole('combobox',{name:'目标换装部位'});
  await expect(target).toHaveValue(''); // catalog category is dress, but is not consent.
  await expect(dialog.getByRole('button',{name:/下载素材包/})).toBeDisabled();
  await target.selectOption('skirt');
  await dialog.getByRole('textbox',{name:'部位说明'}).fill('米白色半透明蓬蓬半身裙；保留银色亮片抹胸');
  const prompt=dialog.getByRole('textbox',{name:'换装提示词'});
  await expect(prompt).toBeEditable();
  await expect(prompt).toHaveValue(/仅替换半身裙/);
  const base=await prompt.inputValue();
  expect(base).toMatch(/模特备注.*柔软轻薄/);
  expect(base).toContain("01-G0393-1-pattern");
  expect(base).toContain("02-G0393-1-M00002-model");
  const edited=base+'\n额外要求：上身银色亮片抹胸完全保留。';
  await prompt.fill(edited);
  await dialog.getByRole('button',{name:'复制提示词',exact:true}).click();
  // Windows clipboard normalizes LF to CRLF; compare the actual text with native line endings normalized.
  expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe(edited);
  const downloadEvent=page.waitForEvent('download');
  await dialog.getByRole('button',{name:/下载素材包/}).click();
  const download=await downloadEvent;
  const files=unzipSync(await readFile((await download.path())!));
  expect(Object.keys(files).sort()).toEqual(['01-G0393-1-pattern.png','02-G0393-1-M00002-model.png','03-prompt.txt','04-data.json']);
  expect(strFromU8(files['03-prompt.txt'])).toBe(edited);
  const meta=JSON.parse(strFromU8(files['04-data.json']));
  expect(meta).toMatchObject({targetGarment:'skirt',targetDescription:'米白色半透明蓬蓬半身裙；保留银色亮片抹胸',prompt:edited,scalePercent:100,patternWidthCm:48,patternHeightCm:32});
  expect(JSON.stringify(meta)).not.toMatch(/token|https?:|signature/i);
  await dialog.getByRole('combobox',{name:'花型比例'}).selectOption('90');
  await expect(prompt).toHaveValue(/90%/);
  await expect(prompt).not.toHaveValue(/额外要求/);
  await dialog.getByRole('combobox',{name:'花型比例'}).selectOption('100');
  await expect(prompt).toHaveValue(edited); // returning to the same settings restores its draft.
  await prompt.scrollIntoViewIfNeeded();
  await prompt.evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:art+'/model-tryon-target-'+width+'.png',fullPage:true});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await dialog.getByRole('button',{name:'恢复默认提示词'}).click();
  await expect(prompt).toHaveValue(base);
  await target.selectOption('other');
  await dialog.getByRole('textbox',{name:'部位说明'}).fill(' ');
  await expect(dialog.getByRole('button',{name:/下载素材包/})).toBeDisabled();
  await dialog.getByRole('textbox',{name:'部位说明'}).fill('左侧模特的披肩');
  await expect(prompt).toHaveValue(/左侧模特的披肩/);
  await prompt.fill('  ');
  await expect(dialog.getByRole('button',{name:/下载素材包/})).toBeDisabled();
  await expect(dialog.getByRole('button',{name:'复制提示词',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:/M00003/}).click();
  await expect(target).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
 }
});

test('try-on retains edited draft after original download and clipboard failures',async({page})=>{
 await page.goto(entry+'?mode=tryon&original=fail');
 await page.getByRole('button',{name:'打开换装'}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:/M00002/}).click();
 await dialog.getByRole('combobox',{name:'目标换装部位'}).selectOption('skirt');
 const prompt=dialog.getByRole('textbox',{name:'换装提示词'});
 await expect(prompt).toHaveValue(/48 cm/);
 const edited=(await prompt.inputValue())+'\n保留上衣。';
 await prompt.fill(edited);
 await dialog.getByRole('button',{name:/下载素材包/}).click();
 await expect(dialog.getByRole('alert')).toContainText('原图读取失败');
 await expect(prompt).toHaveValue(edited);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}}));
 await dialog.getByRole('button',{name:'复制提示词',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('复制失败');
 await expect(prompt).toHaveValue(edited);
 await dialog.getByRole('button',{name:'关闭',exact:true}).focus();
 await page.keyboard.press('Shift+Tab');
 await expect(dialog.getByLabel('上传生成的模特效果图')).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(dialog.getByRole('button',{name:'关闭',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
});
