/** Existing V2 editor/print UI, memory-only review data. No formal App, DB or writes. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'vite';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'artifacts/product-master-ui/qa/document-types'),site=path.join(root,'artifacts/product-master-ui/qa/query-v2/site');
await mkdir(dir,{recursive:true});
if(!process.argv.includes('--built'))await build({configFile:path.join(root,'vite.config.ts'),base:'./',build:{outDir:site,emptyOutDir:true,copyPublicDir:false,rollupOptions:{input:path.join(root,'product-master-v2-review.html')}}});
let base='',ws,serial=0;const pending=new Map(),checks=[],screens=[];
const server=createServer(async(req,res)=>{try{const file=path.resolve(site,decodeURIComponent(new URL(req.url??'/',base).pathname).replace(/^\//,''));if(!file.startsWith(site+path.sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(path.join(root,'tmp/document-types-edge-'));
const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--disable-background-networking','--disable-sync','--disable-extensions','--no-first-run','--remote-debugging-port=0','--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const start=Date.now();while(Date.now()-start<15000){if(await fn())return;await sleep(60);}throw Error('Timeout '+label);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method));},10000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id,method,params}));});}
async function js(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function click(text){await js(`(()=>{const el=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!el||el.disabled)throw Error('Button missing/disabled '+${JSON.stringify(text)});el.click();})()`);}
async function input(selector,value,tag='input'){await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Field missing');Object.getOwnPropertyDescriptor(${tag==='select'?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('${tag==='select'?'change':'input'}',{bubbles:true}));})()`);}
async function check(expression,label){if(!await js(expression))throw Error('Check failed '+label);checks.push(label);}
async function snap(name){const image=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(dir,name+'.png'),Buffer.from(image.data,'base64'));screens.push(name+'.png');}
const editor='section[aria-label="V2单据编辑工作区"]';
try{
 let debug=0;await until(async()=>{try{debug=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return debug>0;}catch{return false;}},'debug port');
 const target=(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',e=>{const message=JSON.parse(e.data),handler=pending.get(message.id);if(handler){pending.delete(message.id);message.error?handler.reject(Error(message.error.message)):handler.resolve(message.result);}});
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1100,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__errors=[];addEventListener('error',e=>window.__errors.push(e.message));addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));"});
 await send('Page.navigate',{url:base+'/product-master-v2-review.html?view=documents'});
 await until(()=>js(`Boolean(document.querySelector('select[name="type"]'))`),'query page');
 for(const type of ['sample','deposit','bulk']){
  await input('select[name="type"]',type,'select');await click('查询');await sleep(100);
  await until(()=>js(`Boolean(document.querySelector('section[aria-label="V2单据查询工作区"] footer'))`),'query ready');await click('编辑单据');
  await until(()=>js(`Boolean(document.querySelector('${editor} article'))&&!document.body.textContent.includes('正在读取V2单据')`),'editor ready');
  if(type==='sample'){
   await check(`!document.querySelector('${editor} input[name="deposit"]')`,'sample has no deposit field');
   await check(`document.querySelector('${editor}').textContent.includes('已结清')`,'sample retains settlement');
   await check(`!document.querySelector('${editor}').textContent.includes('扣损米数')`,'sample has no sales deductions');
  }else if(type==='deposit'){
   await check(`document.querySelector('${editor}').textContent.includes('定金比例（%）')&&document.querySelector('input[name="deposit"]').value==='25'`,'deposit edits percentage rather than money');
   await check(`!document.querySelector('${editor}').textContent.includes('已结清')&&!document.querySelector('${editor}').textContent.includes('逐匹米数')&&!document.querySelector('${editor}').textContent.includes('扣损米数')`,'deposit has no settlement, pieces or deductions');
   await input('input[name="deposit"]','1e');await click('保存修改');
   await until(()=>js(`document.querySelector('${editor} [role="alert"]')?.textContent.includes('有效非负数字')`),'invalid partial guarded');
   await check(`document.querySelector('input[name="deposit"]').value==='1e'`,'partial percent remains visible and never silently becomes zero');
   await input('input[name="deposit"]','101');await click('保存修改');
   await until(()=>js(`document.querySelector('${editor} [role="alert"]')?.textContent.includes('0～100')`),'percentage range guard');
   await check(`document.querySelector('input[name="deposit"]').value==='101'`,'out-of-range percent retained for correction');
   await input('input[name="deposit"]','25');
  }else{
   await check(`document.querySelector('${editor}').textContent.includes('定金金额（元）')&&document.querySelector('${editor}').textContent.includes('已结清')`,'sales retains monetary deposit and settlement');
   await check(`document.querySelector('${editor}').textContent.includes('扣损米数')`,'sales retains deduction control');
  }
  await snap(type+'-edit');await click('预览已保存版本 / Excel');
  await until(()=>js(`Boolean(document.querySelector('[data-v2-print-sheet]'))`),'saved print');
  if(type==='deposit'){
   await check(`document.querySelector('[data-v2-print-sheet]').textContent.includes('25%  ¥150.00')&&document.querySelector('[data-v2-print-sheet]').textContent.includes('应收金额：¥450.00')`,'saved deposit preview displays computed money and receivable');
   await check(`!document.querySelector('[data-v2-print-sheet]').textContent.includes('匹数')&&!document.querySelector('[data-v2-print-sheet]').textContent.includes('已结清')`,'deposit print omits pieces and settlement');
  }else if(type==='sample'){
   await check(`document.querySelector('[data-v2-print-sheet]').textContent.includes('应收金额：¥600.00')&&!document.querySelector('[data-v2-print-sheet]').textContent.includes('预收')`,'sample preview receives full gross without prepayment');
  }
  await snap(type+'-print');await click('返回编辑');await click('取消并返回');
 }
 await check(`window.__errors.length===0`,'no browser runtime errors');
 await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,screens,passed:checks.length},null,2));console.log(JSON.stringify({passed:checks.length,screenshots:screens.length,dir}));
}finally{ws?.close();edge.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
