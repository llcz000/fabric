import {ActionIcon} from './ActionIcon';
import {useConfirm} from '../ui/ConfirmDialog';
import React,{useEffect,useRef,useState} from 'react';
import {PatternLibraryV2,type PatternLibraryV2Props} from './PatternLibraryV2';
import {TopicTagPicker} from './TopicTagPicker';
import {savePatternDraft,type PatternCreationProgress,type PatternColorDraft} from './patternCreateModel';
import {loadCatalogTags,type CatalogTag} from './catalogModel';
import {uploadImageAsset} from '../../lib/imageAssets';
type Draft=PatternColorDraft&{file?:File};
function DraftImage({file}:{file?:File}){
 const [url,setUrl]=useState('');useEffect(()=>{if(!file){setUrl('');return;}const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);},[file]);
 return url?<img className="h-14 w-14 rounded border object-cover" src={url} alt="待保存花型图"/>:null;
}
export function CreatePattern({apiFetch,onCancel,onSaved,onUpload}:{apiFetch:typeof fetch;onCancel():void;onSaved(no:string):void;onUpload?(file:File):Promise<string>}){
 const confirm=useConfirm();
 const dialog=useRef<HTMLDialogElement>(null),progress=useRef<PatternCreationProgress>({}),sequence=useRef(1);
 const [number,setNumber]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [drafts,setDrafts]=useState<Draft[]>([{key:'1',remark:''}]);
 const [topics,setTopics]=useState<CatalogTag[]>([]),[topicIds,setTopicIds]=useState<string[]>([]);
 const [tagsLoading,setTagsLoading]=useState(true),[tagsError,setTagsError]=useState(''),[tagRevision,setTagRevision]=useState(0);
 useEffect(()=>{const abort=new AbortController();setTagsLoading(true);setTagsError('');loadCatalogTags(apiFetch,'topic',abort.signal).then(topic=>{if(!abort.signal.aborted)setTopics(topic);}).catch(()=>{if(!abort.signal.aborted)setTagsError('标签读取失败，请重试');}).finally(()=>{if(!abort.signal.aborted)setTagsLoading(false);});return()=>abort.abort();},[apiFetch,tagRevision]);

 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 const cancel=async()=>{if(busy)return;
  if(number||drafts.some(d=>d.file||d.remark)||topicIds.length){
   const ok=await confirm({title:progress.current.master?'关闭新增花型？':'放弃未保存的花型资料？',
    message:progress.current.master?'花型编号及已保存配色已入库，关闭后请在花型库继续编辑。':'当前资料尚未保存，放弃后无法恢复。',
    confirmText:'确认关闭',danger:true});
   if(!ok)return;
  }
  onCancel();};
 return <dialog ref={dialog} aria-label="新增花型" className="m-auto w-[min(94vw,760px)] max-h-[90vh] overflow-auto rounded-xl border p-6 shadow-xl backdrop:bg-black/30" onCancel={e=>{if(e.target!==e.currentTarget)return;e.preventDefault();cancel();}}>
  <form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(busy||tagsLoading||tagsError)return;setBusy(true);setError('');try{
   for(const draft of drafts){if(draft.file&&!draft.patternImageAssetId){draft.patternImageAssetId=onUpload?await onUpload(draft.file):(await uploadImageAsset(draft.file,'product_image',{apiFetch})).id;}}
   const value=await savePatternDraft(apiFetch,number,drafts,progress.current,{topicTagIds:topicIds});onSaved(value.masterNo);
  }catch(cause){setError((cause instanceof Error?cause.message:'新增失败')+(progress.current.master?'；已保存花型 '+progress.current.master.masterNo+'，已完成 '+(progress.current.saved?.length??0)+' 个配色。':''));}finally{setBusy(false);}}}>
   <h2 className="text-lg font-semibold">新增花型</h2><label className="block text-sm">花型编号<input autoFocus required name="masterNo" maxLength={64} className="mt-2 w-full rounded border p-2" value={number} disabled={busy||!!progress.current.master} onChange={e=>setNumber(e.target.value)}/></label>
   <section className="space-y-2"><h3 className="text-sm font-medium">题材标签</h3><TopicTagPicker apiFetch={apiFetch} ariaLabel="新增花型题材标签" options={topics} selected={topicIds} onChange={setTopicIds} onTagCreated={tag=>setTopics(items=>[...items.filter(t=>t.id!==tag.id),tag])} disabled={busy||tagsLoading||!!tagsError||!!progress.current.topicSaved}/></section>
   {tagsLoading&&<p role="status" className="text-xs text-slate-500">正在读取标签…</p>}{tagsError&&<p role="alert" className="text-sm text-rose-700">{tagsError} <button type="button" onClick={()=>setTagRevision(n=>n+1)}><ActionIcon name="refresh"/>重新读取标签</button></p>}
   <div className="flex items-center justify-between"><strong className="text-sm">配色及花型图</strong><button type="button" disabled={busy||!!progress.current.master} className="text-sm text-blue-700" onClick={()=>setDrafts(items=>[...items,{key:String(++sequence.current),remark:''}])}><ActionIcon name="add"/>添加配色</button></div>
   {drafts.map((draft,index)=><fieldset key={draft.key} disabled={busy||progress.current.saved?.includes(draft.key)} className="flex flex-wrap items-center gap-3 rounded border p-3">
    <span className="text-sm">配色 {index+1}</span><DraftImage file={draft.file}/>
    <label className="cursor-pointer text-sm text-blue-700">{draft.file?'更换图片':'上传花型图'}<input type="file" className="sr-only" aria-label={'配色 '+(index+1)+' 花型图'} accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>{
     const file=e.target.files?.[0];e.target.value='';if(!file)return;
     if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||file.size===0||file.size>20*1024*1024){setError('请选择20MB以内的JPG、PNG、WebP或GIF图片');return;}
     setDrafts(items=>items.map(item=>item.key===draft.key?{...item,file,patternImageAssetId:undefined}:item));setError('');
    }}/></label>
    {draft.file&&<button type="button" className="text-sm text-rose-700" onClick={()=>setDrafts(items=>items.map(item=>item.key===draft.key?{...item,file:undefined,patternImageAssetId:undefined}:item))}><ActionIcon name="delete"/>移除图片</button>}
    <input aria-label={'配色 '+(index+1)+' 备注'} maxLength={500} className="min-w-0 flex-1 rounded border p-2 text-sm" placeholder="配色备注" value={draft.remark} onChange={e=>setDrafts(items=>items.map(item=>item.key===draft.key?{...item,remark:e.target.value}:item))}/>
    {!progress.current.master&&drafts.length>1&&<button type="button" className="text-sm text-rose-700" onClick={()=>setDrafts(items=>items.filter(item=>item.key!==draft.key))}><ActionIcon name="delete"/>移除配色</button>}
   </fieldset>)}
   <p className="text-xs text-slate-500">保存时自动分配配色序号；题材属于整个花型，最多选10项，支持自定义。</p>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
   <div className="flex justify-end gap-3"><button type="button" disabled={busy} className="rounded border px-4 py-2 text-sm" onClick={cancel}><ActionIcon name="close"/>取消</button><button disabled={busy||tagsLoading||!!tagsError||progress.current.uncertain} className="rounded bg-blue-700 px-4 py-2 text-sm text-white"><ActionIcon name="save"/>{busy?'正在保存…':'保存花型'}</button></div>
  </form>
 </dialog>;
}
export function PatternWorkspaceV2(props:Omit<PatternLibraryV2Props,'onCreateMaster'>){
 const [creating,setCreating]=useState(false),[revision,setRevision]=useState(0),[notice,setNotice]=useState('');
 return <>{notice&&<p role="status" className="p-3 text-sm text-emerald-800">{notice}</p>}
  <PatternLibraryV2 key={revision} {...props} onCreateMaster={props.canManage?()=>{setNotice('');setCreating(true);}:undefined}/>
  {creating&&props.canManage&&<CreatePattern apiFetch={props.apiFetch} onUpload={props.onUploadPatternImage} onCancel={()=>{setCreating(false);setRevision(n=>n+1);}} onSaved={no=>{setCreating(false);setRevision(n=>n+1);setNotice('花型 '+no+' 及配色已保存。');}}/>}
 </>;
}
