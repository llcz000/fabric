import express from 'express';
/** dist also contains the backend bundle; expose only intentional browser entrypoints and assets. */
export function createFrontendStaticRouter(root:string,options:{allowPatternShare?:boolean;allowProductShare?:boolean;allowCardShare?:boolean}={}){
 const router=express.Router();
 if(options.allowCardShare)router.get('/c/:token',(req,res,next)=>{if(!/^[A-Za-z0-9_-]{43}$/.test(String(req.params.token))){res.status(404).end();return;}res.set({'Cache-Control':'no-cache, no-store, must-revalidate','Referrer-Policy':'no-referrer'});res.sendFile('index.html',{root},error=>{if(error)next(error);});});
 if(options.allowPatternShare)router.get('/p/:token',(req,res,next)=>{if(!/^[A-Za-z0-9_-]{43}$/.test(String(req.params.token))){res.status(404).end();return;}res.set({'Cache-Control':'no-cache, no-store, must-revalidate','Referrer-Policy':'no-referrer'});res.sendFile('index.html',{root},error=>{if(error)next(error);});});
 if(options.allowProductShare)router.get('/s/:token',(req,res,next)=>{if(!/^[A-Za-z0-9_-]{43}$/.test(String(req.params.token))){res.status(404).end();return;}res.set({'Cache-Control':'no-cache, no-store, must-revalidate','Referrer-Policy':'no-referrer'});res.sendFile('index.html',{root},error=>{if(error)next(error);});});
 router.use((req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method)||!(/^\/(?:index\.html|favicon\.(?:ico|svg)|favicon-[a-f0-9]{8}\.svg)?$/.test(req.path)||/^\/assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)$/.test(req.path))){res.status(404).end();return;}
  next();
 });
 router.use(express.static(root,{setHeaders(res,file){if(file.endsWith('.html'))res.set('Cache-Control','no-cache, no-store, must-revalidate');}}));
 return router;
}
