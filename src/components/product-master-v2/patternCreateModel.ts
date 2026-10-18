import {createNextColorway,saveMasterTopicTags,saveMasterColorTags} from './patternModel';
export interface PatternCreationProgress{master?:{id:string;masterNo:string};saved?:string[];uncertain?:boolean;topicSaved?:boolean;colorSaved?:boolean}
export interface PatternColorDraft{key:string;remark:string;patternImageAssetId?:string|null}
export interface PatternLabelDraft{topicTagIds:string[];colorTagIds:string[];newColorTags:string[]}
/** Acknowledged items survive retries. Ambiguous writes must be checked in the library first. */
export async function savePatternDraft(apiFetch:typeof fetch,raw:string,drafts:PatternColorDraft[],progress:PatternCreationProgress,labels?:PatternLabelDraft){
 if(progress.uncertain)throw Error('上次保存结果未确认，请关闭并在花型库核对，勿重复新增');
 const masterNo=raw.trim().toUpperCase();if(!/^[A-Z0-9]{1,64}$/.test(masterNo))throw Error('花型编号须为1至64位字母或数字');
 if(progress.master&&progress.master.masterNo!==masterNo)throw Error('花型编号已保存，不能在重试时修改');
 const safeFetch:typeof fetch=async(url,init)=>{
  try{const response=await apiFetch(url,init);if(response.status>=400&&response.status<500)progress.uncertain=false;return response;}
  catch(error){progress.uncertain=true;throw error;}
 };
 if(!progress.master){progress.uncertain=true;progress.master=await createLibraryPattern(safeFetch,raw);progress.uncertain=false;}
 if(labels){
  if(!progress.topicSaved){progress.uncertain=true;await saveMasterTopicTags(safeFetch,progress.master.id,labels.topicTagIds);progress.uncertain=false;progress.topicSaved=true;}
  if(!progress.colorSaved){progress.uncertain=true;await saveMasterColorTags(safeFetch,progress.master.id,labels.colorTagIds,labels.newColorTags);progress.uncertain=false;progress.colorSaved=true;}
 }
 progress.saved??=[];
 for(const draft of drafts){if(progress.saved.includes(draft.key))continue;
  progress.uncertain=true;await createNextColorway(safeFetch,progress.master.id,{remark:draft.remark,isActive:true,...(draft.patternImageAssetId?{patternImageAssetId:draft.patternImageAssetId}:{})});progress.uncertain=false;
  progress.saved.push(draft.key);
 }
 return progress.master;
}
export async function createLibraryPattern(apiFetch:typeof fetch,raw:string):Promise<{id:string;masterNo:string}>{
 const masterNo=raw.trim().toUpperCase();if(!/^[A-Z0-9]{1,64}$/.test(masterNo))throw Error('花型编号须为1至64位字母或数字');
 const response=await apiFetch('/api/v2/pattern-masters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({masterNo})});
 if(!response.ok)throw Error(response.status===409?'花型编号已存在':'花型新增失败，请检查权限并重试');
 const value=await response.json();if(typeof value.id!=='string'||!/^[1-9]\d*$/.test(value.id)||value.masterNo!==masterNo)throw Error('花型保存响应无效');return value;
}
