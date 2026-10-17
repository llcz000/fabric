import express from 'express';
import http from 'node:http';
/** An emergency rollback must not re-enable legacy PUT or erase V2 owner/product identity. */
export function recoveryRequestAllowed(method:string,url:string):boolean{
 const path=url.split('?')[0];
 if(path.includes('%')||path.includes('\\')||path.includes('//')||path.split('/').some(p=>p==='.'||p==='..'))return false;
 if(method==='POST')return ['/api/v2/access/login','/api/v2/access/logout','/api/image-assets/access-urls'].includes(path);
 if(!['GET','HEAD'].includes(method))return false;
 return ['/', '/index.html','/api/health','/api/runtime','/api/company'].includes(path)||
  /^\/api\/v2(?:\/[A-Za-z0-9_.-]+)*\/?$/.test(path)||/^\/api\/(?:company\/images|image-assets|inventory)(?:\/[A-Za-z0-9_.-]+)*$/.test(path)||
  /^\/assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)$/.test(path);
}
export async function createV2RecoveryProxy(upstream:string){
 const target=new URL(upstream);
 if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password||target.pathname!=='/'||target.search||target.hash||Number(target.port)<1024||Number(target.port)>65535)throw Error('Recovery upstream must be explicit loopback');
 const [mode,health]=await Promise.all(['/api/runtime','/api/health'].map(async path=>{
  const response=await fetch(new URL(path,target),{signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw Error('Recovery upstream unavailable');return response.json();
 }));
 if(mode.mode!=='v2'||health.mode!=='v2'||health.storage!=='mysql')throw Error('Recovery upstream must remain authenticated V2 MySQL');
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{res.set('X-Fabric-Recovery','read-only');res.set('Cache-Control','no-store');
  if(!recoveryRequestAllowed(req.method,req.originalUrl)){res.status(503).json({error:'系统处于只读恢复模式，暂时无法保存或删除资料'});return;}next();
 });
 app.get('/api/runtime',(_req,res)=>res.json({mode:'v2',readOnly:true}));
 app.use((req,res)=>{
  const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['accept-encoding'];
  const forwarded=http.request(new URL(req.originalUrl,target),{method:req.method,headers},response=>{
   const html=(req.path==='/'||req.path==='/index.html')&&String(response.headers['content-type']??'').includes('text/html');
   res.status(response.statusCode??503);
   for(const [name,value] of Object.entries(response.headers))if(value!==undefined&&!['connection','transfer-encoding','cache-control',...(html?['content-length']:[])].includes(name))res.setHeader(name,value);
   if(!html){response.pipe(res);return;}
   const chunks:Buffer[]=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){response.destroy();res.destroy();}else chunks.push(Buffer.from(chunk));});
   response.once('end',()=>res.send(Buffer.concat(chunks).toString('utf8').replace(/<body[^>]*>/i,'$&<div role="alert" style="position:sticky;top:0;z-index:9999;background:#fff3cd;padding:12px;text-align:center">系统处于只读恢复模式：可查询资料，暂时无法保存或删除。</div>')));
  });
  forwarded.once('error',()=>{if(!res.headersSent)res.status(503).json({error:'Recovery service unavailable'});else res.destroy();});
  res.once('close',()=>forwarded.destroy());req.pipe(forwarded);
 });
 return app;
}
