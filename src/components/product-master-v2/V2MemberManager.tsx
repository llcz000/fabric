import {ActionIcon} from './ActionIcon';
import React,{useEffect,useRef,useState} from 'react';
type Member={id:string;username:string;display_name:string;role:'admin'|'sales';is_active:number};
export default function V2MemberManager({apiFetch,onProfileChanged}:{apiFetch:typeof fetch;onProfileChanged?():Promise<void>}){
 const [members,setMembers]=useState<Member[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [username,setUsername]=useState(''),[displayName,setDisplayName]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState<'admin'|'sales'>('sales');
 const [editing,setEditing]=useState<Member|null>(null);const [resetId,setResetId]=useState('');const [notice,setNotice]=useState('');
 useEffect(()=>{const abort=new AbortController();setError('');
  apiFetch('/api/v2/access/members',{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error('成员列表读取失败');const value=await r.json();if(!Array.isArray(value.members))throw Error('成员资料无效');if(!abort.signal.aborted)setMembers(value.members.map((m:any)=>({...m,id:String(m.id),is_active:Number(m.is_active)})));}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();
 },[apiFetch,revision]);
 const save=async(url:string,method:string,body:unknown)=>{
  setBusy(true);setError('');try{const r=await apiFetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(r.status===409?'操作冲突：请保留至少一位有效管理员并检查登录名是否重复':'成员操作失败，请检查权限与资料');setRevision(n=>n+1);return true;}catch(e){setError(e instanceof Error?e.message:'成员操作失败');return false;}finally{setBusy(false);}
 };
 return <section className="v2-catalog v2-member-manager space-y-4" aria-label="成员管理">
  <div className="v2-catalog-toolbar">
   <div><h1 className="text-xl font-semibold">成员管理</h1><p className="mt-1 text-xs text-slate-500">维护业务员与管理员账号</p></div>
  </div>
  {notice&&<p role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">{notice}</p>}
  {error&&<p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
  <form className="v2-catalog-filters v2-library-filters flex flex-wrap items-center gap-3 rounded-lg border bg-white" onSubmit={async e=>{e.preventDefault();if(await save('/api/v2/access/members','POST',{username,displayName,password,role})){setUsername('');setDisplayName('');setPassword('');}}}>
   <label className="flex items-center gap-2 text-sm text-slate-600">登录名<input required name="username" minLength={3} maxLength={64} className="rounded border px-2 py-1.5" value={username} onChange={e=>setUsername(e.target.value)}/></label>
   <label className="flex items-center gap-2 text-sm text-slate-600">姓名<input required name="displayName" maxLength={100} className="rounded border px-2 py-1.5" value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>
   <label className="flex items-center gap-2 text-sm text-slate-600">密码<input required type="password" name="password" autoComplete="new-password" minLength={8} className="rounded border px-2 py-1.5" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <label className="flex items-center gap-2 text-sm text-slate-600">角色<select className="rounded border px-2 py-1.5" value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="sales">业务员</option><option value="admin">管理员</option></select></label>
   <button disabled={busy} className="rounded-lg bg-[#346ef6] px-4 py-2 text-sm text-white disabled:opacity-40"><ActionIcon name="member"/>新增账号</button>
  </form>
  <div className="overflow-x-auto rounded-lg border border-[#c3c6d7] bg-white">
   <table className="v2-library-table w-full min-w-[720px] border-collapse text-left text-xs text-[#191b24]">
    <colgroup><col style={{width:'180px'}}/><col style={{width:'160px'}}/><col style={{width:'140px'}}/><col style={{width:'100px'}}/><col style={{width:'220px'}}/></colgroup>
    <thead><tr className="border-b border-[#c3c6d7] bg-[#f3f4fa] text-[#434655]">
     {['登录名','姓名','角色','状态','操作'].map(t=><th key={t} scope="col" className="px-3 py-3 font-medium">{t}</th>)}
    </tr></thead>
    <tbody>{members.map(m=><tr key={m.id} className="v2-library-row border-b border-[#ededf9] hover:bg-[#f8f9ff]">
   <td className="px-3 py-2 font-semibold text-[#003ea7]">{m.username}</td><td className="px-3 py-2">{m.display_name}</td>
   <td className="px-3 py-2"><select aria-label={m.username+'角色'} disabled={busy} value={m.role} onChange={e=>void save('/api/v2/access/members/'+m.id,'PATCH',{role:e.target.value})}><option value="sales">业务员</option><option value="admin">管理员</option></select></td>
   <td className="px-3 py-2"><span className={'rounded-full px-2 py-0.5 text-[11px] '+(m.is_active?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600')}>{m.is_active?'已启用':'已停用'}</span></td>
   <td className="px-3 py-2"><div className="v2-row-actions">
    <button className="v2-icon-button" aria-label="编辑资料" title="编辑成员资料" disabled={busy} onClick={()=>{setEditing(m);setError('');setNotice('');}}><ActionIcon name="edit"/></button>
    <button className="v2-row-action" disabled={busy} onClick={()=>void save('/api/v2/access/members/'+m.id,'PATCH',{isActive:!m.is_active})}><ActionIcon name="power"/><span>{m.is_active?'停用':'启用'}</span></button>
    <button className="v2-icon-button" aria-label="重设密码" title="重设密码" disabled={busy} onClick={()=>{setResetId(m.id);}}><ActionIcon name="password"/></button>
   </div></td>
  </tr>)}</tbody></table>
   {!members.length?<p className="py-12 text-center text-sm text-slate-500">还没有成员账号，请在上方新增。</p>:null}
  </div>
  {editing&&<EditMemberProfile member={editing} busy={busy} error={error} onClose={()=>{if(!busy){setEditing(null);setError('');}}} onSave={async value=>{
   const ok=await save('/api/v2/access/members/'+editing.id,'PATCH',value);if(ok){setEditing(null);setNotice('成员资料已更新，下次登录使用新的登录名。');try{await onProfileChanged?.();}catch{setError('资料已保存，当前账号显示未刷新，请刷新页面核对');}}return ok;
  }}/>}
  {resetId&&members.find(m=>m.id===resetId)&&<ResetMemberPassword member={members.find(m=>m.id===resetId)!} busy={busy} error={error} onClose={()=>{if(!busy){setResetId('');setError('');}}} onSave={async value=>{const ok=await save('/api/v2/access/members/'+resetId+'/reset-password','POST',{password:value});if(ok){setResetId('');setNotice('密码已重设，该成员须使用新密码重新登录。');}return ok;}}/>}
 </section>;
}

export function ResetMemberPassword({member,busy,error,onClose,onSave}:{member:Member;busy:boolean;error:string;onClose():void;onSave(password:string):Promise<boolean>}){
 const ref=useRef<HTMLDialogElement>(null),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[failure,setFailure]=useState('');
 useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
 return <dialog ref={ref} aria-label={'重设密码 '+member.username} className="m-auto w-[min(92vw,440px)] rounded-xl border p-6 shadow-xl backdrop:bg-black/30" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <form className="space-y-4" onSubmit={async event=>{event.preventDefault();if(busy)return;if(password!==confirmation){setFailure('两次输入的密码不一致');return;}setFailure('');await onSave(password);}}>
   <h2 className="font-semibold">重设密码 · {member.display_name}（{member.username}）</h2>
   <label className="block text-sm">新密码<input autoFocus disabled={busy} required minLength={8} maxLength={128} type="password" autoComplete="new-password" className="mt-1 w-full rounded border p-2" value={password} onChange={event=>setPassword(event.target.value)}/></label>
   <label className="block text-sm">确认新密码<input disabled={busy} required minLength={8} maxLength={128} type="password" autoComplete="new-password" className="mt-1 w-full rounded border p-2" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>
   <p className="text-xs text-slate-500">至少8位；保存后该成员须使用新密码重新登录。</p>{(failure||error)&&<p role="alert" className="text-sm text-rose-700">{failure||error}</p>}
   <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose}><ActionIcon name="close"/>取消</button><button disabled={busy} className="rounded bg-blue-700 px-3 py-2 text-sm text-white"><ActionIcon name="save"/>{busy?'正在保存…':'保存密码'}</button></div>
  </form>
 </dialog>;
}

export function EditMemberProfile({member,busy,error,onClose,onSave}:{member:Member;busy:boolean;error:string;onClose():void;onSave(value:{username:string;displayName:string}):Promise<boolean>}){
 const dialog=useRef<HTMLDialogElement>(null),[username,setUsername]=useState(member.username),[name,setName]=useState(member.display_name);
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 return <dialog ref={dialog} aria-label={'编辑成员 '+member.username} className="m-auto w-[min(92vw,440px)] rounded-xl border p-6 shadow-xl backdrop:bg-black/30" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <form className="space-y-4" onSubmit={async event=>{event.preventDefault();if(!busy)await onSave({username,displayName:name});}}><h2 className="font-semibold">编辑成员资料</h2>
   <label className="block text-sm">登录名<input autoFocus required minLength={3} maxLength={64} pattern="[A-Za-z0-9._]{3,64}" disabled={busy} className="mt-1 w-full rounded border p-2" value={username} onChange={event=>setUsername(event.target.value)}/></label>
   <label className="block text-sm">姓名<input required maxLength={100} disabled={busy} className="mt-1 w-full rounded border p-2" value={name} onChange={event=>setName(event.target.value)}/></label>
   <p className="text-xs text-slate-500">登录名为3–64位字母、数字、点或下划线。修改后下次登录使用新名称；原单据及选样归属保留。</p>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
   <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose}><ActionIcon name="close"/>取消</button><button disabled={busy} className="rounded bg-blue-700 px-3 py-2 text-sm text-white"><ActionIcon name="save"/>{busy?'正在保存…':'保存资料'}</button></div>
  </form>
 </dialog>;
}
