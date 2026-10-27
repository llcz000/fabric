import {patternBox as box,formatPatternTags as asTags} from './patternPresentation';
import { ActionIcon } from './ActionIcon';
import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import type { CatalogTag } from './catalogModel';
import { TopicFilterDropdown } from './TopicFilterDropdown';
import {ensureTopicTag,resolvePresetTopicForFilter,previewCustomTopicDeletion,deleteCustomTopic} from './topicCatalog';
import { uploadImageAsset } from '../../lib/imageAssets';
import { createLatestRequestGuard, loadCatalogTags, resolveImageUrls } from './catalogModel';
import { initialPatternFilters, reducePatternFilters, fetchPatternPage, fetchMasterColorways, createNextColorway, saveColorwayProperties, saveMasterTopicTags,  deleteUnreferencedColorway, type PatternMasterItem, type PatternVersionItem, type PatternPage, type PatternFilters } from './patternModel';
import {PatternPagination} from './PatternPagination';
import {RelatedProductsDialog} from './RelatedProductsDialog';
import {PatternMasterRows} from './PatternMasterRows';
import {PatternTopicQuickEdit} from './PatternTopicQuickEdit';
import {PatternOriginalViewer} from './PatternOriginalViewer';
import {PatternColorwayEditor} from './PatternColorwayEditor';
import {PatternBulkImportDialog} from './PatternBulkImportDialog';
import {deleteWholePatternMaster} from './patternBulkImportModel';
import {useConfirm} from '../ui/ConfirmDialog';
// image signing request max 100 IDs
function chunks<T>(items:T[],size:number):T[][]{
 const result:T[][]=[];for(let i=0;i<items.length;i+=size)result.push(items.slice(i,i+size));
 return result;
}

const throttle=100;


export interface PatternLibraryV2Props{
 apiFetch:typeof fetch;canManage?:boolean;onCreateMaster?():void;onEditorStateChange?(active:boolean):void;
 onShareMaster?(master:PatternMasterItem):void;onCreateProduct?(master:PatternMasterItem):void;
 onUploadPatternImage?(file:File):Promise<string>;
 resolvePatternImages?(ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal):Promise<Map<string,string>>;
}

export function PatternLibraryV2({apiFetch,canManage=false,onCreateMaster,onEditorStateChange,onUploadPatternImage,resolvePatternImages,onShareMaster,onCreateProduct}:PatternLibraryV2Props){
 const confirm=useConfirm();
 const imageResolver=useCallback((ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal)=>resolvePatternImages?resolvePatternImages(ids,variant,signal):resolveImageUrls(apiFetch,ids,variant,signal),[apiFetch,resolvePatternImages]);
 const [filters,setFilters]=useState<PatternFilters>({...initialPatternFilters});
 const [page,setPage]=useState<PatternPage|null>(null),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [topics,setTopics]=useState<CatalogTag[]>([]);
 const [tagsError,setTagsError]=useState('');
 const [thumbs,setThumbs]=useState<Map<string,string>>(new Map());
 const [selected,setSelected]=useState<PatternMasterItem|null>(null);
 const [quickTopicMaster,setQuickTopicMaster]=useState<PatternMasterItem|null>(null);
 const [linkedMaster,setLinkedMaster]=useState<PatternMasterItem|null>(null);
 const [editingItems,setEditingItems]=useState<PatternVersionItem[]>([]);
 const [editorThumbs,setEditorThumbs]=useState<Map<string,string>>(new Map());
 const [next,setNext]=useState(1),[editorLoading,setEditorLoading]=useState(false);
 const [editorError,setEditorError]=useState('');
 const [importOpen,setImportOpen]=useState(false),[deletePending,setDeletePending]=useState('');
 const [operationNotice,setOperationNotice]=useState(''),[operationError,setOperationError]=useState('');
 const [preview,setPreview]=useState<PatternVersionItem|null>(null);
 const [original,setOriginal]=useState<string|null>(null),[previewError,setPreviewError]=useState('');
 const listGuard=useRef(createLatestRequestGuard()),previewGuard=useRef(createLatestRequestGuard());
 const editGuard=useRef(createLatestRequestGuard());
 const dispatch=(action:Parameters<typeof reducePatternFilters>[1])=>setFilters(f=>reducePatternFilters(f,action));
 const registerFilterTag=(tag:CatalogTag)=>{
  setTopics(items=>[...items.filter(t=>t.id!==tag.id),tag]);
  setFilters(current=>current.topicTagIds.includes(tag.id)?current:{...current,topicTagIds:[...current.topicTagIds,tag.id],offset:0});
 };
 const resolveMissingPreset=async(name:string)=>registerFilterTag(await resolvePresetTopicForFilter(apiFetch,topics,name));
 const addCustomFilter=async(name:string)=>registerFilterTag(await ensureTopicTag(apiFetch,topics,name));
 const removeCustomFilter=async(tag:CatalogTag)=>{
  const impact=await previewCustomTopicDeletion(apiFetch,tag);
  const accepted=await confirm({title:'删除自定义题材「'+tag.name+'」？',danger:true,confirmText:'删除题材',
   message:impact.affectedCount>0?'删除后将同步移除 '+impact.affectedCount+' 个花型中的该题材标签，不影响这些花型的其他题材、配色或图片。':'删除后此题材将从可选列表移除。'});
  if(!accepted)return;
  await deleteCustomTopic(apiFetch,tag,impact.affectedCount);
  setTopics(list=>list.filter(item=>item.id!==tag.id));
  setFilters(current=>({...current,topicTagIds:current.topicTagIds.filter(id=>id!==tag.id),offset:0}));
  setRetry(value=>value+1);
 };
 useEffect(()=>{
  const ctrl=new AbortController();
  loadCatalogTags(apiFetch,'topic',ctrl.signal,true).then(a=>{if(!ctrl.signal.aborted)setTopics(a);})
   .catch(()=>{if(!ctrl.signal.aborted)setTagsError('标签加载失败，请刷新重试。');});
  return ()=>ctrl.abort();
 },[apiFetch]);
 useEffect(()=>{
  const ctrl=new AbortController(),rev=listGuard.current.next();
  setLoading(true);setError('');setThumbs(new Map());
  const timer=setTimeout(async()=>{
   try{
    const data=await fetchPatternPage(apiFetch,filters,ctrl.signal);
    if(ctrl.signal.aborted||!listGuard.current.isCurrent(rev))return;
    const lastOffset=data.total?Math.floor((data.total-1)/data.limit)*data.limit:0;
    if(data.offset>lastOffset){dispatch({type:'page',offset:lastOffset});return;}
    setPage(data);setLoading(false);
    const ids=[...new Set(data.items.flatMap(m=>m.versions.map(v=>v.patternImageAssetId).filter((s):s is string=>!!s)))];
    const map=new Map<string,string>();
    for(const batch of chunks(ids,throttle)){
     try{
      const value=await imageResolver(batch,'thumbnail',ctrl.signal);
      if(ctrl.signal.aborted||!listGuard.current.isCurrent(rev))return;
      for(const [k,v] of value)map.set(k,v);
      setThumbs(new Map(map));
     }catch{/* Missing/expired asset stays a non-clickable placeholder. */}
    }
   }catch{
    if(!ctrl.signal.aborted&&listGuard.current.isCurrent(rev)){setLoading(false);setError('花型数据加载失败，请重试。');}
   }
  },filters.number?180:0);
  return ()=>{clearTimeout(timer);ctrl.abort();listGuard.current.cancel();};
 },[apiFetch,filters,retry,imageResolver]);
 const openEdit=async(master:PatternMasterItem)=>{
  onEditorStateChange?.(true);
  setSelected(master);setEditingItems([]);setEditorThumbs(new Map());setEditorError('');setEditorLoading(true);
  const rev=editGuard.current.next();
  try{
   const result=await fetchMasterColorways(apiFetch,master);
   if(editGuard.current.isCurrent(rev)){
    setEditingItems(result.items);setNext(result.nextColorwayNo);
    const ids=[...new Set(result.items.map(v=>v.patternImageAssetId).filter((x):x is string=>!!x))];
    const signed=new Map<string,string>();
    for(const batch of chunks(ids,throttle)){
     try{const urls=await imageResolver(batch,'thumbnail');
      if(!editGuard.current.isCurrent(rev))return;
      for(const [k,v] of urls)signed.set(k,v);
      setEditorThumbs(new Map(signed));
     }catch{/* leave inaccessible originals as placeholders */}
    }
   }
  }catch(e){if(editGuard.current.isCurrent(rev))setEditorError(e instanceof Error?e.message:'配色编辑加载失败');}
  finally{if(editGuard.current.isCurrent(rev))setEditorLoading(false);}
 };
 const refreshEdit=async(master:PatternMasterItem)=>{
  const revision=editGuard.current.next();
  const result=await fetchMasterColorways(apiFetch,master);
  if(!editGuard.current.isCurrent(revision))return;
  if(selected?.id===master.id){
   setEditingItems(result.items);setNext(result.nextColorwayNo);
   const identities=[...new Set(result.items.map(item=>item.patternImageAssetId).filter((id):id is string=>Boolean(id)))],urls=new Map<string,string>();
   for(const batch of chunks(identities,throttle)){
    try{for(const [id,url] of await imageResolver(batch,'thumbnail'))urls.set(id,url);}catch{/* Unavailable image remains a placeholder. */}
    if(!editGuard.current.isCurrent(revision))return;
   }
   setEditorThumbs(urls);
  }
  setRetry(x=>x+1);
 };
 const closePreview=useCallback(()=>{previewGuard.current.cancel();setPreview(null);setOriginal(null);setPreviewError('');},[]);
 useEffect(()=>{
  if(!preview)return;
  const ctrl=new AbortController(),rev=previewGuard.current.next();
  setOriginal(null);setPreviewError('');
  (async()=>{try{
   if(!preview.patternImageAssetId)throw Error('No original');
   const urls=await imageResolver([preview.patternImageAssetId],'original',ctrl.signal);
   if(!ctrl.signal.aborted&&previewGuard.current.isCurrent(rev)){
    const url=urls.get(preview.patternImageAssetId);
    if(!url)throw Error('No image URL');setOriginal(url);
   }
  }catch{if(!ctrl.signal.aborted&&previewGuard.current.isCurrent(rev))setPreviewError('原图读取失败，请关闭后重试。');}})();
  return ()=>{ctrl.abort();previewGuard.current.cancel();};
 },[preview,apiFetch,imageResolver]);
 const selectedVersionSave=async(item:PatternVersionItem,draft:{remark:string;isActive:boolean;patternImageAssetId?:string|null})=>{
  await saveColorwayProperties(apiFetch,item,draft);
  try{await refreshEdit(selected!);}catch{setEditorError('配色已保存，但刷新失败。请重新打开花型核对，不要重复保存。');}
 };
 const add=async(input:{remark:string;isActive:boolean;patternImageAssetId?:string|null})=>{
  if(!selected)throw Error('Missing master');
  // A successful POST permanently reserves its number. Failure of the following
  // GET must NEVER leave the Add button treating that committed POST as retryable.
  await createNextColorway(apiFetch,selected.id,input);
  try{await refreshEdit(selected);}
  catch{setEditorError('新配色已保存，但刷新失败。请重新打开配色资料核对，切勿重复新增。');}
 };
 const saveQuickMasterTopics=(ids:string[],added:CatalogTag[])=>{
  if(!quickTopicMaster)return;
  const master=quickTopicMaster;
  const available=[...topics,...master.topicTags,...added],byId=new Map(available.map(tag=>[tag.id,tag]));
  const updated=ids.map(id=>byId.get(id)).filter((tag):tag is CatalogTag=>!!tag);
  setTopics(current=>[...current.filter(tag=>!added.some(item=>item.id===tag.id)),...added]);
  setPage(current=>current?{...current,items:current.items.map(item=>item.id===master.id?{...item,topicTags:updated}:item)}:current);
  setQuickTopicMaster(null);
  setOperationError('');setOperationNotice('');
  setRetry(v=>v+1);
 };
 const masterTagsSave=async(ids:string[])=>{
  if(!selected)throw Error('Missing master');
  await saveMasterTopicTags(apiFetch,selected.id,ids);
  // Refresh list and editor; newly loaded list is canonical for parent badges.
  setSelected({...selected,topicTags:topics.filter(t=>ids.includes(t.id))});
  setRetry(x=>x+1);
 };
 const uploadPatternImage=async(file:File)=>onUploadPatternImage?onUploadPatternImage(file):(await uploadImageAsset(file,'product_image',{apiFetch})).id;
 const deleteVersion=async(item:PatternVersionItem)=>{
  if(!selected)throw Error('Missing master');
  await deleteUnreferencedColorway(apiFetch,item.id);await refreshEdit(selected);
 };
 const deleteMaster=async(master:PatternMasterItem)=>{
  if(deletePending||!canManage)return;
  const ok=await confirm({title:'删除整个花型？',
   message:'将同时删除 '+master.masterNo+' 及其 '+master.versions.length+' 个配色版本。已关联产品或色卡时系统会拒绝删除；删除后不能恢复。',
   confirmText:'确认删除',danger:true});
  if(!ok)return;
  setDeletePending(master.id);setOperationError('');setOperationNotice('');
  try{
   await deleteWholePatternMaster(apiFetch,master.id);
   setOperationNotice('整个花型 '+master.masterNo+' 及全部配色已删除。');
   if(page?.items.length===1&&page.offset>0)dispatch({type:'page',offset:Math.max(0,page.offset-page.limit)});
   else setRetry(x=>x+1);
  }catch(cause){setOperationError(cause instanceof Error?cause.message:'删除失败，请刷新重试');}
  finally{setDeletePending('');}
 };
 return <section aria-label="V2 花型库" className="v2-pattern flex min-h-[520px] flex-col gap-3 bg-[#faf8ff] p-3 text-[#191b24] sm:p-5">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div><h1 className="text-xl font-semibold">花型库</h1><p className="mt-1 text-xs text-slate-500">花型、配色与标签统一管理</p></div>
   {canManage?<div className="flex flex-wrap gap-2">
    <button type="button" onClick={()=>{setImportOpen(true);setOperationNotice('');setOperationError('');}}
     className="rounded-lg border border-[#346ef6] bg-white px-3 py-2 text-sm text-[#0053da]">导入花型库</button>
    {onCreateMaster?<button onClick={onCreateMaster} type="button"
     className="rounded-lg bg-[#346ef6] px-3 py-2 text-sm text-white"><ActionIcon name="add"/>新增花型</button>:null}
   </div>:null}
  </header>
  <div className={box+' v2-library-filters flex flex-col'}>
   <div className="flex flex-wrap items-center gap-3">
   <label className="flex items-center gap-2">
    <Search size={15} aria-hidden="true" className="text-slate-500"/>
    <input aria-label="搜索编号" placeholder="花型编号" value={filters.number}
     onChange={e=>dispatch({type:'number',value:e.target.value})} className="w-40 rounded border border-slate-300 bg-white px-2 py-1.5 outline-[#346ef6]"/>
   </label>
   
   <button type="button" onClick={()=>dispatch({type:'reset'})} className="rounded px-2 py-1.5 text-sm text-[#0053da] hover:bg-[#eef1fd]"><ActionIcon name="reset"/>清空筛选</button>
   </div>
   <div className="grid gap-3 border-t border-slate-100 pt-3">
   <TopicFilterDropdown topics={topics} selected={filters.topicTagIds}
    onToggle={id=>dispatch({type:'topic',id})} onResolveMissing={resolveMissingPreset}
    onAddCustom={canManage?addCustomFilter:undefined} onArchiveCustom={canManage?removeCustomFilter:undefined}/>
   </div>
  </div>
  {tagsError?<p role="status" className="text-xs text-amber-700">{tagsError}</p>:null}
  {operationError?<p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-700">{operationError}</p>:null}
  {operationNotice?<p role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">{operationNotice}</p>:null}
  {loading?<p role="status" className="p-3 text-sm text-slate-500">正在加载花型…</p>:null}
  {error?<p role="alert" className="p-3 text-sm text-rose-700">{error}
   <button type="button" onClick={()=>setRetry(n=>n+1)} className="ml-2 underline"><ActionIcon name="refresh"/>重试</button></p>:null}
  {!loading&&!error&&page?<><PatternMasterRows items={page.items} thumbnailUrls={thumbs} onShare={onShareMaster}
   onPreview={setPreview} onEdit={openEdit} onDelete={canManage?deleteMaster:undefined}
   onQuickTopicEdit={canManage?setQuickTopicMaster:undefined} onViewProducts={setLinkedMaster}
   sort={filters.sort} onSort={()=>dispatch({type:'sort',value:filters.sort==='numberAsc'?'numberDesc':'numberAsc'})}
   onCreateProduct={canManage?onCreateProduct:undefined} canManage={canManage}/>
   <PatternPagination page={page} onPage={offset=>dispatch({type:'page',offset})}/></>:null}
  {linkedMaster?<RelatedProductsDialog key={linkedMaster.id} apiFetch={apiFetch}
   source={{kind:'pattern',id:linkedMaster.id,label:linkedMaster.masterNo}} onClose={()=>setLinkedMaster(null)}/>:null}
  {quickTopicMaster&&canManage?<PatternTopicQuickEdit key={quickTopicMaster.id} master={quickTopicMaster}
   topics={topics} apiFetch={apiFetch} onCancel={()=>setQuickTopicMaster(null)} onSaved={saveQuickMasterTopics}/>:null}
  {selected?<>{editorLoading?<div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 text-white">正在加载配色…</div>:
   editorError?<div role="alert" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
    <div className="rounded bg-white p-5 text-sm">{editorError}
     <button type="button" onClick={()=>setSelected(null)} className="ml-3 underline"><ActionIcon name="close"/>关闭</button>
     <button type="button" onClick={()=>openEdit(selected)} className="ml-3 underline"><ActionIcon name="refresh"/>重试</button>
    </div></div>:
   <PatternColorwayEditor key={selected.id} master={selected} items={editingItems}
    nextColorwayNo={next} topics={topics} apiFetch={apiFetch} canManage={canManage} onTopicCreated={tag=>setTopics(items=>[...items.filter(item=>item.id!==tag.id),tag])}
    thumbnailUrls={editorThumbs} onPreview={setPreview}
    onClose={()=>{editGuard.current.cancel();setSelected(null);onEditorStateChange?.(false);}} onSaveVersion={selectedVersionSave}
    onAdd={add} onSaveMasterTags={masterTagsSave}
    onUploadPatternImage={uploadPatternImage}
    onDeleteVersion={deleteVersion}/>}</>:null}
  {importOpen&&canManage?<PatternBulkImportDialog apiFetch={apiFetch} onUpload={uploadPatternImage}
   onClose={()=>setImportOpen(false)} onImported={count=>{
    setOperationNotice('成功导入 '+count+' 张花型图片。');dispatch({type:'reset'});setRetry(n=>n+1);
   }}/>:null}
  {preview?<PatternOriginalViewer current={preview}
   versions={selected?.id===preview.masterId&&editingItems.some(v=>v.id===preview.id)?editingItems:page?.items.find(m=>m.id===preview.masterId)?.versions??[preview]}
   original={original} error={previewError} onChange={setPreview} onClose={closePreview}/>:null}
 </section>;
}
export {PatternMasterRows,PatternColorwayEditor};
export {TagSelector,InlineColorTagEditor} from './PatternTagControls';
export type {PatternColorwayEditorProps} from './PatternColorwayEditor';
export default PatternLibraryV2;
