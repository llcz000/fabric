import {test,expect} from '@playwright/test';
import sharp from 'sharp';

const asset='a1111111-1111-4111-8111-111111111111';
const imageHost='https://fabric-image-upload-fixture.invalid';

test('AC-06 and AC-07: same file survives upload, save and reopening in both product categories',async({page})=>{
 const buffer=await sharp({create:{width:8,height:8,channels:3,background:'#2261a7'}}).png().toBuffer();
 const file={name:'same-fabric.png',mimeType:'image/png',buffer};
 const product={id:'1',patternColorwayId:'3',fabricId:'8',masterNo:'G017',colorwayNo:2,
  fabricNo:'F018',fabricName:'测试面料',composition:null,weightValue:null,weightUnit:null,widthCm:null,
  patternImageAssetId:null,productNo:'G017-2-F018',remark:'',isActive:true,isAvailableForSampling:true,rowVersion:'4',
  masterActive:true,colorwayActive:true,fabricActive:true,images:{fabricDisplay:[] as string[],detail:[] as string[],aiEffect:[] as string[]}};
 let nextSession=0;
 const uploaded=new Map<string,Buffer>();
 await page.route(imageHost+'/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/put/')){
   expect(route.request().method()).toBe('PUT');
   uploaded.set(path.slice(5),route.request().postDataBuffer()!);
   return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'}});
  }
  return route.fulfill({contentType:'image/png',body:buffer});
 });
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/v2/products/1'){
   if(request.method()==='PATCH'){
    const body=request.postDataJSON();
    expect(body.expectedRowVersion).toBe(product.rowVersion);
    product.images=body.images;product.rowVersion=String(Number(product.rowVersion)+1);
   }
   return route.fulfill({json:product});
  }
  if(path==='/api/v2/pattern-catalog')return route.fulfill({json:{items:[],total:0,limit:20,offset:0}});
  if(path==='/api/image-assets/access-urls')return route.fulfill({json:{results:request.postDataJSON().requests.map(item=>({...item,url:imageHost+'/thumbnail'}))}});
  if(path==='/api/image-assets/upload-sessions'){
   const sessionId=String(++nextSession);
   expect(request.postDataJSON()).toMatchObject({purpose:'product_image',originalFilename:file.name,declaredMime:file.mimeType});
   return route.fulfill({status:201,json:{sessionId,method:'PUT',uploadUrl:imageHost+'/put/'+sessionId,
    headers:{'Content-Type':file.mimeType},expiresAt:'2099-01-01T00:00:00.000Z'}});
  }
  if(path.endsWith('/finalize')){
   expect(uploaded.get(path.split('/').at(-2)!)).toEqual(file.buffer);
   return route.fulfill({json:{id:asset,purpose:'product_image',status:'ready',detectedMime:file.mimeType,
    byteSize:buffer.length,width:8,height:8,variants:{}}});
  }
  throw Error('Unexpected fixture request: '+path);
 });
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-fabrics.html?imageUpload');
 const large=page.getByRole('tab',{name:/面料大图/});
 const detail=page.getByRole('tab',{name:/面料细节图/});
 for(const tab of [large,detail]){
  await tab.click();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'上传图片',exact:true}).click()]);
  await chooser.setFiles(file);
  await expect(tab).toContainText('1 / 10');
 }
 await page.getByRole('button',{name:'保存产品',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('产品图片已保存');
 expect(product.images).toEqual({fabricDisplay:[asset],detail:[asset],aiEffect:[]});
 expect(uploaded.size).toBe(2);
 await page.reload();
 await expect(large).toContainText('1 / 10');
 await expect(detail).toContainText('1 / 10');
 await detail.click();
 await page.getByRole('checkbox',{name:'选中第1张图片'}).check();
 await page.getByRole('button',{name:/删除选中/}).click();
 await expect(detail).toContainText('0 / 10');
 const saved=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith('/api/v2/products/1'));
 await page.getByRole('button',{name:'保存产品',exact:true}).click();
 expect((await saved).ok()).toBe(true);
 expect(product.images).toEqual({fabricDisplay:[asset],detail:[],aiEffect:[]});
});

test('AC-05: a TIFF named WebP displays the decoded server thumbnail in the colorway editor',async({page})=>{
 const source=sharp({create:{width:17,height:12,channels:3,background:'#346ef6'}});
 const file=await source.clone().tiff().toBuffer();
 const thumbnail=await source.clone().resize(320,320,{fit:'cover'}).webp().toBuffer();
 await page.route('https://fabric-related-fixture.invalid/**',route=>route.fulfill({contentType:'image/webp',body:thumbnail}));
 await page.goto('/tools/ui-preview/entries/ui-ux-internal-patterns.html?dimensions');
 await page.getByRole('button',{name:'编辑花型及配色 G0076',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'编辑花型 G0076',exact:true});
 await dialog.getByRole('button',{name:'添加配色',exact:true}).click();
 await dialog.locator('input[type=file][aria-label="新配色花型图"]').setInputFiles({name:'sample.webp',mimeType:'image/webp',buffer:file});
 const img=dialog.getByRole('img',{name:'新配色花型图'});
 await expect(img).toHaveAttribute('src',/^https:\/\/fabric-related-fixture\.invalid\//);
 await expect.poll(()=>img.evaluate(el=>[(el as HTMLImageElement).naturalWidth,(el as HTMLImageElement).naturalHeight])).toEqual([320,320]);
});
