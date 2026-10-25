/** Review-only prebuilt UI server. Never starts server.ts or connects to real APIs. */
import {build} from 'vite';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd();
const isTest=process.env.FABRIC_UI_UX_MODE==='test';
const port=isTest?52992:52991;
const site=path.join(root,'artifacts','ui-ux-pilot',isTest?'site-test':'site');
const origin='http://127.0.0.1:'+port;
await build({configFile:path.join(root,'vite.config.ts'),base:'/',
 build:{outDir:site,emptyOutDir:true,copyPublicDir:false,
 rollupOptions:{input:{internal:path.join(root,'tools/ui-preview/entries/ui-ux-pilot.html'),customer:path.join(root,'tools/ui-preview/entries/ui-ux-share-demo.html'),wechat:path.join(root,'tools/ui-preview/entries/ui-ux-wechat-review.html'),route:path.join(root,'tools/ui-preview/entries/ui-ux-wechat-route.html'),internalChrome:path.join(root,'tools/ui-preview/entries/ui-ux-internal-chrome.html'),internalCards:path.join(root,'tools/ui-preview/entries/ui-ux-internal-cards.html'),internalFabrics:path.join(root,'tools/ui-preview/entries/ui-ux-internal-fabrics.html'),internalPatterns:path.join(root,'tools/ui-preview/entries/ui-ux-internal-patterns.html')}}}});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try {
  const pathname=decodeURIComponent(new URL(req.url??'/',origin).pathname).replace(/^\/+/, '');
  const file=path.resolve(site,pathname||'tools/ui-preview/entries/ui-ux-pilot.html');
  if(file!==site&&!file.startsWith(site+path.sep)){res.writeHead(403);res.end();return;}
  const bytes=await readFile(file);
  res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream','cache-control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log('Fabric review-only UX pilot: '+origin+'/tools/ui-preview/entries/ui-ux-pilot.html'));
process.on('SIGTERM',()=>server.close());
