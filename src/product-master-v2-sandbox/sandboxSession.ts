/** Isolated P4 / P7 sandbox V2 HTTP client.
 * NEVER accepts legacy /api tokens or browser storage; never runs in App.tsx.
 * Only the independent 127.0.0.1 sandbox preview backend may be addressed.
 * This is a client-side safety boundary, NOT authorization or production proof.
 */
export interface SandboxPrincipal{
 readonly id:string;readonly username:string;readonly displayName:string;readonly role:'admin'|'sales';
}
const TOKEN=/^[a-f0-9]{64}$/;
const USER=/^[A-Za-z0-9._]{3,64}$/;
const denied=()=>new Error('Unauthorized: V2 sandbox session required');
const invalid=()=>new Error('Invalid V2 sandbox origin or request');
function trustedOrigin(input:string):string{
 try{
  if(typeof input!=='string')throw invalid();
  const url=new URL(input);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||
   url.username||url.password||url.pathname!=='/'||url.search||url.hash||
   url.origin!==input)throw invalid();
  return url.origin;
 }catch{throw invalid();}
}
function apiUrl(origin:string,path:unknown,login=false):string{
 if(typeof path!=='string'||!/^\/api\/v2\/[a-zA-Z0-9/_?&=%,.\-]*$/.test(path)||
  path.startsWith('//')||path.includes('..'))throw invalid();
 const url=new URL(path,origin);
 if(url.origin!==origin||!url.pathname.startsWith('/api/v2/')||
  (!login&&url.pathname==='/api/v2/access/login')||url.hash)throw invalid();
 return url.href;
}
function principal(v:unknown):SandboxPrincipal{
 if(!v||typeof v!=='object'||Array.isArray(v))throw invalid();
 const x=v as Record<string,unknown>;
 if(typeof x.id!=='string'||!/^\d{1,19}$/.test(x.id)||x.id==='0'||
  typeof x.username!=='string'||!USER.test(x.username)||
  typeof x.displayName!=='string'||!x.displayName.trim()||x.displayName.length>120||
  (x.role!=='admin'&&x.role!=='sales'))throw invalid();
 return Object.freeze({id:x.id,username:x.username,displayName:x.displayName,role:x.role});
}
function tokenReply(v:unknown):{token:string;expiresIn:number}{
 if(!v||typeof v!=='object'||Array.isArray(v))throw invalid();
 const x=v as Record<string,unknown>;
 if(Object.keys(x).sort().join(',')!=='expiresIn,token'||
  !TOKEN.test(String(x.token))||
  !Number.isSafeInteger(x.expiresIn)||Number(x.expiresIn)<60||Number(x.expiresIn)>43200)throw invalid();
 return {token:String(x.token),expiresIn:Number(x.expiresIn)};
}

export function createSandboxSession(origin:string,transport:typeof fetch){
 const host=trustedOrigin(origin);
 if(typeof transport!=='function')throw invalid();
 let bearer:string|null=null;
 let actor:SandboxPrincipal|null=null;
 let generation=0;
 const listeners=new Set<()=>void>();
 function clear(notify=false){
  generation++;bearer=null;actor=null;
  if(notify)for(const callback of [...listeners])callback();
 }
 function requestOptions(init:RequestInit={}):RequestInit{
  if(!init||typeof init!=='object')throw invalid();
  if(init.credentials&&init.credentials!=='omit'||
     init.redirect&&init.redirect!=='error'||
     (init.method&&init.method.toUpperCase()!=='GET')||init.body!==undefined)throw invalid();
  const headers=new Headers(init.headers);
  for(const name of ['authorization','cookie','proxy-authorization','x-forwarded-for','x-forwarded-host']){
   if(headers.has(name))throw invalid();
  }
  // Never forward cross-origin cookies, legacy tokens, browser caches or redirects.
  return {...init,headers,credentials:'omit',redirect:'error',cache:'no-store',mode:'same-origin'};
 }
 return Object.freeze({
  currentPrincipal:()=>actor,
  canManageCatalog:()=>actor!==null&&(actor.role==='admin'||actor.role==='sales'),
  onUnauthenticated:(callback:()=>void)=>{
   if(typeof callback!=='function')throw invalid();
   listeners.add(callback);return ()=>{listeners.delete(callback)};
  },
  async login(username:string,password:string):Promise<SandboxPrincipal>{
   clear();
   const started=generation;
   if(!USER.test(username)||typeof password!=='string'||password.length<8||
    new TextEncoder().encode(password).length>1024)throw invalid();
   try{
    const response=await transport(apiUrl(host,'/api/v2/access/login',true),{
     method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
     body:JSON.stringify({username,password}),credentials:'omit',
     redirect:'error',cache:'no-store',mode:'same-origin'
    });
    if(!response.ok)throw denied();
    const issued=tokenReply(await response.json());
    if(started!==generation)throw denied();
    const me=await transport(apiUrl(host,'/api/v2/access/me'),{
     headers:{'Authorization':'Bearer '+issued.token,'Accept':'application/json'},
     credentials:'omit',redirect:'error',cache:'no-store',mode:'same-origin'
    });
    if(!me.ok)throw denied();
    const person=principal(await me.json());
    if(started!==generation)throw denied();
    bearer=issued.token;actor=person;
    return person;
   }catch{
    if(started===generation)clear();
    throw denied();
   }
  },
  async request(path:string,init:RequestInit={}):Promise<Response>{
   const url=apiUrl(host,path);
   if(!bearer||!actor)throw denied();
   const current=bearer;
   const options=requestOptions(init);
   (options.headers as Headers).set('Authorization','Bearer '+current);
   const response=await transport(url,options);
   if(response.status===401&&bearer===current)clear(true);
   return response;
  },
  /** Separate explicitly opt-in V2 workbench may write; readonly sandbox's
   * request() remains GET-only. Restrict methods/paths and caller headers. */
  async requestWrite(path:string,init:RequestInit={}):Promise<Response>{
   const url=apiUrl(host,path),target=new URL(url);
   if(!bearer||!actor)throw denied();
   if(!(/^\/api\/v2\/(pattern-|fabric|fabrics|products|v2-products|shared-|tags|image-assets|document|company-print-settings|company|media-capabilities)/.test(target.pathname)))
    throw invalid();
   const method=String(init.method??'GET').toUpperCase();
   if(!['GET','POST','PATCH','PUT','DELETE'].includes(method)||!init||typeof init!=='object'||
      init.credentials&&init.credentials!=='omit'||init.redirect&&init.redirect!=='error')
    throw invalid();
   const headers=new Headers(init.headers);
   for(const name of ['authorization','cookie','proxy-authorization','x-forwarded-for','x-forwarded-host'])
    if(headers.has(name))throw invalid();
   if(method==='GET'&&init.body!==undefined)throw invalid();
   if(method!=='GET'&&!target.pathname.startsWith('/api/v2/image-assets')&&
     init.body!==undefined&&!(typeof init.body==='string'&&
     (headers.get('content-type')??'').toLowerCase().includes('application/json')))
     throw invalid();
   const current=bearer;
   headers.set('Authorization','Bearer '+current);
   const reply=await transport(url,{...init,method,headers,credentials:'omit',redirect:'error',
    cache:'no-store',mode:'same-origin'});
   if(reply.status===401&&current===bearer)clear(true);
   return reply;
  },
  async logout():Promise<void>{
   const current=bearer;
   clear();
   if(!current)return;
   try{
    await transport(apiUrl(host,'/api/v2/access/logout'),{
     method:'POST',headers:{'Authorization':'Bearer '+current},
     credentials:'omit',redirect:'error',cache:'no-store',mode:'same-origin'
    });
   }catch{/* Local auth is already cleared. Network failure never restores it. */}
  }
 });
}
