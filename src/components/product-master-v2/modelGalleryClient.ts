import type {CatalogProduct} from './catalogModel';
export type ModelCategory='dress'|'top'|'skirt'|'pants'|'set'|'other';
export type ModelAngle='front'|'side'|'back'|'other';
export interface ModelImage{
 id:string;modelNo:string;assetId:string;category:ModelCategory;angle:ModelAngle;
 note:string;referenceCm:number|null;width:number;height:number;
}
export const categories:Record<ModelCategory,string>={
 dress:'连衣裙',top:'上衣',skirt:'半身裙',pants:'裤装',set:'套装',other:'其他'
};
export const angles:Record<ModelAngle,string>={front:'正面',side:'侧面',back:'背面',other:'其他'};
export async function listModelImages(apiFetch:typeof fetch,category?:ModelCategory,offset=0):Promise<{items:ModelImage[];total:number}>{
 const path='/api/v2/models?limit=50&offset='+offset+(category?'&category='+category:'');
 const response=await apiFetch(path,{cache:'no-store'});
 if(!response.ok)throw Error('模特图库读取失败（'+response.status+'）');
 const data=await response.json();
 if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||
  !data.items.every((m:ModelImage)=>typeof m.id==='string'&&typeof m.assetId==='string'&&typeof m.modelNo==='string'&&m.category in categories))
  throw Error('模特图库资料格式错误');
 return data;
}
export interface PatternSize{widthCm:number|null;heightCm:number|null}
export const targetGarments={dress:'连衣裙',top:'上衣',skirt:'半身裙',pants:'裤装',set:'整套服装',other:'自定义部位'} as const;
export type TargetGarment=keyof typeof targetGarments;
export interface TryOnTarget{targetGarment:TargetGarment;targetDescription:string}
export function tryOnImageNames(product:CatalogProduct,model:ModelImage){
 const safe=(value:string)=>value.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_');
 const patternNo=safe(`${product.masterNo}-${product.colorwayNo}`);
 return {pattern:`01-${patternNo}-pattern`,model:`02-${patternNo}-${safe(model.modelNo)}-model`};
}
export function createTryOnPrompt(product:CatalogProduct,model:ModelImage,size:PatternSize,scalePercent:number,target:TryOnTarget):string{
 if(!target||!Object.hasOwn(targetGarments,target.targetGarment))throw Error('请先选择目标换装部位');
 const description=target.targetDescription.trim();
 const modelNote=model.note?.trim();
 if(target.targetGarment==='other'&&!description)throw Error('请填写自定义换装部位');
 const region=targetGarments[target.targetGarment];
 const protectedClothes=target.targetGarment==='skirt'||target.targetGarment==='pants'?'上衣及其他非目标服装':
  target.targetGarment==='top'?'半身裙、裤装及其他非目标服装':'其他非目标服装';
 const names=tryOnImageNames(product,model);
 const sizeText=size.widthCm&&size.heightCm
  ? `整张花型原图实测宽 ${size.widthCm} cm、高 ${size.heightCm} cm，可能包含多个循环。`
  : '整张花型原图的厘米尺寸未录入。';
 const scope=target.targetGarment==='other'?description:region;
 const detail=description&&scope!==description?`部位说明：${description}。`:'';
 const upperBoundary=target.targetGarment==='top'&&!description
  ? '若原图为连衣裙，范围限腰线上方的衣身、领口和衣袖，腰带及裙摆保持原样。'
  : '';
 return [
   `先从素材包提取并查看两张原图，已单独上传时直接使用：${names.model} 是编辑底图，${names.pattern} 是唯一印花依据。按此顺序将两张原图作为图片输入传入同一次图像编辑。缺图或无法同时传入时停止并说明原因。`,
   `仅替换${scope}。${detail}${upperBoundary}`,
   `按原图比例 ${scalePercent}% 应用，所有衣片沿用同一基准比例。${sizeText}按整张原图定标，缺少服装实测尺寸时按视觉比例处理。`,
   `覆盖目标部位各层可见面料，让纹样随褶皱和透视连续弯曲、压缩和遮挡。保留原有版型、接缝、明暗、织物质感和透光感。真实接缝和裁边可截断纹样，裸露皮肤、头发及真实开口不铺印花。面料质感参考${product.fabricName||'原图'}。`,
   '保留印花原图的主纹样轮廓、相邻关系、底色、配色、方向和疏密。只允许深褶、遮挡边缘或细小纹样轻微重绘，按目标衣物可见印花布面目视估算，局部差异总面积控制在约 10% 以内。自然光影、透视和遮挡不计入重绘差异。主纹样被替换、整体比例或疏密改变、底色或配色跑偏，均须退回。',
  ...(modelNote?[`模特备注（仅参考与本次换装部位相关的内容，冲突时以本次选择和部位说明为准）：${modelNote}`]:[]),
  `${protectedClothes}、人物、剪裁和背景保持不变。沿用原图构图和透明度，输出一张效果图。纯服装图保持原有陈列方式。`,
   '出图后同时对照两张原图，检查部位、衣片覆盖、花型比例、配色和褶皱。达标即交付。整体跑偏或工具失败时说明原因。仅有明确的局部缺陷时，使用同一编辑器和两张原图最多补修一次。',
 ].join('\n');
}
export function originalImageExtension(bytes:Uint8Array):'.png'|'.jpg'|'.webp'|'.gif'{
 if(bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return '.png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return '.jpg';
 if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return '.webp';
 if(bytes.length>=6&&String.fromCharCode(...bytes.slice(0,3))==='GIF')return '.gif';
 throw Error('无法识别原图格式');
}
export async function readOriginalAsset(apiFetch:typeof fetch,assetId:string):Promise<Uint8Array>{
 if(!/^[0-9a-f-]{36}$/i.test(assetId))throw Error('图片编号无效');
 const response=await apiFetch('/api/image-assets/'+assetId+'/content?variant=original',{cache:'no-store'});
 if(!response.ok)throw Error('原图读取失败（HTTP '+response.status+'）');
 return new Uint8Array(await response.arrayBuffer());
}
