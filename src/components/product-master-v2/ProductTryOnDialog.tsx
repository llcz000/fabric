import {useEffect,useRef,useState} from 'react';
import {zipSync,strToU8} from 'fflate';
import type {CatalogProduct} from './catalogModel';
import {resolveImageUrls} from './catalogModel';
import {uploadImageAsset} from '../../lib/imageAssets';
import {categories,angles,targetGarments,createTryOnPrompt,listModelImages,readOriginalAsset,originalImageExtension,tryOnImageNames,type ModelImage,type PatternSize,type TargetGarment} from './modelGalleryClient';

export function ProductTryOnDialog({product,apiFetch,onClose,onSaved}:{product:CatalogProduct;apiFetch:typeof fetch;onClose():void;onSaved():void}){
 const [models,setModels]=useState<ModelImage[]>([]),[selected,setSelected]=useState<ModelImage|null>(null);
 const [urls,setUrls]=useState<Map<string,string>>(new Map()),[size,setSize]=useState<PatternSize>({widthCm:null,heightCm:null});
 const [scale,setScale]=useState(100),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [offset,setOffset]=useState(0),[total,setTotal]=useState(0);
 const [targetGarment,setTargetGarment]=useState<TargetGarment|''>(''),[targetDescription,setTargetDescription]=useState('');
 const [promptDrafts,setPromptDrafts]=useState<Record<string,string>>({});
 const resultRef=useRef<HTMLInputElement>(null),closeRef=useRef<HTMLButtonElement>(null),panelRef=useRef<HTMLDivElement>(null);
 const currentRef=useRef({busy,onClose});currentRef.current={busy,onClose};
 useEffect(()=>{
  const controller=new AbortController();setError('');
  void listModelImages(apiFetch,undefined,offset).then(async data=>{
   if(controller.signal.aborted)return;
   setModels(data.items);setTotal(data.total);
   const thumbs=await resolveImageUrls(apiFetch,data.items.map(x=>x.assetId),'display',controller.signal);
   if(!controller.signal.aborted)setUrls(thumbs);
  }).catch(()=>{if(!controller.signal.aborted)setError('模特图库加载失败');});
  return()=>controller.abort();
 },[apiFetch,offset]);
 useEffect(()=>{
  const controller=new AbortController();
  void apiFetch('/api/v2/pattern-masters/'+product.masterId+'/colorway-details',{signal:controller.signal}).then(async r=>{
   if(!r.ok)throw Error();
   const json=await r.json();
   if(!controller.signal.aborted)setSize({widthCm:typeof json.widthCm==='number'?json.widthCm:null,heightCm:typeof json.heightCm==='number'?json.heightCm:null});
  }).catch(()=>{if(!controller.signal.aborted)setSize({widthCm:null,heightCm:null});});
  return()=>controller.abort();
 },[apiFetch,product.masterId]);
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  closeRef.current?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'&&!currentRef.current.busy){e.preventDefault();currentRef.current.onClose();}
   if(e.key==='Tab'){
    const controls=Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]')??[])
     .filter(el=>el.offsetParent!==null);
    if(!controls.length)return;
    if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}
    else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0].focus();}
   }
  };
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('keydown',key);previous?.focus();};
 },[]);
 const targetReady=!!targetGarment&&(targetGarment!=='other'||!!targetDescription.trim());
 const defaultPrompt=selected&&targetReady?createTryOnPrompt(product,selected,size,scale,
  {targetGarment:targetGarment as TargetGarment,targetDescription}):'';
 // Each model/region/scale has its own draft; changing settings never exports stale instructions.
 const prompt=promptDrafts[defaultPrompt]??defaultPrompt;
 const canExport=!!selected&&targetReady&&!!prompt.trim()&&!busy;
 const selectModel=(model:ModelImage)=>{
  if(selected?.id!==model.id){setTargetGarment('');setTargetDescription('');setNotice('');}
  setSelected(model);
 };
 const downloadBundle=async()=>{
  if(!canExport||!selected||!product.patternImageAssetId)return;
  setBusy(true);setError('');setNotice('');
  try{
   const [pattern,model]=await Promise.all([
    readOriginalAsset(apiFetch,product.patternImageAssetId),readOriginalAsset(apiFetch,selected.assetId)
   ]);
   const meta={productNo:product.productNo,modelNo:selected.modelNo,patternWidthCm:size.widthCm,
    patternHeightCm:size.heightCm,scalePercent:scale,modelReferenceCm:selected.referenceCm,
    targetGarment,targetDescription:targetDescription.trim(),prompt,
    note:'模特参考长度仅供辅助判断；无真实尺寸标定时不能承诺厘米级精度。'};
   const names=tryOnImageNames(product,selected);
   const zip=zipSync({
    [names.pattern+originalImageExtension(pattern)]:pattern,
    [names.model+originalImageExtension(model)]:model,
    '03-prompt.txt':strToU8(prompt),
    '04-data.json':strToU8(JSON.stringify(meta,null,2))
   },{level:0});
   const blob=new Blob([new Uint8Array(zip)],{type:'application/zip'});
   const url=URL.createObjectURL(blob);
   const link=document.createElement('a');link.href=url;link.download='换装素材-'+product.productNo+'-'+selected.modelNo+'.zip';
   document.body.appendChild(link);link.click();link.remove();
   window.setTimeout(()=>URL.revokeObjectURL(url),20000);
   setNotice('素材已打包。将两张原图上传至 ChatGPT，并粘贴提示词。');
  }catch(e){setError(e instanceof Error?e.message:'素材准备失败');}
  finally{setBusy(false);}
 };
 const saveGenerated=async(file:File)=>{
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{
   const raw=await apiFetch('/api/v2/products/'+product.id,{cache:'no-store'});
   if(!raw.ok)throw Error('产品资料读取失败');
   const latest=await raw.json();
   if(!latest||latest.id!==product.id||!latest.images||!Array.isArray(latest.images.aiEffect)||!latest.rowVersion)
    throw Error('产品资料格式错误');
   if(latest.images.aiEffect.length>=10)throw Error('效果图已达到10张上限，请先在产品编辑页整理');
   const ready=await uploadImageAsset(file,'product_image',{apiFetch});
   const next={fabricDisplay:[...latest.images.fabricDisplay],detail:[...latest.images.detail],
    aiEffect:[...latest.images.aiEffect,ready.id]};
   const saved=await apiFetch('/api/v2/products/'+product.id,{method:'PATCH',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({expectedRowVersion:latest.rowVersion,images:next})});
   if(!saved.ok)throw Error(saved.status===409?'产品已被其他操作修改，请重新打开后再保存':'效果图关联失败（HTTP '+saved.status+'）');
   setNotice('效果图已保存至当前产品');onSaved();
  }catch(e){setError(e instanceof Error?e.message:'效果图保存失败');}
  finally{setBusy(false);if(resultRef.current)resultRef.current.value='';}
 };
 const copy=async()=>{if(!canExport)return;setError('');setNotice('');try{await navigator.clipboard.writeText(prompt);setNotice('提示词已复制');}catch{setError('复制失败，可在下方手动复制');}};
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" role="presentation">
  <div ref={panelRef} role="dialog" aria-modal="true" aria-label={'生成模特图 '+product.productNo} className="flex max-h-[95vh] w-full max-w-[880px] flex-col overflow-hidden rounded-xl bg-white text-[#191b24] shadow-xl">
   <div className="flex items-center justify-between gap-3 border-b px-4 py-3"><div className="min-w-0"><h2 className="break-words font-semibold">生成模特图 · {product.productNo}</h2><p className="text-xs text-slate-500">使用现有 ChatGPT 订阅生成，Fabric 负责素材和回存</p></div>
    <button ref={closeRef} disabled={busy} className="shrink-0 whitespace-nowrap rounded border px-3 py-1.5 text-xs" onClick={onClose}>关闭</button></div>
   <div className="space-y-4 overflow-y-auto p-4">
    {error&&<p role="alert" className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
    {notice&&<p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</p>}
    <div className="text-xs text-slate-600">花型 {product.masterNo}-{product.colorwayNo} · 原图整体尺寸：{size.widthCm&&size.heightCm?size.widthCm+' × '+size.heightCm+' cm':'未维护'} · {product.fabricName}</div>
    <div><strong className="text-sm">1. 选择模特</strong>
     <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
      {models.map(item=><button key={item.id} type="button" disabled={busy} onClick={()=>selectModel(item)}
       aria-pressed={selected?.id===item.id} className={'overflow-hidden rounded-lg border-2 text-left text-xs '+(selected?.id===item.id?'border-[#346ef6]':'border-slate-200')}>
       {urls.get(item.assetId)?<img src={urls.get(item.assetId)} alt={item.modelNo} loading="lazy" className="h-32 w-full object-contain"/>:<div className="h-32 bg-slate-100"/>}
       <span className="block p-2">{item.modelNo} · {categories[item.category]} · {angles[item.angle]}</span>
      </button>)}
     </div>
     <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>共 {total} 张</span><div className="flex gap-3">
      <button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>上一页</button><button disabled={offset+50>=total} onClick={()=>setOffset(offset+50)}>下一页</button></div></div>
    </div>
    <div className="rounded-lg border p-3"><strong className="text-sm">2. 准备换装素材</strong>
      {selected?<><div className="mt-3 flex flex-wrap items-end gap-3">
       <label className="text-xs">目标换装部位 <select disabled={busy} className="ml-1 rounded border p-1.5" value={targetGarment}
        onChange={e=>{setTargetGarment(e.target.value as TargetGarment|'');setNotice('');}}>
        <option value="">请选择部位</option>{Object.entries(targetGarments).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
       <label className="text-xs">花型比例 <select disabled={busy} className="ml-1 rounded border p-1.5" value={scale} onChange={e=>{setScale(Number(e.target.value));setNotice('');}}>
        {[80,90,100,110,120].map(x=><option key={x} value={x}>{x}%</option>)}</select></label>
      </div>
      <label className="mt-3 block text-xs">部位说明{targetGarment==='other'?'（必填）':'（选填）'}
       <input disabled={busy} value={targetDescription} onChange={e=>{setTargetDescription(e.target.value);setNotice('');}}
        placeholder="如：米白色蓬蓬半身裙，保留银色抹胸" className="mt-1 w-full rounded border p-2"/>
      </label>
      {targetReady?<>
      <p className="mt-2 text-xs text-slate-500">提示词可直接编辑。切换模特、部位或比例会显示对应提示词；返回相同设置可恢复本次草稿。</p>
      <textarea aria-label="换装提示词" disabled={busy} value={prompt} onChange={e=>{setPromptDrafts(drafts=>({...drafts,[defaultPrompt]:e.target.value}));setNotice('');}}
       rows={10} className="mt-2 w-full rounded border p-2 text-xs leading-relaxed"/>
      <button type="button" disabled={busy||prompt===defaultPrompt} onClick={()=>{setPromptDrafts(drafts=>{const next={...drafts};delete next[defaultPrompt];return next;});setNotice('');}}
       className="mt-1 text-xs text-[#0053da] disabled:opacity-50">恢复默认提示词</button>
      </>:<p className="mt-2 text-xs text-slate-500">{targetGarment==='other'?'请填写具体换装部位，再准备提示词。':'请选择本次要换装的部位，其他衣物保持不变。'}</p>}
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={!canExport||!product.patternImageAssetId}
       onClick={()=>void downloadBundle()} className="rounded bg-[#346ef6] px-3 py-2 text-xs text-white disabled:opacity-50">{busy?'处理中…':'下载素材包（两张原图＋提示词）'}</button>
       <button type="button" disabled={!canExport} onClick={()=>void copy()} className="rounded border px-3 py-2 text-xs disabled:opacity-50">复制提示词</button>
       <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer" className="rounded border px-3 py-2 text-xs text-[#0053da]">打开 ChatGPT</a></div></>:
      <p className="mt-2 text-xs text-slate-500">请先选择一张模特图片</p>}
    </div>
    <div className="rounded-lg border p-3"><strong className="text-sm">3. 保存已生成的效果图</strong>
     <p className="mt-1 text-xs text-slate-500">从 ChatGPT 保存图片后上传，将追加至当前产品的「效果图」，不覆盖原图。</p>
     <input ref={resultRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="mt-2 block w-full text-xs" disabled={busy}
      aria-label="上传生成的模特效果图" onChange={e=>{const file=e.target.files?.[0];if(file)void saveGenerated(file);}}/>
    </div>
   </div>
  </div>
 </div>;
}
