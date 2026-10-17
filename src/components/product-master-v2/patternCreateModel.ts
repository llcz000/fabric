export async function createLibraryPattern(apiFetch:typeof fetch,raw:string):Promise<{id:string;masterNo:string}>{
 const masterNo=raw.trim().toUpperCase();if(!/^[A-Z0-9]{1,64}$/.test(masterNo))throw Error('花型编号须为1至64位字母或数字');
 const response=await apiFetch('/api/v2/pattern-masters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({masterNo})});
 if(!response.ok)throw Error(response.status===409?'花型编号已存在':'花型新增失败，请检查权限并重试');
 const value=await response.json();if(typeof value.id!=='string'||!/^[1-9]\d*$/.test(value.id)||value.masterNo!==masterNo)throw Error('花型保存响应无效');return value;
}
