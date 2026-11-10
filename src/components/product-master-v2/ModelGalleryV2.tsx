import {useEffect,useRef,useState} from 'react';
import {Plus,Trash2,Image as ImageIcon} from 'lucide-react';
import {uploadImageAsset} from '../../lib/imageAssets';
import {useToast} from '../ui/Toast';
import {resolveImageUrls} from './catalogModel';
import {LibraryPagination} from './LibraryPagination';
import {listModelImages,MODEL_PAGE_SIZE,categories,angles,type ModelImage,type ModelCategory,type ModelAngle} from './modelGalleryClient';

export function ModelGalleryV2({apiFetch,canManage=true}:{apiFetch:typeof fetch;canManage?:boolean}){
 const toast=useToast();
 const [data,setData]=useState<{items:ModelImage[];total:number;offset:number}>({items:[],total:0,offset:0});
 const [category,setCategory]=useState<ModelCategory|''>('');
 const [offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
 const [urls,setUrls]=useState<Map<string,string>>(new Map());
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [uploadCategory,setUploadCategory]=useState<ModelCategory>('dress'),[angle,setAngle]=useState<ModelAngle>('front');
 const [note,setNote]=useState(''),[reference,setReference]=useState('');
 const [editing,setEditing]=useState<ModelImage|null>(null),[deleting,setDeleting]=useState<ModelImage|null>(null);
 const [editCategory,setEditCategory]=useState<ModelCategory>('dress'),[editAngle,setEditAngle]=useState<ModelAngle>('front');
 const [editNote,setEditNote]=useState(''),[editReference,setEditReference]=useState('');
 const [editImage,setEditImage]=useState<File|null>(null),[editError,setEditError]=useState('');
 const inputRef=useRef<HTMLInputElement>(null),dialogRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!editing&&!deleting)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const controls=()=>Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:enabled,input:enabled,select:enabled')??[]);
  controls()[0]?.focus();
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&controls().length){event.preventDefault();setEditImage(null);setEditing(null);setDeleting(null);}
   if(event.key==='Tab'){
    const items=controls();if(!items.length)return;
    if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1)?.focus();}
    if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0]?.focus();}
   }
  };
  document.addEventListener('keydown',onKey);
  return()=>{document.removeEventListener('keydown',onKey);previous?.focus();};
 },[editing,deleting]);
 const refresh=()=>setRetry(n=>n+1);
 useEffect(()=>{
  const controller=new AbortController();setError('');
  void listModelImages(apiFetch,category||undefined,offset).then(async result=>{
   if(controller.signal.aborted)return;
   if(offset>0&&offset>=result.total){
    setOffset(Math.max(0,Math.ceil(result.total/MODEL_PAGE_SIZE)-1)*MODEL_PAGE_SIZE);
    return;
   }
   setData({...result,offset});
   const loaded=await resolveImageUrls(apiFetch,result.items.map(x=>x.assetId),'display',controller.signal);
   if(!controller.signal.aborted)setUrls(loaded);
  }).catch(()=>{if(!controller.signal.aborted)setError('模特图库读取失败，请检查服务端后重试');});
  return ()=>controller.abort();
 },[apiFetch,category,offset,retry]);
 const add=async(files:FileList|null)=>{
  if(!files?.length||busy)return;
  setBusy(true);setError('');
  let completed=0;
  try{
   if(files.length>50)throw Error('每批最多导入50张图片');
   const cm=reference.trim()?Number(reference):null;
   if(cm!==null&&(!Number.isFinite(cm)||cm<=0||cm>300))throw Error('参考尺寸必须在0-300厘米内');
   for(const file of Array.from(files)){
    try{
     const asset=await uploadImageAsset(file,'product_image',{apiFetch});
     const response=await apiFetch('/api/v2/models',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({assetId:asset.id,category:uploadCategory,angle,note,referenceCm:cm})});
     if(!response.ok){
      const detail=await response.json().catch(()=>null);
      throw Error(typeof detail?.error==='string'?detail.error:'关联失败 HTTP '+response.status);
     }
     completed++;
    }catch(e){throw Error(file.name+'失败：'+(e instanceof Error?e.message:'未知错误'));}
   }
   toast.success('已导入 '+completed+' / '+files.length+' 张');
  }catch(e){toast.error('已导入 '+completed+' / '+files.length+' 张；'+(e instanceof Error?e.message:'未知错误'));}
  finally{if(completed){setOffset(0);refresh();}setBusy(false);if(inputRef.current)inputRef.current.value='';}
 };
 const saveEdit=async()=>{
  if(!editing||busy)return;
  setBusy(true);setEditError('');
  try{
   const cm=editReference.trim()?Number(editReference):null;
   if(cm!==null&&(!Number.isFinite(cm)||cm<=0||cm>300))throw Error('参考尺寸无效');
   const changes:Partial<Pick<ModelImage,'category'|'angle'|'note'|'referenceCm'|'assetId'>>&{expectedAssetId?:string}={};
   if(editCategory!==editing.category)changes.category=editCategory;
   if(editAngle!==editing.angle)changes.angle=editAngle;
   if(editNote!==editing.note)changes.note=editNote;
   if(cm!==editing.referenceCm)changes.referenceCm=cm;
   if(editImage){
    const asset=await uploadImageAsset(editImage,'product_image',{apiFetch});
    changes.assetId=asset.id;
    changes.expectedAssetId=editing.assetId;
   }
   if(!Object.keys(changes).length){setEditing(null);return;}
   const r=await apiFetch('/api/v2/models/'+editing.id,{method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(changes)});
   if(!r.ok){
    const detail=await r.json().catch(()=>null);
    throw Error(typeof detail?.error==='string'?detail.error:'修改失败（HTTP '+r.status+'）');
   }
   setEditImage(null);setEditing(null);refresh();
   toast.success(editImage?'已替换模特图片':'已保存模特资料');
  }catch(e){setEditError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
 };
 const remove=async()=>{
  if(!deleting)return;
  setBusy(true);setError('');
  try{
   const r=await apiFetch('/api/v2/models/'+deleting.id,{method:'DELETE'});
   if(!r.ok)throw Error('删除失败（HTTP '+r.status+'）');
   setDeleting(null);refresh();
  }catch(e){setError(e instanceof Error?e.message:'删除失败');}finally{setBusy(false);}
 };
 const pagination={offset:data.offset,limit:MODEL_PAGE_SIZE,total:data.total};
 const paginationPending=busy||(!error&&offset!==data.offset);
 return <section className="v2-catalog space-y-3 bg-[#faf8ff] p-3 text-[#191b24] sm:p-5" aria-label="模特图库">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">模特图库</h1><p className="text-xs text-slate-500">保存原图，供产品换装反复使用</p></div>
  <label className="text-xs">服装类别 <select aria-label="筛选模特类别" className="rounded border bg-white p-2" value={category} onChange={e=>{setCategory(e.target.value as ModelCategory|'');setOffset(0);}}>
    <option value="">全部</option>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
  {canManage&&<div className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3 text-xs">
   <label>类别 <select aria-label="新模特服装类别" className="block rounded border p-2" value={uploadCategory} onChange={e=>setUploadCategory(e.target.value as ModelCategory)}>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label>角度 <select aria-label="新模特展示角度" className="block rounded border p-2" value={angle} onChange={e=>setAngle(e.target.value as ModelAngle)}>{Object.entries(angles).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label>参考尺寸（可留空）<input className="block w-32 rounded border p-2" value={reference} onChange={e=>setReference(e.target.value)} inputMode="decimal" placeholder="厘米"/></label>
   <label className="flex-1">备注（可留空）<input className="block w-full min-w-36 rounded border p-2" maxLength={400} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only" aria-label="上传模特图片" onChange={e=>void add(e.target.files)}/>
   <button className="inline-flex items-center gap-1 rounded bg-[#346ef6] px-3 py-2 text-white disabled:opacity-50" disabled={busy} type="button" onClick={()=>inputRef.current?.click()}><Plus size={15}/>{busy?'正在处理…':'导入模特'}</button>
  </div>}
  {error&&<p role="alert" className="rounded border border-rose-200 bg-white p-2 text-sm text-rose-700">{error}<button type="button" onClick={refresh} className="ml-2 underline">重试</button></p>}
  <LibraryPagination label="模特列表顶部分页" page={pagination} summary={<>共 {data.total} 张</>} onPage={setOffset} disabled={paginationPending}/>
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
  {data.items.map(item=><article key={item.id} className="overflow-hidden rounded-lg border border-[#c3c6d7] bg-white">
    <div className="relative aspect-[3/4] w-full bg-slate-50">
    {urls.has(item.assetId)?<img src={urls.get(item.assetId)} alt={'模特 '+item.modelNo} loading="lazy" className="absolute inset-0 h-full w-full object-contain"/>:
    <div className="absolute inset-0 flex items-center justify-center text-slate-400"><ImageIcon size={26}/></div>}
    </div>
    <div className="space-y-1 p-2 text-xs"><strong>{item.modelNo}</strong><p>{categories[item.category]} · {angles[item.angle]}</p>
    <p className="h-4 truncate" title={item.note}>{item.note}</p>
    {canManage&&<div className="flex gap-3 pt-1"><button type="button" disabled={busy} className="text-[#0053da]" onClick={()=>{setEditing(item);setEditCategory(item.category);setEditAngle(item.angle);setEditNote(item.note);setEditReference(item.referenceCm?.toString()??'');setEditImage(null);setEditError('');}}>编辑</button>
    <button type="button" disabled={busy} className="inline-flex items-center gap-1 text-rose-700" onClick={()=>setDeleting(item)}><Trash2 size={12}/>删除</button></div>}
    </div>
   </article>)}
  </div>
  {!data.items.length&&<p className="rounded border bg-white p-8 text-center text-sm text-slate-500">暂无模特图片</p>}
  <LibraryPagination label="模特分页" page={pagination} summary={<>共 {data.total} 张</>} onPage={setOffset} disabled={paginationPending}/>
  {editing&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3" role="presentation"><div ref={dialogRef} role="dialog" aria-modal="true" aria-label={'编辑 '+editing.modelNo} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-sm space-y-3 overflow-y-auto rounded-xl bg-white p-5 text-sm">
    <h2 className="font-semibold">编辑 {editing.modelNo}</h2>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
    <label className="block">替换图片（可选）<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="block w-full min-w-0 rounded border p-2 text-xs" onChange={e=>{setEditImage(e.target.files?.[0]??null);setEditError('');}}/></label>
    <p className="text-xs text-slate-600">保存后沿用当前编号。类别、角度、参考尺寸和备注可按需修改。</p>
    <label className="block">服装类别<select className="block w-full rounded border p-2" value={editCategory} onChange={e=>setEditCategory(e.target.value as ModelCategory)}>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label className="block">展示角度<select className="block w-full rounded border p-2" value={editAngle} onChange={e=>setEditAngle(e.target.value as ModelAngle)}>{Object.entries(angles).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label className="block">尺寸参考（厘米，可留空）<input className="block w-full rounded border p-2" value={editReference} onChange={e=>setEditReference(e.target.value)}/></label>
    <label className="block">备注<input className="block w-full rounded border p-2" maxLength={400} value={editNote} onChange={e=>setEditNote(e.target.value)}/></label>
    </fieldset>
    {editError&&<p role="alert" className="break-words text-xs text-rose-700">{editError}</p>}
    <div className="flex justify-end gap-2"><button disabled={busy} onClick={()=>{setEditImage(null);setEditing(null);}}>取消</button><button className="rounded bg-[#346ef6] px-3 py-2 text-white" disabled={busy} onClick={()=>void saveEdit()}>{busy?'保存中…':'保存'}</button></div>
   </div></div>}
  {deleting&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3" role="presentation"><div ref={dialogRef} role="alertdialog" aria-modal="true" aria-label="确认删除模特" className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5">
    <h2 className="font-semibold">删除 {deleting.modelNo}？</h2><p className="text-sm text-slate-600">删除后将从图库移除，不影响已保存的产品效果图。</p>
    <div className="flex justify-end gap-3"><button disabled={busy} onClick={()=>setDeleting(null)}>取消</button><button disabled={busy} className="rounded bg-rose-700 px-3 py-2 text-white" onClick={()=>void remove()}>确认删除</button></div>
   </div></div>}
 </section>;
}
