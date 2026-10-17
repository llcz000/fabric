/** B2-4: actual local Edge headless UI + XLSX roundtrip.
 * Temporary production-style Vite build; never production App/server/MySQL/COS. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'vite';
import ExcelJS from 'exceljs';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
const root=process.cwd(),dir=path.join(root,'artifacts/product-master-ui/qa/b2-4');
const temp=await mkdtemp(path.join(tmpdir(),'fabric-b2-4-edge-'));
const site=path.join(temp,'site'),profile=path.join(temp,'profile'),downloads=path.join(temp,'downloads');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const checks=[],screens=[];const errors=[];
let http,edge,ws,serial=0,base;
const pending=new Map();
const downloadNames=new Map(),completedDownloads=new Set();
const timeout=15000;
async function until(fn,label,ms=timeout){
 const start=Date.now(),failures=[];
 while(Date.now()-start<ms){
  try{const result=await fn();if(result)return result;}catch(error){if(failures.length<2)failures.push(String(error));}
  await sleep(140);
 }
 throw Error('TIMEOUT '+label+(failures.length?' '+failures.join('; '):''));
}
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);
  pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function js(code){
 const x=await send('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});
 if(x.exceptionDetails)throw Error('Browser JS '+x.exceptionDetails.text);
 return x.result?.value;
}
async function click(code){
 if(!await js('(()=>{const e='+code+';if(!e)return false;e.click();return true;})()'))
  throw Error('Missing click target '+code);
}
async function fill(selector,value){
 const ok=await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)return false;'+
  'Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+
   JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
 if(!ok)throw Error('Missing input '+selector);
}
async function check(code,label){
 if(!await js(code))throw Error('FAILED '+label);
 checks.push(label);
}
async function snap(name){
 const pic=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
 await writeFile(path.join(dir,name+'.png'),Buffer.from(pic.data,'base64'));screens.push(name+'.png');
}
const button=text=>'[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==='+JSON.stringify(text)+')';
const rowFor=no=>'[...document.querySelectorAll("main[data-review-view=fabric] tbody tr")].find(e=>e.querySelector("td")?.textContent.trim()==='+JSON.stringify(no)+')';
async function xlsx(name,expectedDesc,qr){
 const files=await until(async()=>{
  if(!completedDownloads.has(name))return null;
  const names=(await readdir(downloads)).filter(f=>/\.xlsx$/i.test(f));
  const all=names.map(f=>({f,filename:path.join(downloads,f)}));
  const found=all.find(x=>x.f===name);return found??null;
 },'real Edge downloaded XLSX',20000);
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await readFile(files.filename));
 const sheet=workbook.worksheets[0];
 const header=['色卡编号','品名','成分','克重','门幅','二维码'];
 for(let i=0;i<6;i++)if(sheet.getCell(1,i+1).value!==header[i])
  throw Error('Excel six headers mismatch '+i);
 if(sheet.rowCount!==2||sheet.getCell('A2').value!=='G0179-F038'||sheet.getCell('B2').value!==expectedDesc||
   sheet.getCell('F2').value!==qr||sheet.getCell('F2').type!==ExcelJS.ValueType.String)
  throw Error('Real downloaded Excel row/QR mismatch');
 checks.push('Edge download '+name+' real XLSX six typed columns with stable QR');
 // The temp directory is owned by this test; remove only its validated download,
 // so Edge can reuse the literal filename on the next export without ambiguity.
 await rm(files.filename,{force:true});completedDownloads.delete(name);
}
try{
 await mkdir(dir,{recursive:true});await mkdir(downloads,{recursive:true});
 await build({configFile:path.join(root,'vite.config.ts'),base:'./',
  build:{outDir:site,emptyOutDir:true,copyPublicDir:false,
   rollupOptions:{input:path.join(root,'product-master-v2-review.html')}}});
 http=createServer(async(req,res)=>{
  try{
   const requested=decodeURIComponent(new URL(req.url??'/',base).pathname).replace(/^\/+/,''),dest=path.resolve(site,requested||'product-master-v2-review.html');
   if(!dest.startsWith(site+path.sep)){res.writeHead(403);res.end();return;}
   const buf=await readFile(dest),ext=path.extname(dest);
   res.writeHead(200,{'Content-Type':ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.html'?'text/html':'application/octet-stream',
    'Cache-Control':'no-store'});res.end(buf);
  }catch{res.writeHead(404);res.end('not found');}
 });
 await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(0,'127.0.0.1',resolve);});
 const port=http.address().port;base='http://127.0.0.1:'+port;
 const edgePath='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
 const debug=52986;
 edge=spawn(edgePath,['--headless=new','--disable-gpu','--disable-background-networking',
  '--disable-sync','--disable-extensions','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port='+debug,'--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],
  {cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
 const target=await until(async()=>{
  try{const rsp=await fetch('http://127.0.0.1:'+debug+'/json/list');
   return (await rsp.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);}
  catch{return null;}
 },'Edge debugger attached',19000);
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',event=>{try{
  const message=JSON.parse(event.data);
  if(message.method==='Browser.downloadWillBegin')downloadNames.set(message.params.guid,message.params.suggestedFilename);
  if(message.method==='Browser.downloadProgress'&&message.params.state==='completed')completedDownloads.add(downloadNames.get(message.params.guid));
  if(['Runtime.exceptionThrown','Log.entryAdded','Network.loadingFailed'].includes(message.method))
   errors.push({kind:message.method,message:JSON.stringify(message.params).slice(0,200)});
  if(message.id&&pending.has(message.id)){
   const item=pending.get(message.id);pending.delete(message.id);
   message.error?item.reject(Error(message.error.message)):item.resolve(message.result??{});
  }
 }catch{}});
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:
  'window.__reviewErrors=[];window.addEventListener("error",e=>window.__reviewErrors.push(String(e.message)));'+
  'window.addEventListener("unhandledrejection",e=>window.__reviewErrors.push(String(e.reason)));'});
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
 for(const width of [320,360,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await send('Page.navigate',{url:base+'/product-master-v2-review.html?view=sampleCards'});
  await until(()=>js('document.querySelector("main[data-review-view=sampleCards]")?.textContent.includes("实体色卡")'),'deep-linked card page '+width);
  await check('document.querySelector("nav button[aria-current=page]")?.textContent==="色卡库"','deep-linked card tab '+width);
  await check('document.documentElement.scrollWidth<=innerWidth+3','no card body overflow '+width);
  await check('JSON.stringify([...document.querySelectorAll("main table thead th")].slice(1,7).map(x=>x.textContent))===JSON.stringify(["色卡编号","品名","成分","克重","门幅","二维码"])','six Chinese card table headers '+width);
  await snap('card-empty-'+width);
 }
 await click(button('新增色卡'));
 await until(()=>js('!!document.querySelector("[role=dialog][aria-label=新增色卡]")'),'card modal');
 await check('document.activeElement?.getAttribute("aria-label")==="花型母版"','create dialog focuses master');
 await fill('input[aria-label=花型母版]','G0179');
 await until(()=>js('document.querySelector("[role=listbox][aria-label=母版候选]")?.textContent.includes("G0179")'),'master search candidates');
 await click('[...document.querySelectorAll("[role=listbox][aria-label=母版候选] [role=option]")].find(e=>e.textContent.trim()==="G0179")');
 await until(()=>js('document.querySelector("[aria-label=花型母版校对区]")?.textContent.includes("G0179-1")'),'master versions proof');
 await fill('input[aria-label=面料品号]','F038');
 await until(()=>js('document.querySelector("[role=listbox][aria-label=面料候选]")?.textContent.includes("F038")'),'fabric search candidates');
 await click('[...document.querySelectorAll("[role=listbox][aria-label=面料候选] [role=option]")].find(e=>e.textContent.trim()==="F038")');
 await check('document.querySelector("[aria-label=面料校对条]")?.textContent.includes("F038")','fabric proof shows selected item');
 await check('document.querySelector("[role=dialog]")?.textContent.includes("G0179-F038")','article no derived from selected master+fabric');
 await snap('card-create-proof-1440');
 await click(button('生成色卡'));
 await until(()=>js('!document.querySelector("[role=dialog][aria-label=新增色卡]")&&document.querySelector("main [role=status]")?.textContent.includes("已生成色卡 G0179-F038")'),'create succeeds, shows notice and closes dialog');
 checks.push('create success closes dialog and shows generated notice');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("G0179-F038")'),'created card row');
 const qr=await js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.getAttribute("data-qr-payload")');
 if(!qr||!qr.match(/^[A-Za-z0-9_-]{43}$/))throw Error('Card payload not valid stable opaque');
 await snap('card-created-1440');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("G0179-F038")'),'card table updated');
 await check('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.getAttribute("data-qr-payload")==='+JSON.stringify(qr),'table QR equals created QR');
 await fill('input[aria-label=查找色卡]','F038');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("G0179-F038")'),'card search filter');
 await check('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("G0179-F038")','card searches by fabric code');
 await snap('card-filtered-1440');
 await click('document.querySelector("main[data-review-view=sampleCards] tbody input[type=checkbox]")');
 await check('document.querySelector("main[data-review-view=sampleCards] tbody input[type=checkbox]")?.checked===true','single card explicitly selected');
 await click(button('导出 Excel'));
 await xlsx('sample-cards.xlsx','轻盈真丝雪纺',qr);
 await snap('card-export-success-1440');

 // The fabric F038 has ZERO existing product references, so only a newly
 // created sample card can justify refusing a subsequent fabric-no rename.
 await click('document.querySelectorAll("nav button")[1]');
 await until(()=>js('!!'+rowFor('F038')),'fabric row F038');
 await click('(()=>{const row='+rowFor('F038')+';return [...row.querySelectorAll("button")].find(x=>x.textContent.trim()==="编辑");})()');
 await until(()=>js('!!document.querySelector("main[data-review-view=fabric] input[aria-label=品号]")'),'fabric inline edit');
 await check('document.querySelector("main[data-review-view=fabric] input[aria-label=品号]")?.readOnly===false','card-only fabric has no product reference readonly lock');
 await fill('main[data-review-view=fabric] input[aria-label=品号]','F999');
 await click('document.querySelector("main[data-review-view=fabric] input[aria-label=品号]")?.closest("tr")?.querySelector("button")');
 await until(()=>js('!!document.querySelector("main[data-review-view=fabric] tbody [role=alert]")'),'card-only fabric rename rejected by server path');
 await check('document.querySelector("main[data-review-view=fabric] tbody [role=alert]")?.textContent.includes("409")','card-only fabric identity rename forbidden 409');
 await snap('card-fabric-identity-blocked-1440');
 await fill('main[data-review-view=fabric] input[aria-label=品号]','F038');
 await fill('main[data-review-view=fabric] input[aria-label=品名]','=浏览器更新品名');
 await click('document.querySelector("main[data-review-view=fabric] input[aria-label=品号]")?.closest("tr")?.querySelector("button")');
 await until(()=>js('document.querySelector("main[data-review-view=fabric] tbody")?.textContent.includes("=浏览器更新品名")'),'fabric specs update');
 await click('document.querySelectorAll("nav button")[3]');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody")?.textContent.includes("=浏览器更新品名")'),'card displays latest fabric name on same identity');
 await check('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.getAttribute("data-qr-payload")==='+JSON.stringify(qr),'fabric changes preserve card QR');
 await snap('card-live-fabric-refresh-1440');
 await click('document.querySelector("main[data-review-view=sampleCards] tbody input[type=checkbox]")');
 await click(button('导出 Excel'));
 await xlsx('sample-cards.xlsx','=浏览器更新品名',qr);
 await snap('card-updated-xlsx-export-1440');
 // UI delete is possible for F038 because it has zero PRODUCTS; the sample card
 // alone still obliges the common in-memory business API to refuse it.
 await click('document.querySelectorAll("nav button")[1]');
 await until(()=>js('!!'+rowFor('F038')),'current referenced F038 fabric row');
 await click('(()=>{const r='+rowFor('F038')+';return [...r.querySelectorAll("button")].find(x=>x.textContent.trim()==="删除");})()');
 await until(()=>js('!!document.querySelector("[data-fabric-delete-dialog]")'),'fabric delete confirm modal');
 await click('document.querySelector("[data-fabric-delete-dialog] button:last-child")');
 await until(()=>js('!!document.querySelector("main[data-review-view=fabric] [role=alert]")'),'card-only fabric deletion is rejected');
 await check('document.querySelector("main[data-review-view=fabric] [role=alert]")?.textContent.includes("409")','card-only fabric delete forbidden 409');
 await check('!!'+rowFor('F038'),'card-referenced fabric remains after failed delete');
 await snap('card-fabric-delete-blocked-1440');
 // B2-5 real Edge operations against the isolated in-memory service:
 // printing marker, pending-only filter, acknowledgment and old token retirement.
 await click('document.querySelectorAll("nav button")[3]');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("需重新打印")'),'B2-5 linked fabric update flags physical card for reprint');
 await check('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("需重新打印")','B2-5 current card carries reprint warning');
 await snap('b2-5-reprint-pending-1440');
 await click('document.querySelector("input[aria-label=只看需重新打印]")');
 await until(()=>js('document.querySelector("input[aria-label=只看需重新打印]")?.checked&&document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("G0179-F038")'),'B2-5 pending only filter');
 await check('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("需重新打印")','B2-5 server-side pending filter keeps matching card');
 await click('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="标记已重新打印 G0179-F038")');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards]")?.textContent.includes("已标记重新打印")'),'B2-5 acknowledged printed current revision');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")===null'),'B2-5 acknowledged card removed from pending only filter');
 await snap('b2-5-pending-cleared-1440');
 await click('document.querySelector("input[aria-label=只看需重新打印]")');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("G0179-F038")'),'B2-5 all cards after printing done');
 await check('!document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("需重新打印")','B2-5 confirmed card has no outstanding printing warning');
 await js('(()=>{window.confirm=()=>true;return true;})()');
 await click('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="删除色卡 G0179-F038")');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards]")?.textContent.includes("旧二维码永久作废")'),'B2-5 actual card business retirement');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")===null'),'B2-5 retired card vanishes from active card list');
 await snap('b2-5-card-retired-1440');
 await click(button('新增色卡'));
 await until(()=>js('!!document.querySelector("[role=dialog][aria-label=新增色卡]")'),'B2-5 recreate dialog');
 await fill('input[aria-label=花型母版]','G0179');
 await until(()=>js('document.querySelector("[role=listbox][aria-label=母版候选]")?.textContent.includes("G0179")'),'B2-5 recreated master candidate');
 await click('[...document.querySelectorAll("[role=listbox][aria-label=母版候选] [role=option]")].find(e=>e.textContent.trim()==="G0179")');
 await fill('input[aria-label=面料品号]','F038');
 await until(()=>js('document.querySelector("[role=listbox][aria-label=面料候选]")?.textContent.includes("F038")'),'B2-5 recreated fabric candidate');
 await click('[...document.querySelectorAll("[role=listbox][aria-label=面料候选] [role=option]")].find(e=>e.textContent.trim()==="F038")');
 await click(button('生成色卡'));
 await until(()=>js('!document.querySelector("[role=dialog][aria-label=新增色卡]")&&document.querySelector("main [role=status]")?.textContent.includes("已生成色卡 G0179-F038")'),'B2-5 recreate closes dialog');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("G0179-F038")'),'B2-5 recreated row');
 const replacementQr=await js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.getAttribute("data-qr-payload")');
 if(!replacementQr||replacementQr===qr)throw Error('B2-5 retired original QR was improperly reused');
 checks.push('B2-5 same combination recreated with a distinct QR payload');
 await snap('b2-5-same-combo-new-qr-1440');
 await until(()=>js('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.textContent.includes("G0179-F038")'),'B2-5 replacement active card');
 await check('document.querySelector("main[data-review-view=sampleCards] tbody tr")?.getAttribute("data-qr-payload")==='+JSON.stringify(replacementQr),'B2-5 replacement row QR remains new and original irrevocable');
 await click('document.querySelectorAll("nav button")[0]');
 await until(()=>js('!!document.querySelector("[role=table][aria-label=花型母版列表] [role=cell]")'),'pattern separate topic column');
 await check('JSON.stringify([...document.querySelectorAll("[aria-label=花型母版列表] [role=columnheader]")].map(x=>x.textContent))===JSON.stringify(["花型","题材标签","颜色标签","配色版本","操作"])','pattern topics and colors have their own headers');
 await check('document.querySelector("[aria-label=花型母版列表] [role=row]:nth-child(2)").querySelectorAll(":scope > [role=cell]").length===5','pattern rows align identity, topics, colors, versions and actions');
 await snap('pattern-topic-column-1440');
 await click('document.querySelectorAll("nav button")[1]');
 await until(()=>js('!!document.querySelector("main[data-review-view=fabric] tbody tr")'),'fabric default unit');
 await click(button('新增面料'));
 await until(()=>js('!!document.querySelector("select[aria-label=克重单位]")'),'new fabric inline form');
 await check('document.querySelector("select[aria-label=克重单位]").value==="gsm"','new fabric preselects gsm');
 await fill('input[aria-label=品号]','FUI0316');await fill('input[aria-label=品名]','默认单位空克重');
 await snap('fabric-default-gsm-1440');await click(button('保存'));
 await until(()=>js('!document.querySelector("select[aria-label=克重单位]")&&!!'+rowFor('FUI0316')),'optional empty weight saves successfully');
 await check('!!'+rowFor('FUI0316'),'default gsm does not make empty optional weight invalid');
 await check('window.__reviewErrors.length===0','zero uncaught browser exceptions');
 const report={environment:'Headless Microsoft Edge CDP with Vite isolated production-style bundle and in-memory fake API',
  at:new Date().toISOString(),url:base,viewports:[320,360,1440],
  checks,files:screens,qrPayloadRecorded:false,downloadedRealXlsx:true,
  productionTouched:false,remoteMysqlTouched:false,cosTouched:false,events:errors};
 await writeFile(path.join(dir,'b2-4-edge-qa.json'),JSON.stringify(report,null,2));
 console.log('B2_4_EDGE_BROWSER_PASS '+JSON.stringify({checks:checks.length,screenshots:screens.length,
  excel:'real six-column XLSX checked',folder:dir}));
}catch(error){
 const message=String(error.stack??error);
 await mkdir(dir,{recursive:true});
 try{
  const state=await js('({url:location.href,view:document.querySelector("main[data-review-view]")?.getAttribute("data-review-view"),text:document.body.innerText.slice(0,1300),errors:window.__reviewErrors})');
  console.error('B2_4_BROWSER_STATE '+JSON.stringify(state));await snap('browser-failure');
 }catch(e){console.error('B2_4_DEBUG_FAILURE '+String(e));}
 await writeFile(path.join(dir,'b2-4-edge-failure.json'),JSON.stringify({error:message,checks,screens},null,2));
 console.error('B2_4_EDGE_BROWSER_FAIL '+message);process.exitCode=1;
}finally{
 try{ws?.close();}catch{}try{edge?.kill();}catch{}try{http?.close();}catch{}
 await sleep(500);await rm(temp,{recursive:true,force:true,maxRetries:2,retryDelay:150}).catch(()=>{});
}
