import './patternWorkspace.css';
import {saveMasterDimensions} from './patternModel';
import { ActionIcon } from './ActionIcon';
import { useState, useEffect, useRef, useCallback } from 'react';
import { FolderOpen, Grid2X2, List, Plus, Search, X } from 'lucide-react';
import type { CatalogTag } from './catalogModel';
import { TopicFilterDropdown } from './TopicFilterDropdown';
import {ensureTopicTag,resolvePresetTopicForFilter,previewCustomTopicDeletion,deleteCustomTopic} from './topicCatalog';
import { uploadImageAsset } from '../../lib/imageAssets';
import { createLatestRequestGuard, loadCatalogTags, resolveImageUrls } from './catalogModel';
import { initialPatternFilters, reducePatternFilters, fetchPatternPage, fetchMasterColorways, createNextColorway, saveColorwayProperties, saveMasterTopicTags,  deleteUnreferencedColorway, type PatternMasterItem, type PatternVersionItem, type PatternPage, type PatternFilters } from './patternModel';
import {PatternPagination} from './PatternPagination';
import {RelatedProductsDialog, type RelatedProductSource} from './RelatedProductsDialog';
import {PatternImageGrid} from './PatternImageGrid';
import {PatternMasterRows} from './PatternMasterRows';
import {PatternTopicQuickEdit} from './PatternTopicQuickEdit';
import {PatternOriginalViewer} from './PatternOriginalViewer';
import {PatternColorwayEditor} from './PatternColorwayEditor';
import {PatternDeleteDialog} from './PatternDeleteDialog';
import {PatternBulkImportDialog} from './PatternBulkImportDialog';
import {deleteWholePatternMaster} from './patternBulkImportModel';
import {useConfirm} from '../ui/ConfirmDialog';
import {useToast} from '../ui/Toast';
// image signing request max 100 IDs
function chunks<T>(items:T[],size:number):T[][]{
 const result:T[][]=[];for(let i=0;i<items.length;i+=size)result.push(items.slice(i,i+size));
 return result;
}

const throttle=100;


export interface PatternLibraryV2Props{
 apiFetch:typeof fetch;canManage?:boolean;onCreateMaster?():void;onEditorStateChange?(active:boolean):void;
 catalogRevision?:number;
 onShareMaster?(master:PatternMasterItem):void;onCreateProduct?(master:PatternMasterItem):void;
 onUploadPatternImage?(file:File):Promise<string>;
 resolvePatternImages?(ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal):Promise<Map<string,string>>;
}

export function PatternLibraryV2({apiFetch,canManage=false,onCreateMaster,onEditorStateChange,onUploadPatternImage,resolvePatternImages,onShareMaster,onCreateProduct,catalogRevision}:PatternLibraryV2Props){
 const confirm=useConfirm();
 const toast=useToast();
 const imageResolver=useCallback((ids:string[],variant:'thumbnail'|'display'|'original',signal?:AbortSignal)=>resolvePatternImages?resolvePatternImages(ids,variant,signal):resolveImageUrls(apiFetch,ids,variant,signal),[apiFetch,resolvePatternImages]);
 const [filters,setFilters]=useState<PatternFilters>({...initialPatternFilters});
 const [view,setView]=useState<'list'|'grid'>('list');
 const [page,setPage]=useState<PatternPage|null>(null),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [topics,setTopics]=useState<CatalogTag[]>([]);
 const [tagsError,setTagsError]=useState('');
 const [imagesPending,setImagesPending]=useState(false);
 const [thumbs,setThumbs]=useState<Map<string,string>>(new Map());
 const [selected,setSelected]=useState<PatternMasterItem|null>(null);
 const [quickTopicMaster,setQuickTopicMaster]=useState<PatternMasterItem|null>(null);
 const [linkedSource,setLinkedSource]=useState<RelatedProductSource|null>(null);
 const [editingItems,setEditingItems]=useState<PatternVersionItem[]>([]);
 const [editorThumbs,setEditorThumbs]=useState<Map<string,string>>(new Map());
 const [next,setNext]=useState(1),[editorLoading,setEditorLoading]=useState(false);
 const [editorError,setEditorError]=useState('');
 const [importOpen,setImportOpen]=useState(false),[masterToDelete,setMasterToDelete]=useState<PatternMasterItem|null>(null);
 const [preview,setPreview]=useState<PatternVersionItem|null>(null);
 const [gridPreview,setGridPreview]=useState<{master:PatternMasterItem;versionId:string;thumbnail?:string}|null>(null);
 const [gridVersions,setGridVersions]=useState<PatternVersionItem[]|null>(null);
 const [gridVersionsFailed,setGridVersionsFailed]=useState(false);
 const [gridVersionsRetry,retryGridVersions]=useState(0);
 const [original,setOriginal]=useState<string|null>(null),[previewError,setPreviewError]=useState('');
 const [originalRetry,setOriginalRetry]=useState(0);
 const listGuard=useRef(createLatestRequestGuard()),previewGuard=useRef(createLatestRequestGuard());
 const editGuard=useRef(createLatestRequestGuard());
 const searchInput=useRef<HTMLInputElement>(null);
 const dispatch=(action:Parameters<typeof reducePatternFilters>[1])=>setFilters(f=>reducePatternFilters(f,action));
 const registerFilterTag=(tag:CatalogTag)=>{
  setTopics(items=>[...items.filter(t=>t.id!==tag.id),tag]);
  setFilters(current=>current.topicTagIds.includes(tag.id)?current:{...current,topicTagIds:[...current.topicTagIds,tag.id],offset:0});
 };
 const resolveMissingPreset=async(name:string)=>registerFilterTag(await resolvePresetTopicForFilter(apiFetch,topics,name));
 const addCustomFilter=async(name:string)=>{
  const tag=await ensureTopicTag(apiFetch,topics,name);
  setTopics(items=>[...items.filter(item=>item.id!==tag.id),tag]);
 };
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
  if(view!=='list')return;
  const ctrl=new AbortController(),rev=listGuard.current.next();
  setLoading(true);setError('');setImagesPending(true);setThumbs(new Map());
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
     }catch{/* Each missing asset can be retried from its own row. */}
    }
    if(!ctrl.signal.aborted&&listGuard.current.isCurrent(rev))setImagesPending(false);
   }catch{
    if(!ctrl.signal.aborted&&listGuard.current.isCurrent(rev)){setLoading(false);setImagesPending(false);setError('花型数据加载失败，请重试。');}
   }
  },filters.number?180:0);
  return ()=>{clearTimeout(timer);ctrl.abort();listGuard.current.cancel();};
 },[apiFetch,filters,retry,imageResolver,catalogRevision,view]);
 const openEdit=async(master:PatternMasterItem)=>{
  onEditorStateChange?.(true);
  setSelected(master);setEditingItems([]);setEditorThumbs(new Map());setEditorError('');setEditorLoading(true);
  const rev=editGuard.current.next();
  try{
   const result=await fetchMasterColorways(apiFetch,master);
   if(editGuard.current.isCurrent(rev)){
    setEditingItems(result.items);setNext(result.nextColorwayNo);
    setSelected(previous=>previous?.id===master.id?{...previous,...('widthCm' in result?{widthCm:result.widthCm,heightCm:result.heightCm}:{})}:previous);
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
 const closePreview=useCallback(()=>{
  previewGuard.current.cancel();setPreview(null);setOriginal(null);setPreviewError('');
  setGridPreview(null);setGridVersions(null);setGridVersionsFailed(false);
 },[]);
 useEffect(()=>{
  if(!gridPreview)return;
  const controller=new AbortController();
  setGridVersionsFailed(false);
  void fetchMasterColorways(apiFetch,gridPreview.master,controller.signal).then(result=>{
   if(!controller.signal.aborted)setGridVersions(result.items);
  }).catch(()=>{
   if(!controller.signal.aborted)setGridVersionsFailed(true);
  });
  return ()=>controller.abort();
 },[apiFetch,gridPreview,gridVersionsRetry]);
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
  }catch{if(!ctrl.signal.aborted&&previewGuard.current.isCurrent(rev))setPreviewError('原图暂时无法读取。');}})();
  return ()=>{ctrl.abort();previewGuard.current.cancel();};
 },[preview,imageResolver,originalRetry]);
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
 const resolveUploadedThumbnail=async(assetId:string)=>{
   const urls=await imageResolver([assetId],'thumbnail');
   return urls.get(assetId);
  };
  const deleteVersion=async(item:PatternVersionItem)=>{
  if(!selected)throw Error('Missing master');
  await deleteUnreferencedColorway(apiFetch,item.id);await refreshEdit(selected);
 };
 const deleteMaster=async(master:PatternMasterItem)=>{
  await deleteWholePatternMaster(apiFetch,master.id);
  toast.success('整个花型 '+master.masterNo+' 及全部配色已删除。');
  if(page?.items.length===1&&page.offset>0)dispatch({type:'page',offset:Math.max(0,page.offset-page.limit)});
  else setRetry(x=>x+1);
 };
 return <section aria-label="V2 花型库" className="v2-pattern pattern-workspace">
  <header className="pattern-library-heading">
   <h1>花型库</h1>
   {canManage&&<div className="pattern-library-actions">
    <button type="button" onClick={()=>setImportOpen(true)} className="pattern-action pattern-action-secondary">
     <FolderOpen size={16} aria-hidden="true"/>导入花型库</button>
    {onCreateMaster&&<button onClick={onCreateMaster} type="button" className="pattern-action pattern-action-primary">
     <Plus size={17} aria-hidden="true"/>新增花型</button>}
   </div>}
  </header>
  <div className="v2-library-filters pattern-library-filterbar" role="search" aria-label="花型筛选">
   <label className="pattern-library-search">
    <Search size={17} aria-hidden="true"/>
    <input ref={searchInput} aria-label="搜索编号" placeholder="花型编号或配色号" value={filters.number}
     onChange={event=>dispatch({type:'number',value:event.target.value})}/>
   </label>
   <TopicFilterDropdown topics={topics} selected={filters.topicTagIds}
    onToggle={id=>dispatch({type:'topic',id})} onResolveMissing={resolveMissingPreset}
    onAddCustom={canManage?addCustomFilter:undefined} onArchiveCustom={canManage?removeCustomFilter:undefined}/>
   {(filters.number||filters.topicTagIds.length>0||filters.sort!=='newest')&&
    <button type="button" aria-label="清空筛选" onClick={()=>{dispatch({type:'reset'});searchInput.current?.focus();}} className="pattern-text-action pattern-library-reset">
     <X size={16} aria-hidden="true"/><span className="pattern-library-reset-label">清空筛选</span></button>}
   <div className="pattern-view-tools">
    {view==='grid'&&<select className="pattern-grid-sort" aria-label="花型排序" value={filters.sort}
     onChange={event=>dispatch({type:'sort',value:event.target.value as PatternFilters['sort']})}>
     <option value="newest">最新</option><option value="numberAsc">编号升序</option><option value="numberDesc">编号降序</option>
    </select>}
    <div className="pattern-view-switch" role="group" aria-label="花型库视图">
     <button type="button" aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={16} aria-hidden="true"/>列表</button>
     <button type="button" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><Grid2X2 size={16} aria-hidden="true"/>看图</button>
    </div>
   </div>
  </div>
  {tagsError?<p role="status" className="text-xs text-amber-700">{tagsError}</p>:null}
  {view==='grid'?<PatternImageGrid key={JSON.stringify([filters,retry,catalogRevision])} apiFetch={apiFetch} filters={filters} resolveImages={imageResolver}
   onPreview={(master,version,thumbnail)=>{setGridPreview({master,versionId:version.id,thumbnail});setPreview(version);}}/>:<>
  {loading?<p role="status" className="p-3 text-sm text-slate-500">正在加载花型…</p>:null}
  {error?<p role="alert" className="p-3 text-sm text-rose-700">{error}
   <button type="button" onClick={()=>setRetry(n=>n+1)} className="ml-2 underline"><ActionIcon name="refresh"/>重试</button></p>:null}
  {!loading&&!error&&page?<>
   <PatternPagination label="花型列表顶部分页" page={page} onPage={offset=>dispatch({type:'page',offset})}/>
   <PatternMasterRows items={page.items} thumbnailUrls={thumbs} onShare={onShareMaster}
   onPreview={setPreview} onEdit={openEdit} onDelete={canManage?setMasterToDelete:undefined}
   onQuickTopicEdit={canManage?setQuickTopicMaster:undefined} onViewProducts={master=>setLinkedSource({kind:'pattern',id:master.id,label:master.masterNo})}
   sort={filters.sort} onSort={()=>dispatch({type:'sort',value:filters.sort==='numberAsc'?'numberDesc':'numberAsc'})}
   onCreateProduct={canManage?onCreateProduct:undefined} canManage={canManage}
   imagesPending={imagesPending} onRetryThumbnail={resolveUploadedThumbnail}/>
   <PatternPagination page={page} onPage={offset=>dispatch({type:'page',offset})}/></>:null}</>}
  {masterToDelete&&<PatternDeleteDialog key={masterToDelete.id} apiFetch={apiFetch} kind="pattern"
   id={masterToDelete.id} label={masterToDelete.masterNo} onClose={()=>setMasterToDelete(null)}
   onDelete={()=>deleteMaster(masterToDelete)}/>}
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
    thumbnailUrls={editorThumbs} onPreview={setPreview} onResolveThumbnail={resolveUploadedThumbnail}
    onClose={()=>{editGuard.current.cancel();setSelected(null);onEditorStateChange?.(false);}} onSaveVersion={selectedVersionSave}
    onAdd={add} onSaveMasterTags={masterTagsSave} onSaveDimensions={async dimensions=>{
     const saved=await saveMasterDimensions(apiFetch,selected.id,dimensions);
     listGuard.current.cancel();
     setSelected(current=>current?.id===selected.id?{...current,...saved}:current);
     setPage(current=>current?{...current,items:current.items.map(item=>item.id===selected.id?{...item,...saved}:item)}:current);
     setRetry(value=>value+1);
    }}
    onUploadPatternImage={uploadPatternImage}
    onDeleteVersion={deleteVersion}/>}</>:null}
  {importOpen&&canManage?<PatternBulkImportDialog apiFetch={apiFetch} onUpload={uploadPatternImage}
   onClose={()=>setImportOpen(false)} onImported={count=>{
    toast.success('成功导入 '+count+' 张花型图片。');setRetry(n=>n+1);
   }}/>:null}
  {preview?<PatternOriginalViewer current={preview}
   versions={gridPreview?gridVersions??gridPreview.master.versions:selected?.id===preview.masterId&&editingItems.some(v=>v.id===preview.id)?editingItems:page?.items.find(m=>m.id===preview.masterId)?.versions??[preview]}
   thumbnail={gridPreview?.versionId===preview.id?gridPreview.thumbnail:undefined}
   inactive={linkedSource!==null}
   onRelatedProducts={gridPreview?()=>setLinkedSource({kind:'colorway',id:preview.id,label:preview.patternNo}):undefined}
   onRetryVersions={gridPreview&&gridVersionsFailed?()=>retryGridVersions(n=>n+1):undefined}
   original={original} error={previewError} onChange={next=>{setOriginal(null);setPreviewError('');setPreview(next);}} onClose={closePreview}
   onImageError={()=>{setOriginal(null);setPreviewError('原图无法显示。');}}
   onRetry={()=>{setOriginal(null);setPreviewError('');setOriginalRetry(n=>n+1);}}/>:null}
  {linkedSource?<RelatedProductsDialog key={linkedSource.kind+':'+linkedSource.id} apiFetch={apiFetch}
   source={linkedSource} showProductLink={linkedSource.kind==='colorway'} onClose={()=>setLinkedSource(null)}/>:null}
 </section>;
}
export {PatternMasterRows,PatternColorwayEditor};
export {TagSelector,InlineColorTagEditor} from './PatternTagControls';
export type {PatternColorwayEditorProps} from './PatternColorwayEditor';
export default PatternLibraryV2;
