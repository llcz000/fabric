/** Browser batch import planning. Validate before uploading to avoid junk assets.
 * Explicit numbering never retries a possibly committed server POST.
 */
import type {PatternMasterItem} from './patternModel';
export interface PatternImageImportEntry{
 file:File;masterNo:string;colorwayNo:number;patternNo:string
}
const MIME:Record<string,string>={
 jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'
};
const id=/^[1-9]\d{0,19}$/;
const MAX_ID=18446744073709551615n;
function filenameIdentity(name:string){
 const match=/^([a-zA-Z0-9]{1,64})-([1-9]\d*)\.([a-zA-Z]+)$/.exec(name);
 if(!match)throw Error('文件名应为花型母版号-配色号.jpg，例如 G0008-1.jpg');
 const no=Number(match[2]);
 if(!Number.isSafeInteger(no)||no<1||no>4294967295||String(no)!==match[2])
  throw Error('配色号必须是1到4294967295之间的正整数，不允许前导0');
 const masterNo=match[1].toUpperCase();
 return {masterNo,colorwayNo:no,patternNo:masterNo+'-'+no,extension:match[3].toLowerCase()};
}
export function parsePatternImageFilename(file:Pick<File,'name'|'size'|'type'>):
 Omit<PatternImageImportEntry,'file'>{
 const {extension,...identity}=filenameIdentity(file.name);
 if(!MIME[extension]||file.type!==MIME[extension])throw Error('图片格式不匹配，请使用 JPG、PNG、WebP 或 GIF');
 if(file.size<=0||file.size>20*1024*1024)throw Error('图片应为20MB以内的非空文件');
 return identity;
}
interface RejectedImage{name:string;error:string;identity?:Omit<PatternImageImportEntry,'file'>}
// Relative directories identify files in this dialog only; identity and requests
// always use the browser's base filename and explicit master/colorway numbers.
export function patternImageDisplayName(file:Pick<File,'name'>&Partial<Pick<File,'webkitRelativePath'>>):string{
 return file.webkitRelativePath||file.name;
}
export function planPatternImageImports(files:File[]):{
 ready:PatternImageImportEntry[];rejected:RejectedImage[]
}{
 const ready:PatternImageImportEntry[]=[],rejected:RejectedImage[]=[],counts=new Map<string,number>();
 // Count before validating MIME/size, so an invalid duplicate never silently
 // chooses the other image for the same immutable number.
 for(const file of files){
  try{const {patternNo}=filenameIdentity(file.name);counts.set(patternNo,(counts.get(patternNo)??0)+1);}catch{/* Report malformed names below. */}
 }
 for(const file of files){
  let identity:Omit<PatternImageImportEntry,'file'>|undefined;
  try{
   const parsed=filenameIdentity(file.name);
   identity={masterNo:parsed.masterNo,colorwayNo:parsed.colorwayNo,patternNo:parsed.patternNo};
   if((counts.get(identity.patternNo)??0)>1)throw Error('同一批次中花型编号重复：冲突文件全部排除，请核对后重新选择');
   parsePatternImageFilename(file);
   ready.push({file,...identity});
  }catch(error){rejected.push({name:patternImageDisplayName(file),error:error instanceof Error?error.message:'文件无效',...(identity?{identity}:{})});}
 }
 ready.sort((a,b)=>a.masterNo.localeCompare(b.masterNo)||a.colorwayNo-b.colorwayNo);
 return {ready,rejected};
}
export async function saveImportedPatternImage(
 apiFetch:typeof fetch,upload:(file:File)=>Promise<string>,entry:PatternImageImportEntry,
 isActive:()=>boolean=()=>true
):Promise<void>{
 if(!isActive())throw new DOMException('Import window closed','AbortError');
 const imageId=await upload(entry.file);
 // An uploaded asset must not trigger a business write after the dialog unmounts.
 if(!isActive())throw new DOMException('Import window closed','AbortError');
 const res=await apiFetch('/api/v2/pattern-catalog/import',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({masterNo:entry.masterNo,colorwayNo:entry.colorwayNo,patternImageAssetId:imageId})});
 if(!res.ok){
  if(res.status===409)throw Error('花型正在被其他操作修改，或图片尚未就绪，请核对后再试');
  if(res.status===403||res.status===401)throw Error('没有导入花型的权限，请重新登录核对');
  throw Error('保存花型失败（HTTP '+res.status+'），请核对列表后再决定是否重试');
 }
}
export async function deleteWholePatternMaster(apiFetch:typeof fetch,masterId:PatternMasterItem['id']):Promise<void>{
 if(!id.test(masterId)||BigInt(masterId)>MAX_ID)throw Error('无效花型ID');
 const response=await apiFetch('/api/v2/pattern-masters/'+masterId,{method:'DELETE'});
 if(!response.ok){
  if(response.status===409)throw Error('花型仍关联产品、色卡或其他业务资料，请先处理关联关系，或停用该花型');
  if(response.status===404)throw Error('花型已不存在，请刷新列表');
  throw Error('删除失败（HTTP '+response.status+'），花型记录未确认删除');
 }
}
