import {ImagePlus,Plus,Upload,Trash2} from 'lucide-react';
import React,{useEffect,useRef,useState} from 'react';
import {useConfirm} from '../ui/ConfirmDialog';
import {useToast} from '../ui/Toast';
import {PatternLibraryV2,type PatternLibraryV2Props} from './PatternLibraryV2';
import {TopicTagPicker} from './TopicTagPicker';
import {normalizePatternNumber,savePatternDraft,type PatternCreationProgress,type PatternColorDraft} from './patternCreateModel';
import {loadCatalogTags,resolveImageUrls,type CatalogTag} from './catalogModel';
import {uploadImageAsset} from '../../lib/imageAssets';
import {parsePatternDimensionDraft} from '../../lib/patternDimensions';
import {PatternDimensionFields} from './PatternDimensionFields';
import {verifyPatternThumbnail} from './PatternThumbnail';

type Draft=PatternColorDraft&{file?:File;thumbnail?:string};
type UploadStep={key:string;stage:'upload'|'check'};
const imageTypes=['image/jpeg','image/png','image/webp','image/gif'];

function DraftImage({file,thumbnail}:{file:File;thumbnail?:string}){
 const [url,setUrl]=useState(''),[broken,setBroken]=useState(false);
 useEffect(()=>{
  if(thumbnail)return;
  setBroken(false);
  const local=URL.createObjectURL(file);
  setUrl(local);
  return()=>URL.revokeObjectURL(local);
 },[file,thumbnail]);
 return <div className="pattern-create-preview">
  {(!broken||thumbnail)&&(thumbnail||url)?<img src={thumbnail??url} alt="待保存花型图" onError={()=>setBroken(true)}/>:
   <span className="pattern-preview-unavailable">本机未预览</span>}
 </div>;
}

export function CreatePattern({apiFetch,onCancel,onSaved,onUpload,resolveImages}:{
 apiFetch:typeof fetch;onCancel(refreshCatalog:boolean):void;onSaved(no:string):void;onUpload?(file:File):Promise<string>;
 resolveImages?:PatternLibraryV2Props['resolvePatternImages'];
}){
 const confirm=useConfirm();
 const dialog=useRef<HTMLDialogElement>(null),progress=useRef<PatternCreationProgress>({}),sequence=useRef(1);
 const submitting=useRef(false);
 const [number,setNumber]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [width,setWidth]=useState(''),[height,setHeight]=useState('');
 const [drafts,setDrafts]=useState<Draft[]>([{key:'1',remark:''}]);
 const [step,setStep]=useState<UploadStep|null>(null);
 const [imageErrors,setImageErrors]=useState<Record<string,string>>({});
 const [topics,setTopics]=useState<CatalogTag[]>([]),[topicIds,setTopicIds]=useState<string[]>([]);
 const [tagsLoading,setTagsLoading]=useState(true),[tagsError,setTagsError]=useState(''),[tagRevision,setTagRevision]=useState(0);

 useEffect(()=>{
  const abort=new AbortController();
  setTagsLoading(true);setTagsError('');
  loadCatalogTags(apiFetch,'topic',abort.signal).then(tags=>{
   if(!abort.signal.aborted)setTopics(tags);
  }).catch(()=>{
   if(!abort.signal.aborted)setTagsError('题材标签读取失败。');
  }).finally(()=>{
   if(!abort.signal.aborted)setTagsLoading(false);
  });
  return()=>abort.abort();
 },[apiFetch,tagRevision]);

 useEffect(()=>{
  const node=dialog.current,trigger=document.activeElement;
  node?.showModal();
  return()=>{node?.close();if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus();};
 },[]);

 const selectImage=(key:string,file:File)=>{
  if(!imageTypes.includes(file.type)||file.size===0||file.size>20*1024*1024){
   setImageErrors(current=>({...current,[key]:'请选择 20 MB 以内的 JPG、PNG、WebP 或 GIF 图片。'}));
   return;
  }
  setImageErrors(current=>({...current,[key]:''}));
  setDrafts(current=>current.map(draft=>draft.key===key?{...draft,file,thumbnail:undefined,patternImageAssetId:undefined}:draft));
 };
 const removeImage=(key:string)=>{
  setImageErrors(current=>({...current,[key]:''}));
  setDrafts(current=>current.map(draft=>draft.key===key?{...draft,file:undefined,thumbnail:undefined,patternImageAssetId:undefined}:draft));
 };

 const cancel=async()=>{
  if(submitting.current)return;
  if(number||width||height||drafts.some(item=>item.file||item.remark)||topicIds.length||drafts.length>1){
   const ok=await confirm({
    title:progress.current.master?'关闭新增花型？':'放弃未保存的花型资料？',
    message:progress.current.master?'花型编号及已保存配色已入库，关闭后请在花型库继续编辑。':'当前资料尚未保存，放弃后无法恢复。',
    confirmText:'确认关闭',danger:true
   });
   if(!ok)return;
  }
  onCancel(Boolean(progress.current.master||progress.current.uncertain));
 };
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  if(submitting.current||tagsLoading||tagsError||progress.current.uncertain)return;
  submitting.current=true;setBusy(true);setError('');
  try{
   const masterNo=normalizePatternNumber(number);
   const dimensions=parsePatternDimensionDraft(width,height);
   for(const draft of drafts){
    if(!draft.file||draft.thumbnail)continue;
    setImageErrors(current=>({...current,[draft.key]:''}));
    try{
     if(!draft.patternImageAssetId){
      setStep({key:draft.key,stage:'upload'});
      draft.patternImageAssetId=onUpload?await onUpload(draft.file):(await uploadImageAsset(draft.file,'product_image',{apiFetch})).id;
     }
     const id=draft.patternImageAssetId;
     setStep({key:draft.key,stage:'check'});
     const urls=resolveImages?await resolveImages([id],'thumbnail'):await resolveImageUrls(apiFetch,[id],'thumbnail');
     draft.thumbnail=await verifyPatternThumbnail(urls.get(id));
    }catch(cause){
     const detail=cause instanceof Error?cause.message:'请重试。';
     setImageErrors(current=>({...current,[draft.key]:draft.patternImageAssetId?'缩略图读取失败。可重试保存或更换图片。':'上传失败。'+detail}));
     dialog.current?.querySelector(`[data-colorway-error="${draft.key}"]`)?.scrollIntoView({block:'nearest'});
     return;
    }
   }
   setStep(null);
   const saved=await savePatternDraft(apiFetch,masterNo,drafts,progress.current,{topicTagIds:topicIds,...dimensions});
   onSaved(saved.masterNo);
  }catch(cause){
   setError((cause instanceof Error?cause.message:'新增失败。')+(progress.current.master?'。已保存花型 '+progress.current.master.masterNo+'，已完成 '+(progress.current.saved?.length??0)+' 个配色。':''));
  }finally{
   submitting.current=false;setStep(null);setBusy(false);
  }
 };

 const topicNames=topicIds.map(id=>topics.find(topic=>topic.id===id)?.name).filter(Boolean).join('、');
 const currentIndex=step?drafts.findIndex(draft=>draft.key===step.key)+1:0;
 const footerStatus=busy?(step?'配色 '+currentIndex+' / '+drafts.length+' · '+(step.stage==='upload'?'上传中':'核对缩略图中'):'正在保存花型…'):'';
 return <dialog ref={dialog} aria-label="新增花型" className="pattern-create-dialog" onCancel={event=>{
  if(event.target===event.currentTarget){event.preventDefault();void cancel();}
 }}>
  <form onSubmit={event=>void submit(event)}>
   <header className="pattern-create-header"><h2>新增花型</h2></header>
   <div className="pattern-create-body">
    <section aria-label="花型资料" className="pattern-create-base">
     <div className="pattern-create-fields">
      <label className="pattern-create-number">花型编号 <span aria-hidden="true">*</span>
       <input autoFocus required name="masterNo" maxLength={64} placeholder="例如 G0909"
        value={number} disabled={busy||!!progress.current.master} onChange={event=>setNumber(event.target.value)}/>
      </label>
      <PatternDimensionFields width={width} height={height} disabled={busy||!!progress.current.master}
       onChange={(w,h)=>{setWidth(w);setHeight(h);}}/>
     </div>
     <details className="pattern-create-topics">
      <summary><span>题材标签</span><span className="pattern-create-topic-selection">{topicNames||'选填'}</span></summary>
      <div className="pattern-create-topic-body">
       <TopicTagPicker apiFetch={apiFetch} ariaLabel="新增花型题材标签" options={topics} selected={topicIds} onChange={setTopicIds}
        onTagCreated={tag=>setTopics(items=>[...items.filter(item=>item.id!==tag.id),tag])}
        disabled={busy||tagsLoading||!!tagsError||!!progress.current.topicSaved}/>
      </div>
     </details>
     {tagsLoading&&<p role="status" className="pattern-create-note">正在读取题材标签…</p>}
     {tagsError&&<p role="alert" className="pattern-create-error">{tagsError} <button type="button" className="pattern-text-action"
      onClick={()=>setTagRevision(n=>n+1)}>重试</button></p>}
    </section>
    <section aria-labelledby="pattern-create-colorways-label" className="pattern-create-colors">
     <div className="pattern-create-section-head">
      <div><h3 id="pattern-create-colorways-label">配色与图片</h3><p className="pattern-create-note">JPG、PNG、WebP 或 GIF，每张不超过 20 MB</p></div>
      <button type="button" disabled={busy||!!progress.current.master} className="pattern-action pattern-action-secondary"
       onClick={()=>setDrafts(items=>[...items,{key:String(++sequence.current),remark:''}])}><Plus size={16} aria-hidden="true"/>添加配色</button>
     </div>
     <div className="pattern-create-drafts">
      {drafts.map((draft,index)=>{
       const applied=progress.current.saved?.includes(draft.key);
       const working=step?.key===draft.key;
       const state=working?(step.stage==='upload'?'正在上传…':'正在核对缩略图…'):applied?'已保存':draft.thumbnail?'图片已验证':draft.patternImageAssetId?'已上传，缩略图待核对':'已选图，保存时上传';
       return <fieldset key={draft.key} disabled={busy||applied} className="pattern-create-draft">
        <div className="pattern-create-draft-head">
         <strong>配色 {index+1}</strong>
         {!progress.current.master&&drafts.length>1&&<button type="button" className="pattern-text-action pattern-remove-draft"
          aria-label={'移除配色 '+(index+1)} onClick={()=>setDrafts(items=>items.filter(item=>item.key!==draft.key))}>
          <Trash2 size={15} aria-hidden="true"/>移除配色</button>}
        </div>
        <div className="pattern-create-draft-grid">
         <div className={'pattern-create-image '+(draft.file?'has-file':'')}>
          {draft.file?<DraftImage key={draft.key+':'+draft.file.name+':'+draft.file.lastModified} file={draft.file} thumbnail={draft.thumbnail}/>:
           <div className="pattern-create-preview" aria-hidden="true"><ImagePlus size={22}/></div>}
          <div className="pattern-create-image-details">
           {draft.file&&<><span className="pattern-create-filename" title={draft.file.name}>{draft.file.name}</span>
            <span className="pattern-create-note">{state}</span></>}
           <div className="pattern-create-image-actions">
            <label className="pattern-upload-select">
             <Upload size={15} aria-hidden="true"/>{draft.file?'更换图片':'选择花型图'}
             <input type="file" className="sr-only" aria-label={'配色 '+(index+1)+' 花型图'}
              accept="image/jpeg,image/png,image/webp,image/gif" onChange={event=>{
               const file=event.target.files?.[0];event.target.value='';if(file)selectImage(draft.key,file);
              }}/>
            </label>
            {draft.file&&<button type="button" className="pattern-text-action" onClick={()=>removeImage(draft.key)}>移除图片</button>}
           </div>
          </div>
         </div>
         <label className="pattern-create-remark">配色备注
          <input aria-label={'配色 '+(index+1)+' 备注'} maxLength={500} placeholder="选填" value={draft.remark}
           onChange={event=>setDrafts(items=>items.map(item=>item.key===draft.key?{...item,remark:event.target.value}:item))}/>
         </label>
        </div>
        <div data-colorway-error={draft.key}>{imageErrors[draft.key]&&<p role="alert" className="pattern-create-error">{imageErrors[draft.key]}</p>}</div>
       </fieldset>;
      })}
     </div>
    </section>
   </div>
   <footer className="pattern-create-footer">
    {error&&<p role="alert" className="pattern-create-error">{error}</p>}
    <div className="pattern-create-footer-line">
     <div role="status" className="pattern-create-note">{footerStatus}</div>
     <div className="pattern-create-footer-actions">
      <button type="button" disabled={busy} className="pattern-action pattern-action-secondary" onClick={()=>void cancel()}>取消</button>
      <button type="submit" disabled={busy||tagsLoading||!!tagsError||progress.current.uncertain} className="pattern-action pattern-action-primary">
       保存花型
      </button>
     </div>
    </div>
   </footer>
  </form>
 </dialog>;
}

export function PatternWorkspaceV2(props:Omit<PatternLibraryV2Props,'onCreateMaster'>){
 const [creating,setCreating]=useState(false),[revision,setRevision]=useState(0);
 const toast=useToast();
 return <>
  <PatternLibraryV2 {...props} catalogRevision={revision} onCreateMaster={props.canManage?()=>setCreating(true):undefined}/>
  {creating&&props.canManage&&<CreatePattern apiFetch={props.apiFetch} onUpload={props.onUploadPatternImage} resolveImages={props.resolvePatternImages}
   onCancel={refreshCatalog=>{setCreating(false);if(refreshCatalog)setRevision(n=>n+1);}}
   onSaved={no=>{setCreating(false);setRevision(n=>n+1);toast.success('花型 '+no+' 及配色已保存。');}}/>}
 </>;
}
