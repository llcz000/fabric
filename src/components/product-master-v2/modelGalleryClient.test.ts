import assert from 'node:assert/strict';
import test from 'node:test';
import {createTryOnPrompt,originalImageExtension,readOriginalAsset,type ModelImage} from './modelGalleryClient';
const product:any={id:'1',productNo:'G0381-2-F01',masterNo:'G0381',colorwayNo:2,fabricName:'轻薄雪纺',composition:'涤纶',
 weightValue:75,weightUnit:'gsm',widthCm:145};
const model:ModelImage={id:'2',modelNo:'M00002',assetId:'00000000-0000-0000-0000-000000000001',category:'dress',
 angle:'front',note:'',referenceCm:null,width:1024,height:1536};
test('try-on prompt takes real full-image dimensions even when pattern contains multiple repeats and identifies both bundle images',()=>{
 const value=createTryOnPrompt(product,model,{widthCm:48,heightCm:32},90,{targetGarment:'dress',targetDescription:''});
 assert.match(value,/48 cm/);assert.match(value,/32 cm/);assert.match(value,/90%/);
 assert.match(value,/01-G0381-2-pattern/);assert.match(value,/02-G0381-2-M00002-model/);assert.match(value,/可能包含多个循环/);
});
test('unknown dimensions never claim physical accuracy',()=>{
 const value=createTryOnPrompt(product,model,{widthCm:null,heightCm:null},100,{targetGarment:'dress',targetDescription:''});
 assert.match(value,/未录入/);assert.match(value,/按视觉比例处理/);
});

// AC-172: the requested garment is independent of the model's catalog category.
test('skirt target preserves the upper garment and follows folded layered fabric',()=>{
 const value=createTryOnPrompt(product,{...model,modelNo:'M00024',category:'top'},
  {widthCm:30,heightCm:45},100,{targetGarment:'skirt',targetDescription:'米白色半透明蓬蓬半身裙；保留银色亮片抹胸'});
 assert.match(value,/仅替换半身裙/);
 assert.match(value,/上衣.*保持不变/);
 assert.match(value,/米白色半透明蓬蓬半身裙/);
 assert.match(value,/褶皱.*透视/);
 assert.match(value,/各层可见面料/);
 assert.match(value,/30 cm、高 45 cm/);
 assert.match(value,/100%/);
 assert.doesNotMatch(value,/现有服装上/);
});

test('explicit top pants dress set and custom targets have distinct scope',()=>{
 for(const [targetGarment,label] of [['top','上衣'],['pants','裤装'],['dress','连衣裙'],['set','整套服装'],['other','自定义部位']] as const){
  const value=createTryOnPrompt(product,model,{widthCm:null,heightCm:null},80,
   {targetGarment,targetDescription:targetGarment==='other'?'左侧模特的披肩':''});
  assert.match(value,new RegExp('仅替换'+(targetGarment==='other'?'左侧模特的披肩':label)));
  if(targetGarment==='other')assert.match(value,/左侧模特的披肩/);
  assert.match(value,/非目标.*保持不变/);
 }
});

test('missing target or empty custom region cannot silently generate an ambiguous prompt',()=>{
 assert.throws(()=>createTryOnPrompt(product,model,{widthCm:30,heightCm:45},100,undefined as any),/选择.*部位/);
 assert.throws(()=>createTryOnPrompt(product,model,{widthCm:30,heightCm:45},100,{targetGarment:'other',targetDescription:'  '}),/填写.*部位/);
});
test('original image formats retain correct extensions',()=>{
 assert.equal(originalImageExtension(new Uint8Array([137,80,78,71,13,10,26,10])),'.png');
 assert.equal(originalImageExtension(new Uint8Array([255,216,255,0])),'.jpg');
 assert.equal(originalImageExtension(new TextEncoder().encode('RIFF0000WEBP')),'.webp');
 assert.equal(originalImageExtension(new TextEncoder().encode('GIF89a')),'.gif');
 assert.throws(()=>originalImageExtension(new Uint8Array([1,2,3])));
});
test('originals are fetched via authenticated same-origin content URL',async()=>{
 const requests:string[]=[];
 const api=(async(input:RequestInfo|URL)=>{requests.push(String(input));return new Response(new Uint8Array([1,2,3]));}) as typeof fetch;
 const bytes=await readOriginalAsset(api,model.assetId);
 assert.deepEqual([...bytes],[1,2,3]);
 assert.deepEqual(requests,['/api/image-assets/'+model.assetId+'/content?variant=original']);
});
test('reject malformed image ids',async()=>{
 await assert.rejects(readOriginalAsset(fetch,'/../../secret'));
});

test('uses the selected model note as a reference without expanding the requested region',()=>{
 const value=createTryOnPrompt(product,{...model,category:'set',note:'  整套换装，上衣衣长约55 cm、半身裙约60 cm。  '},
  {widthCm:30,heightCm:45},100,{targetGarment:'skirt',targetDescription:'仅左侧半身裙'});
 assert.match(value,/仅替换半身裙.*仅左侧半身裙/);
 assert.match(value,/模特备注.*以本次选择和部位说明为准.*整套换装，上衣衣长约55 cm、半身裙约60 cm。/);
 assert.match(value,/上衣及其他非目标服装.*保持不变/);
});
test('omits empty model notes from the default prompt',()=>{
 const value=createTryOnPrompt(product,{...model,note:'  \n  '},{widthCm:null,heightCm:null},100,
  {targetGarment:'dress',targetDescription:''});
 assert.doesNotMatch(value,/模特备注/);
});
