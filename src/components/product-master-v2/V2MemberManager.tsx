import React,{useEffect,useState} from 'react';
type Member={id:string;username:string;display_name:string;role:'admin'|'sales';is_active:number};
export default function V2MemberManager({apiFetch}:{apiFetch:typeof fetch}){
 const [members,setMembers]=useState<Member[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [username,setUsername]=useState(''),[displayName,setDisplayName]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState<'admin'|'sales'>('sales');
 const [resetId,setResetId]=useState(''),[resetPassword,setResetPassword]=useState('');
 useEffect(()=>{const abort=new AbortController();setError('');
  apiFetch('/api/v2/access/members',{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error('成员列表读取失败');const value=await r.json();if(!Array.isArray(value.members))throw Error('成员资料无效');if(!abort.signal.aborted)setMembers(value.members.map((m:any)=>({...m,id:String(m.id),is_active:Number(m.is_active)})));}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();
 },[apiFetch,revision]);
 const save=async(url:string,method:string,body:unknown)=>{
  setBusy(true);setError('');try{const r=await apiFetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(r.status===409?'操作冲突：请保留至少一位有效管理员并检查登录名是否重复':'成员操作失败，请检查权限与资料');setRevision(n=>n+1);return true;}catch(e){setError(e instanceof Error?e.message:'成员操作失败');return false;}finally{setBusy(false);}
 };
 return <section className="space-y-4 p-4" aria-label="成员管理"><h2 className="text-xl font-semibold">成员管理</h2>
  {error&&<p role="alert" className="text-rose-700">{error}</p>}
  <form className="flex flex-wrap gap-3 rounded border bg-white p-4" onSubmit={async e=>{e.preventDefault();if(await save('/api/v2/access/members','POST',{username,displayName,password,role})){setUsername('');setDisplayName('');setPassword('');}}}>
   <label>登录名<input required name="username" minLength={3} maxLength={64} className="ml-2 rounded border p-2" value={username} onChange={e=>setUsername(e.target.value)}/></label>
   <label>姓名<input required name="displayName" maxLength={100} className="ml-2 rounded border p-2" value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>
   <label>密码<input required type="password" name="password" autoComplete="new-password" minLength={8} className="ml-2 rounded border p-2" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <label>角色<select className="ml-2 rounded border p-2" value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="sales">业务员</option><option value="admin">管理员</option></select></label>
   <button disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white">新增账号</button>
  </form>
  <div className="overflow-x-auto"><table className="w-full border-collapse bg-white text-sm"><thead><tr>{['登录名','姓名','角色','状态','操作'].map(t=><th key={t} className="border p-3 text-left">{t}</th>)}</tr></thead><tbody>{members.map(m=><tr key={m.id}>
   <td className="border p-3">{m.username}</td><td className="border p-3">{m.display_name}</td>
   <td className="border p-3"><select aria-label={m.username+'角色'} disabled={busy} value={m.role} onChange={e=>void save('/api/v2/access/members/'+m.id,'PATCH',{role:e.target.value})}><option value="sales">业务员</option><option value="admin">管理员</option></select></td>
   <td className="border p-3">{m.is_active?'启用':'停用'}</td><td className="space-x-3 border p-3"><button disabled={busy} onClick={()=>void save('/api/v2/access/members/'+m.id,'PATCH',{isActive:!m.is_active})}>{m.is_active?'停用':'启用'}</button><button disabled={busy} onClick={()=>{setResetId(m.id);setResetPassword('');}}>重设密码</button></td>
  </tr>)}</tbody></table></div>
  {resetId&&<form className="flex flex-wrap gap-3 rounded border bg-white p-4" onSubmit={async e=>{e.preventDefault();if(await save('/api/v2/access/members/'+resetId+'/reset-password','POST',{password:resetPassword})){setResetId('');setResetPassword('');}}}>
   <label>新密码<input type="password" autoComplete="new-password" required minLength={8} className="ml-2 rounded border p-2" value={resetPassword} onChange={e=>setResetPassword(e.target.value)}/></label><button disabled={busy}>保存密码</button><button type="button" onClick={()=>setResetId('')}>取消</button>
  </form>}
 </section>;
}
