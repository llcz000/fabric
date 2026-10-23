/** Internally approved subject vocabulary. Existing tag rows keep their stable IDs. */
import type {CatalogTag} from './catalogModel';
export const TOPIC_PRESETS=['油画花卉','水彩花卉','小碎花','植物剪影','条纹','格纹','几何图案','抽象肌理','动物皮纹','涂鸦插画','佩斯利纹','海洋主题','波点','字母文字','水果图案','建筑风景'] as const;
export function sortedTopicTags(tags:CatalogTag[]):CatalogTag[]{
 const position=new Map<string,number>(TOPIC_PRESETS.map((name,index)=>[name,index]));
 return [...tags].sort((a,b)=>(position.get(a.name)??Number.MAX_SAFE_INTEGER)-(position.get(b.name)??Number.MAX_SAFE_INTEGER)||a.name.localeCompare(b.name,'zh'));
}
export async function ensureTopicTag(apiFetch:typeof fetch,tags:CatalogTag[],rawName:string):Promise<CatalogTag>{
 const name=rawName.trim(),key=name.normalize('NFKC').toLowerCase();
 if(!name||[...name].length>32||/[\p{Cc}\p{Cf}]/u.test(name))throw Error('题材名称须为1至32个可见字符');
 const found=tags.find(tag=>tag.name.normalize('NFKC').toLowerCase()===key);
 if(found){if(found.isArchived)throw Error('已归档的题材无法新增关联');return found;}
 const response=await apiFetch('/api/v2/tags',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dimension:'topic',name})});
 if(!response.ok)throw Error(response.status===403?'当前账号无权维护题材':'创建题材失败，请重试');
 const item=await response.json() as {id?:unknown;name?:unknown;dimension?:unknown;isArchived?:unknown};
 if(typeof item.id!=='string'||!/^[1-9]\d*$/.test(item.id)||item.dimension!=='topic'||typeof item.name!=='string'||typeof item.isArchived!=='boolean'||item.isArchived)throw Error('题材服务返回数据无效');
 return {id:item.id,name:item.name,isArchived:item.isArchived};
}
/** Archived preset names can still filter historical records; missing names are created only on selection. */
export async function resolvePresetTopicForFilter(apiFetch:typeof fetch,tags:CatalogTag[],name:string):Promise<CatalogTag>{
 if(!TOPIC_PRESETS.some(p=>p===name))throw Error('无效的预设题材');
 const found=tags.find(tag=>tag.name===name);
 if(found)return found;
 const res=await apiFetch('/api/v2/tags?dimension=topic&includeArchived=true&search='+encodeURIComponent(name));
 if(!res.ok)throw Error('题材读取失败，请重试');
 const data=await res.json() as {items?:unknown};
 if(!Array.isArray(data.items))throw Error('题材读取结果无效');
 const match=data.items.find(x=>x&&typeof x==='object'&&(x as {name?:unknown}).name===name);
 if(match){
  const item=match as {id?:unknown;name?:unknown;dimension?:unknown;isArchived?:unknown};
  if(typeof item.id!=='string'||!/^[1-9]\d*$/.test(item.id)||item.dimension!=='topic'||typeof item.isArchived!=='boolean')throw Error('题材读取结果无效');
  return {id:item.id,name,isArchived:item.isArchived};
 }
 return ensureTopicTag(apiFetch,tags,name);
}
/** Delete a custom topic by atomically removing all master links; the dictionary ID is archived to block stale saves. */
export interface TopicTagImpact extends CatalogTag{affectedCount:number}
function customTag(tag:CatalogTag){
 if(TOPIC_PRESETS.some(name=>name===tag.name))throw Error('预设题材不可删除');
 if(!/^[1-9]\d*$/.test(tag.id))throw Error('题材编号无效');
}
function parseImpact(raw:unknown,expected:CatalogTag,archived:boolean):TopicTagImpact{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('题材返回内容无效');
 const data=raw as Record<string,unknown>;
 if(data.id!==expected.id||data.dimension!=='topic'||typeof data.name!=='string'||
   data.isArchived!==archived||!Number.isSafeInteger(data.affectedCount)||Number(data.affectedCount)<0)
  throw Error('题材关联统计无效，请重试');
 return {id:expected.id,name:data.name,isArchived:archived,affectedCount:Number(data.affectedCount)};
}
export async function previewCustomTopicDeletion(apiFetch:typeof fetch,tag:CatalogTag):Promise<TopicTagImpact>{
 customTag(tag);
 const res=await apiFetch('/api/v2/tags/'+tag.id+'/impact');
 if(!res.ok)throw Error('无法查询题材关联情况，请刷新重试');
 return parseImpact(await res.json(),tag,tag.isArchived);
}
export async function deleteCustomTopic(apiFetch:typeof fetch,tag:CatalogTag,affectedCount:number):Promise<TopicTagImpact>{
 customTag(tag);
 if(!Number.isSafeInteger(affectedCount)||affectedCount<0)throw Error('删除前必须确认关联花型数量');
 const res=await apiFetch('/api/v2/tags/'+tag.id+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmAffectedCount:affectedCount})});
 if(!res.ok)throw Error('删除自定义题材失败，请刷新后重试');
 return parseImpact(await res.json(),tag,true);
}
