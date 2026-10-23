/** Isolated static React review with memory-only data; never starts server.ts. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'vite';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),port=52985,debug=52986,base='http://127.0.0.1:'+port;
const dir=path.join(root,'artifacts/product-master-ui/qa/query-v2'),site=path.join(dir,'site');
await mkdir(dir,{recursive:true});
const checks=[],screens=[];let ws,edge,serial=0;const pending=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const start=Date.now();while(Date.now()-start<15000){if(await fn())return;await sleep(100);}throw Error('Timeout: '+label);}
function send(method,params={}){return new Promise((resolve,reject)=>{
 const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);
 pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});ws.send(JSON.stringify({id,method,params}));
});}
async function js(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result?.value;}
async function click(text){await js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing');b.click();})()`);}
async function fill(name,value,select=false){await js(`(()=>{const e=document.querySelector(${JSON.stringify(select?'select[name="'+name+'"]':'input[name="'+name+'"]')});if(!e)throw Error('Field missing');Object.getOwnPropertyDescriptor(${select?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${select?"'change'":"'input'"},{bubbles:true}));})()`);}
async function check(expression,name){if(!await js(expression))throw Error('Check failed: '+name);checks.push(name);}
async function ready(){await until(()=>js(`Boolean(document.querySelector('section[aria-label="V2单据查询工作区"] footer'))`),'query ready');}
async function snap(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(dir,name+'.png'),Buffer.from(r.data,'base64'));screens.push(name+'.png');}
if(!process.argv.includes('--serve-built'))await build({configFile:path.join(root,'vite.config.ts'),base:'./',build:{outDir:site,emptyOutDir:true,copyPublicDir:false,
 rollupOptions:{input:path.join(root,'product-master-v2-review.html')}}});
const server=createServer(async(req,res)=>{
 try{const pathname=decodeURIComponent(new URL(req.url??'/',base).pathname).replace(/^\/+/,''),file=path.resolve(site,pathname||'product-master-v2-review.html');
  if(!file.startsWith(site+path.sep)){res.writeHead(403);res.end();return;}
  const bytes=await readFile(file);res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8','cache-control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
if(process.argv.includes('--serve-only')||process.argv.includes('--serve-built')){
 console.log('Isolated preview: '+base+'/product-master-v2-review.html?view=documents');
}else try{
 const profile=await mkdtemp(path.join(root,'tmp/query-ui-edge-'));
 edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
  '--headless=new','--disable-gpu','--disable-background-networking','--disable-sync','--disable-extensions','--no-first-run',
  '--no-default-browser-check','--remote-debugging-port='+debug,'--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'
 ],{cwd:root,windowsHide:true,stdio:'ignore'});
 let target;await until(async()=>{try{target=(await (await fetch('http://127.0.0.1:'+debug+'/json/list')).json()).find(x=>x.type==='page');return Boolean(target);}catch{return false;}},'headless Edge');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const handler=pending.get(message.id);pending.delete(message.id);message.error?handler.reject(Error(message.error.message)):handler.resolve(message.result);}});
 await send('Page.enable');await send('Runtime.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__reviewErrors=[];window.addEventListener('error',e=>window.__reviewErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__reviewErrors.push(String(e.reason)));`});
 await send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/product-master-v2-review.html?view=documents'});await ready();
 await check(`document.querySelector('section[aria-label="V2单据查询工作区"] footer').textContent.includes('共 28 张')`,'sales sees own 28 documents');
 await click('下一页');await ready();await check(`document.querySelector('section[aria-label="V2单据查询工作区"] footer').textContent.includes('第 2 / 2 页')`,'server next page');
 await fill('productNo','P001');await fill('colorNo','2');await click('查询');await ready();
 await check(`document.body.textContent.includes('没有符合条件的单据')`,'criteria must match the same line; split-line false match excluded');
 await fill('colorNo','1');await click('查询');await ready();
 await check(`document.querySelector('section[aria-label="V2单据查询工作区"] footer').textContent.includes('第 1 / 2 页')`,'new search resets page');
 await click('展开命中明细');await until(()=>js(`Boolean(document.querySelector('section[aria-label="命中明细"] table'))`),'matching detail');
 await check(`document.querySelector('section[aria-label="命中明细"]').textContent.includes('P001')&&!document.querySelector('section[aria-label="命中明细"]').textContent.includes('P002')`,'expanded rows show matching lines only');
 await snap('desktop-matching');
 await js('window.scrollTo(0,450)');await snap('desktop-details');await js('window.scrollTo(0,0)');
 await click('预览 / Excel');await until(()=>js(`Boolean(document.querySelector('[data-v2-print-sheet]'))&&!document.body.textContent.includes('正在读取打印资料')`),'saved preview');
 await check(`document.body.textContent.includes('Fabric 演示公司')&&document.body.textContent.includes('P002')`,'saved preview uses corrected V2 route and whole saved document');
 await click('返回查询');await click('编辑单据');
 await until(()=>js(`Boolean(document.querySelector('section[aria-label="V2单据编辑工作区"]'))&&!document.body.textContent.includes('正在读取V2单据')`),'saved edit');
 await check(`document.querySelector('section[aria-label="V2单据编辑工作区"]').textContent.includes('P001')`,'editor loads the same document via actual V2 resource URL');
 await click('取消并返回');await click('下一次查询失败');await click('查询');
 await until(()=>js(`Boolean(document.querySelector('section[aria-label="V2单据查询工作区"] [role="alert"]'))`),'query failure');
 await check(`!document.querySelector('section[aria-label="V2单据查询工作区"] tbody')`,'failed paired request clears old private rows');
 await click('重试查询');await ready();
 await fill('type','deposit',true);await check(`document.querySelector('select[name="settled"]').disabled`,'deposit disables settlement filter');
 await click('查询');await ready();await check(`!document.querySelector('tbody').textContent.includes('已结清')`,'deposit has no settlement mark');
 await js(`(()=>{const e=document.querySelector('select[aria-label="每页单据数"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'50');e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await ready();
 await js(`(()=>{const e=document.querySelector('select[aria-label="查询演示角色"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'admin');e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await ready();
 await check(`document.querySelector('section[aria-label="V2单据查询工作区"] footer').textContent.includes('共 29 张')`,'admin scope includes other owner');
 await check(`document.querySelector('select[aria-label="每页单据数"]').value==='20'&&![...document.querySelectorAll('button')].find(b=>b.textContent==='下一页').disabled`,'retained component resets page size and preserves access to rows 21-29 on role/API change');
 await fill('customer','演示客户乙');await click('查询');await ready();await check(`document.querySelector('section[aria-label="V2单据查询工作区"] footer').textContent.includes('共 1 张')`,'admin can query another owner customer');
 await js(`(()=>{const e=document.querySelector('select[aria-label="查询演示角色"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'sales');e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await ready();
 await check(`!document.querySelector('section[aria-label="V2单据查询工作区"]').textContent.includes('演示客户乙')`,'role switch clears prior scope');
 await fill('productNo','P001');await click('查询');await ready();
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 await check(`document.documentElement.scrollWidth<=390`,'390px page has no outer horizontal overflow');await snap('mobile-query');
 await js('window.scrollTo(0,650)');await snap('mobile-results');
 await check(`window.__reviewErrors.length===0`,'no browser runtime errors');
 await writeFile(path.join(dir,'report.json'),JSON.stringify({url:base+'/product-master-v2-review.html?view=documents',checks,screens,realMySQL:false,formalApp:false,userUIAccepted:false},null,2));
 console.log(JSON.stringify({checks:checks.length,screens,report:path.join(dir,'report.json')}));
}finally{ws?.close();edge?.kill();await new Promise(resolve=>server.close(resolve));}
