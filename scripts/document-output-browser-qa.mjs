/** OUTPUT-01: real browser downloads from existing React print UI, memory fixture only. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'vite';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root=process.cwd(),dir=path.join(root,'artifacts/product-master-ui/qa/document-output');
const site=path.join(dir,'site'),downloads=await mkdtemp(path.join(root,'tmp/document-output-downloads-'));
await mkdir(dir,{recursive:true});
if(!process.argv.includes('--built'))await build({configFile:path.join(root,'vite.config.ts'),base:'./',build:{outDir:site,emptyOutDir:true,copyPublicDir:false,rollupOptions:{input:path.join(root,'product-master-v2-review.html')}}});
let base='',ws,serial=0;const pending=new Map(),checks=[],files=[],completed=new Map();
const server=createServer(async(req,res)=>{try{
 const file=path.resolve(site,decodeURIComponent(new URL(req.url??'/',base).pathname).replace(/^\//,''));
 if(!file.startsWith(site+path.sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(path.join(root,'tmp/document-output-edge-'));
const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--disable-background-networking','--disable-sync','--disable-extensions','--no-first-run','--remote-debugging-port=0','--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const started=Date.now();while(Date.now()-started<20000){if(await fn())return;await sleep(60);}throw Error('Timeout '+label);}
function send(method,params={}){return new Promise((resolve,reject)=>{
 const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method));},20000);
 pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});ws.send(JSON.stringify({id,method,params}));
});}
async function js(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function click(text){await js(`(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!e||e.disabled)throw Error('Button missing/disabled');e.click();})()`);}
async function check(expression,label){assert(await js(expression),label);checks.push(label);}
async function snap(name){const result=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(dir,name+'.png'),Buffer.from(result.data,'base64'));}
async function download(label){
 const before=completed.size;await click(label);await until(()=>completed.size>before,'download '+label);
 const item=[...completed.values()].at(-1);assert.equal(item.state,'completed');
 const bytes=await readFile(path.join(downloads,item.name));assert(bytes.length>100,'nonempty '+item.name);
 await writeFile(path.join(dir,item.name),bytes);files.push({name:item.name,bytes:bytes.length});return bytes;
}
try{
 let debug=0;await until(async()=>{try{debug=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return debug>0;}catch{return false;}},'debug');
 const target=(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const names=new Map();ws.addEventListener('message',event=>{
  const m=JSON.parse(event.data),handler=pending.get(m.id);
  if(handler){pending.delete(m.id);m.error?handler.reject(Error(m.error.message)):handler.resolve(m.result);}
  if(m.method==='Browser.downloadWillBegin')names.set(m.params.guid,m.params.suggestedFilename);
  if(m.method==='Browser.downloadProgress'&&m.params.state!=='inProgress')completed.set(m.params.guid,{name:names.get(m.params.guid),state:m.params.state});
 });
 await send('Page.enable');await send('Runtime.enable');
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1100,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__errors=[];addEventListener('error',e=>window.__errors.push(e.message));addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));`});
 await send('Page.navigate',{url:base+'/product-master-v2-review.html?view=documents'});
 await until(()=>js(`Boolean(document.querySelector('select[name="type"]'))`),'query');
 for(const type of ['sample','deposit','bulk']){
  await js(`(()=>{const e=document.querySelector('select[name="type"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(type)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('查询');await sleep(100);await click('编辑单据');
  await until(()=>js(`Boolean(document.querySelector('section[aria-label="V2单据编辑工作区"] article'))`),'editor');
  await click('预览已保存版本 / Excel');await until(()=>js(`Boolean(document.querySelector('[data-v2-print-sheet]'))`),'print');
  await check(`Math.abs(document.querySelector('[data-v2-print-sheet]').getBoundingClientRect().width-240*96/25.4)<1`,type+' fixed 240mm sheet');
  const json=JSON.parse((await download('下载打印 JSON')).toString('utf8'));
  const displayed=await js(`(()=>{const s=document.querySelector('[data-v2-print-sheet]');return {title:s.querySelector('h2').textContent,companyName:s.querySelector('h3').textContent,headers:[...s.querySelectorAll('th')].map(e=>e.textContent),rows:[...s.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(e=>e.textContent)),text:s.textContent};})()`);
  assert.equal(json.title,displayed.title);assert.equal(json.companyName,displayed.companyName);
  assert.deepEqual(json.columns.map(c=>c.label),displayed.headers);assert.deepEqual(json.rows,displayed.rows);
  for(const summary of json.summaries){assert(displayed.text.includes(summary.left));if(summary.right)assert(displayed.text.includes(summary.right));}
  for(const value of [json.docNo,json.dateText,json.customerName,...json.companyLines,json.terms,...Object.values(json.signature)]){
   if(value)assert(displayed.text.includes(value),'print metadata present: '+value);
  }
  checks.push(type+' JSON document identity, current company lines, terms and signature match preview');
  assert(!('ownerId' in json));assert(!('displaySnapshot' in json));checks.push(type+' downloaded JSON matches all displayed rows/summaries and public print projection');
  const size=await js(`(()=>{const r=document.querySelector('[data-v2-print-sheet]').getBoundingClientRect();return {width:r.width,height:r.height};})()`);
  const png=await download('下载 PNG'),metadata=await sharp(png).metadata();
  assert.equal(metadata.format,'png');assert(Math.abs(metadata.width-size.width*2)<3);assert(Math.abs(metadata.height-size.height*2)<3);
  const stats=await sharp(png).stats();assert(stats.channels.some(c=>c.stdev>10),'PNG includes ink');checks.push(type+' actual PNG matches paper dimensions at scale 2 and contains visible content');
  await snap(type+'-preview');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  const narrow=await download('下载 PNG'),narrowMeta=await sharp(narrow).metadata();
  assert.equal(narrowMeta.width,metadata.width);assert.equal(narrowMeta.height,metadata.height);
  assert.deepEqual(await sharp(narrow).raw().toBuffer(),await sharp(png).raw().toBuffer());
  checks.push(type+' narrow viewport exports identical complete paper pixels');await snap(type+'-narrow');
  await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1100,deviceScaleFactor:1,mobile:false});
  if(type==='deposit'){
   assert(displayed.text.includes('25%  ¥150.00'));assert(!/应收|应付/.test(displayed.text));checks.push('deposit JSON/preview uses rounded monetary deposit without receivable');
   // The review fixture intentionally has no XLSX endpoint: test the real error UI without claiming successful server export.
   await click('下载打印Excel');await until(()=>js(`document.querySelector('[role="alert"]')?.textContent.includes('没有导出权限')`),'explicit Excel failure');
   await check(`[...document.querySelectorAll('button')].filter(b=>['下载 PNG','下载打印 JSON','下载打印Excel'].includes(b.textContent.trim())).every(b=>!b.disabled)`,'export failure restores actions');
   await download('下载打印 JSON');await check(`!document.querySelector('[role="alert"]')`,'retrying local JSON clears prior export failure');
  }
  await click('返回编辑');await click('取消并返回');
 }
 await check(`window.__errors.length===0`,'no browser runtime errors');
 const report={passed:checks.length,checks,files,scope:'Current isolated React UI and memory fixture; no production DB, COS, physical printer or formal App.',userUIAccepted:false};
 await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();edge.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
