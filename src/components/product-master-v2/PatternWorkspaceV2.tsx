import React,{useEffect,useRef,useState} from 'react';
import {PatternLibraryV2,type PatternLibraryV2Props} from './PatternLibraryV2';
import {createLibraryPattern} from './patternCreateModel';
function CreatePattern({apiFetch,onCancel,onSaved}:{apiFetch:typeof fetch;onCancel():void;onSaved(no:string):void}){
 const dialog=useRef<HTMLDialogElement>(null),[number,setNumber]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 return <dialog ref={dialog} aria-label="新增花型" className="w-[min(92vw,440px)] rounded-xl border p-6 shadow-xl backdrop:bg-black/30" onCancel={e=>{e.preventDefault();if(!busy)onCancel();}}>
  <form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const value=await createLibraryPattern(apiFetch,number);onSaved(value.masterNo);}catch(cause){setError(cause instanceof Error?cause.message:'新增失败');}finally{setBusy(false);}}}>
   <h2 className="text-lg font-semibold">新增花型</h2><label className="block text-sm">花型编号<input autoFocus required name="masterNo" maxLength={64} className="mt-2 w-full rounded border p-2" value={number} disabled={busy} onChange={e=>setNumber(e.target.value)}/></label>
   <p className="text-xs text-slate-500">新增后可编辑配色、上传花型图及设置标签。</p>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
   <div className="flex justify-end gap-3"><button type="button" disabled={busy} className="rounded border px-4 py-2 text-sm" onClick={onCancel}>取消</button><button disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-sm text-white">{busy?'正在保存…':'保存花型'}</button></div>
  </form>
 </dialog>;
}
export function PatternWorkspaceV2(props:Omit<PatternLibraryV2Props,'onCreateMaster'>){
 const [creating,setCreating]=useState(false),[revision,setRevision]=useState(0),[notice,setNotice]=useState('');
 return <>{notice&&<p role="status" className="p-3 text-sm text-emerald-800">{notice}</p>}
  <PatternLibraryV2 key={revision} {...props} onCreateMaster={props.canManage?()=>{setNotice('');setCreating(true);}:undefined}/>
  {creating&&props.canManage&&<CreatePattern apiFetch={props.apiFetch} onCancel={()=>setCreating(false)} onSaved={no=>{setCreating(false);setRevision(n=>n+1);setNotice('花型 '+no+' 已新增，可编辑添加配色。');}}/>}
 </>;
}
