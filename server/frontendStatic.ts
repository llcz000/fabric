import express from 'express';
/** dist also contains the backend bundle; expose only intentional browser entrypoints and assets. */
export function createFrontendStaticRouter(root:string){
 const router=express.Router();
 router.use((req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method)||!(/^\/(?:index\.html|favicon\.ico)?$/.test(req.path)||/^\/assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)$/.test(req.path))){res.status(404).end();return;}
  next();
 });
 router.use(express.static(root,{setHeaders(res,file){if(file.endsWith('.html'))res.set('Cache-Control','no-cache, no-store, must-revalidate');}}));
 return router;
}
