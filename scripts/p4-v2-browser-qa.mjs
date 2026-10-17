/** P4-6: local-only Edge CDP visual & interaction QA; no production backend. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'vite';
import ExcelJS from 'exceljs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
const root=process.cwd(),port=52973,debug=52974;
const base='http://127.0.0.1:'+port;
const dir=path.join(root,'artifacts/product-master-ui/qa/p4-6');
const site=path.join(dir,'site');
const profile=await mkdtemp(path.join(tmpdir(),'fabric-v2-edge-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const launch=(file,args)=>spawn(file,args,{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
const completeDownloads=new Set(),downloadNames=new Map(),downloads=path.join(profile,'downloads');
const checks=[],screens=[];let vite,edge,ws,serial=0;
const pending=new Map();
async function until(fn,label,ms=17000){
 const start=Date.now();let previous;
 while(Date.now()-start<ms){
  try{const result=await fn();if(result)return result;}catch(e){previous=e;}
  await sleep(150);
 }
 throw Error('TIMEOUT '+label+(previous?' '+previous.message:''));
}
function send(method,params={}){
 return new Promise((resolve,reject)=>{
  const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},14000);
  pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});
  ws.send(JSON.stringify({id,method,params}));
 });
}
async function js(expression){
 const res=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(res.exceptionDetails)throw Error('Browser error: '+res.exceptionDetails.text);
 return res.result?.value;
}
async function click(expression){
 if(!await js('(()=>{const x='+expression+';if(!x)return false;x.click();return true;})()'))
  throw Error('No button '+expression);
}
async function fill(selector,value){
 if(!await js('(()=>{const x=document.querySelector('+JSON.stringify(selector)+');if(!x)return false;'+
  'Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(x,'+JSON.stringify(value)+');'+
  'x.dispatchEvent(new Event("input",{bubbles:true}));return true;})()'))throw Error('No input '+selector);
}
async function assert(expression,name){
 if(!await js(expression))throw Error('QA check failed: '+name);
 checks.push(name);
}
async function snap(filename){
 const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});
 await writeFile(path.join(dir,filename+'.png'),Buffer.from(capture.data,'base64'));screens.push(filename+'.png');
}
try{
 await mkdir(dir,{recursive:true});
 // Use Vite's production-style bundle, not dev HMR/React Refresh. Output is isolated
 // from dist and never served by the app's existing server.ts.
 await build({configFile:path.join(root,'vite.config.ts'),base:'./',
  build:{outDir:site,emptyOutDir:true,copyPublicDir:false,
   rollupOptions:{input:path.join(root,'product-master-v2-review.html')}}});
 vite=createServer(async(req,res)=>{
  try{
   const requested=decodeURIComponent(new URL(req.url??'/',base).pathname).replace(/^\/+/,''),
    dest=path.resolve(site,requested||'product-master-v2-review.html');
   if(!dest.startsWith(site+path.sep)) {res.writeHead(403);res.end();return;}
   const data=await readFile(dest);
   const ext=path.extname(dest),mime=ext==='.js'?'text/javascript':ext==='.css'?'text/css':
    ext==='.html'?'text/html':'application/octet-stream';
   res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
 });
 await new Promise((resolve,reject)=>{vite.once('error',reject);vite.listen(port,'127.0.0.1',resolve);});
 await until(async()=>{try{const r=await fetch(base+'/product-master-v2-review.html');return r.ok;}catch{return false;}},'local built-preview server');
 edge=launch('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
  '--headless=new','--disable-gpu','--disable-background-networking','--disable-sync','--disable-extensions',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port='+debug,
  '--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'
 ]);
 const target=await until(async()=>{try{
  const r=await fetch('http://127.0.0.1:'+debug+'/json/list');
  return (await r.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
 }catch{return null;}},'Edge remote debugger');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',e=>{try{
  const m=JSON.parse(e.data);
  if(m.method==='Browser.downloadWillBegin')downloadNames.set(m.params.guid,m.params.suggestedFilename);
  if(m.method==='Browser.downloadProgress'&&m.params.state==='completed')completeDownloads.add(downloadNames.get(m.params.guid));
  if(['Runtime.exceptionThrown','Log.entryAdded','Network.loadingFailed'].includes(m.method))
   console.error('P4_6_CDP_EVENT',m.method,JSON.stringify(m.params).slice(0,900));
  if(m.id&&pending.has(m.id)){const h=pending.get(m.id);pending.delete(m.id);
   m.error?h.reject(Error(m.error.message)):h.resolve(m.result??{});}
 }catch{}});
 await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Network.enable');
 await mkdir(downloads,{recursive:true});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:
  'window.__reviewImageRequests=[];window.addEventListener("fabric-review:image-access",e=>window.__reviewImageRequests.push(e.detail));'+
  'window.__reviewErrors=[];window.addEventListener("error",e=>window.__reviewErrors.push(String(e.message)));'+
  'window.addEventListener("unhandledrejection",e=>window.__reviewErrors.push(String(e.reason)));'});
 for(const width of [320,360,1280,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await send('Page.navigate',{url:base+'/product-master-v2-review.html'});
  await until(()=>js('document.querySelector("main[data-review-view=pattern]")?.textContent?.includes("G0179")'),'pattern '+width);
  await assert('!document.querySelector("[aria-label=配色序号筛选]")','pattern numeric colorway filter removed '+width);
  await until(()=>js('[...document.querySelectorAll("main [role=table] img")].some(x=>x.naturalWidth===320)'),'pattern actual thumbnail resolution '+width);
  await assert('window.__reviewImageRequests.every(x=>x.variant==="thumbnail")','pattern list never prefetches originals '+width);
  await snap('pattern-'+width);
  await assert('document.documentElement.scrollWidth<=innerWidth+3','pattern no horizontal body overflow '+width);
  await click('document.querySelectorAll("nav button")[1]');
  await until(()=>js('document.querySelector("main[data-review-view=fabric] table tbody")?.textContent?.includes("F018")'),'fabric '+width);
  await snap('fabric-'+width);
  await assert('document.documentElement.scrollWidth<=innerWidth+3','fabric no horizontal body overflow '+width);
  await click('document.querySelectorAll("nav button")[2]');
  await until(()=>js('document.querySelector("main[data-review-view=products] table tbody")?.textContent?.includes("F018")'),'product '+width);
  await assert('!document.querySelector("main [aria-label=题材标签]")&&!document.querySelector("main [aria-label=颜色标签]")','product tag filters removed '+width);
  await assert('document.querySelectorAll("main table thead th").length===10','product table ten columns '+width);
  await until(()=>js('[...document.querySelectorAll("main table tbody img")].some(x=>x.naturalWidth===320)'),'product actual thumbnail resolution '+width);
  await assert('window.__reviewImageRequests.every(x=>x.variant==="thumbnail")','product list never prefetches originals '+width);
  await snap('product-'+width);
  await assert('document.documentElement.scrollWidth<=innerWidth+3','product no horizontal body overflow '+width);
  await assert('window.__reviewErrors.length===0','no uncaught errors '+width);
 }
 for(const [index,selector,value,filename,headers] of [
  [0,'input[aria-label=搜索编号]','G0180','花型资料.xlsx',['花型','题材标签','颜色标签','配色版本']],
  [1,'input[aria-label="搜索品号 / 品名 / 成分"]','F018','面料资料.xlsx',['品号','品名','成分','克重','门幅 / cm','备注','启用状态','关联产品']],
  [2,'input[aria-label=货号]','G0180-2-F019','产品资料.xlsx',['货号','品名','成分','克重','门幅 / cm','图片数量','备注','启用状态']]
 ]){
  await click('document.querySelectorAll("nav button")['+index+']');
  await until(()=>js('!!document.querySelector('+JSON.stringify(selector)+')'),'catalog export input');
  await fill(selector,value);await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.trim()==="导出筛选结果")');
  await until(()=>completeDownloads.has(filename),'catalog actual download '+filename);
  const bytes=await readFile(path.join(downloads,filename));const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  const sheet=book.worksheets[0];
  if(JSON.stringify(sheet.getRow(1).values.slice(1))!==JSON.stringify(headers)||sheet.rowCount!==2||!String(sheet.getCell('A2').value).includes(value))throw Error('Catalog filtered XLSX mismatch '+filename);
  await writeFile(path.join(dir,filename),bytes);checks.push('actual filtered metadata-only workbook '+filename);
 }
 await click('document.querySelectorAll("nav button")[0]');
 await until(()=>js('!!document.querySelector("[aria-label^=编辑花型及配色]")'),'pattern edit');
 await click('document.querySelector("[aria-label^=编辑花型及配色]")');
 await until(()=>js('!!document.querySelector("[data-pattern-editor]")'),'pattern edit modal');
 await assert('document.querySelectorAll("[data-pattern-editor] th").length===6','six colorway columns without per-version color tags');
 await assert('document.querySelector("[data-pattern-editor] h2").textContent==="编辑花型"','edit pattern title');
 await snap('pattern-editor-1440');
 await click('[...document.querySelectorAll("[data-pattern-editor] button")].find(x=>x.textContent.trim()==="维护颜色")');
 await until(()=>js('!!document.querySelector("[aria-label=花型颜色标签]")'),'pattern-level colors');
 await fill('input[aria-label="自定义颜色 花型颜色标签"]','暮霭紫');
 await click('[...document.querySelectorAll("[data-pattern-editor] button")].find(x=>x.textContent.trim()==="添加颜色")');
 await click('[...document.querySelectorAll("[data-pattern-editor] button")].find(x=>x.textContent.trim()==="保存颜色")');
 await until(()=>js('!document.querySelector("[aria-label=花型颜色标签]")&&document.querySelector("[data-pattern-editor]").textContent.includes("暮霭紫")'),'custom colors saved at pattern level');
 await click('[...document.querySelectorAll("[data-pattern-editor] button")].find(x=>x.textContent.trim()==="维护颜色")');
 await click('[...document.querySelectorAll("[data-pattern-editor] button")].find(x=>x.textContent.trim()==="保存颜色")');
 await until(()=>js('!document.querySelector("[aria-label=花型颜色标签]")'),'pattern color maintenance resaved');
 await assert('document.querySelector("[data-pattern-editor]").textContent.includes("历史色")','retained archived pattern colors survive repeated maintenance');
 await assert('!document.querySelector("[data-pattern-editor] tbody").textContent.includes("暮霭紫")','pattern colors are outside colorway rows');
 await snap('pattern-master-colors-1440');
 await click('[...document.querySelectorAll("[data-pattern-editor] tbody tr:first-child td:last-child button")].find(x=>x.textContent.trim()==="编辑")');
 await until(()=>js('!!document.querySelector("input[aria-label=\\"上传花型图 G0179-1\\"]")'),'image upload in edited row');
 await assert('[...document.querySelectorAll("[data-pattern-editor] tbody tr:first-child button")].filter(x=>x.textContent.trim()==="保存配色").length===1',
  'one combined colorway save button');
 const pngFile=path.join(dir,'pattern-upload.png');
 await writeFile(pngFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=','base64'));
 const rootNode=(await send('DOM.getDocument')).root.nodeId;
 const inputNode=(await send('DOM.querySelector',{nodeId:rootNode,selector:'input[aria-label="上传花型图 G0179-1"]'})).nodeId;
 await send('DOM.setFileInputFiles',{nodeId:inputNode,files:[pngFile]});
 await until(()=>js('document.querySelector("[data-pattern-editor] tbody tr:first-child img")?.src.startsWith("blob:")'),'image staged from actual File');
 await assert('!document.querySelector("[role=table][aria-label=花型母版列表] [aria-label=\\"查看花型原图 G0179-1\\"]")','upload draft does not rewrite persisted list before save');
 await click('[...document.querySelectorAll("[data-pattern-editor] tbody tr:first-child button")].find(x=>x.textContent.trim()==="保存配色")');
 await until(()=>js('!document.querySelector("input[aria-label=\\"上传花型图 G0179-1\\"]")&&document.querySelector("[data-pattern-editor] tbody tr:first-child img")?.naturalWidth>0'),'uploaded image survives saved readback');
 await snap('pattern-image-uploaded-1440');
 await click('[...document.querySelectorAll("[data-pattern-editor] tbody tr:first-child td:last-child button")].find(x=>x.textContent.trim()==="编辑")');
 await click('document.querySelector("button[aria-label=\\"删除花型图 G0179-1\\"]")');
 await assert('!document.querySelector("[data-pattern-editor] tbody tr:first-child img")','remove image changes draft');
 await click('[...document.querySelectorAll("[data-pattern-editor] tbody tr:first-child button")].find(x=>x.textContent.trim()==="取消")');
 await assert('!!document.querySelector("[data-pattern-editor] tbody tr:first-child img")','cancel removal preserves original image');
 await click('[...document.querySelectorAll("[data-pattern-editor] tbody tr:first-child td:last-child button")].find(x=>x.textContent.trim()==="编辑")');
 await click('document.querySelector("button[aria-label=\\"删除花型图 G0179-1\\"]")');
 await click('[...document.querySelectorAll("[data-pattern-editor] tbody tr:first-child button")].find(x=>x.textContent.trim()==="保存配色")');
 await until(()=>js('!document.querySelector("input[aria-label=\\"上传花型图 G0179-1\\"]")&&!document.querySelector("[data-pattern-editor] tbody tr:first-child img")'),'image detached after save');
 checks.push('actual image upload/save/readback and delete/cancel/delete-save');
 await click('[...document.querySelectorAll("[data-pattern-editor] header button")].find(x=>x.textContent.includes("添加配色"))');
 await until(()=>js('!!document.querySelector("input[aria-label=新版本备注]")'),'new numbered colorway draft');
 await click('[...document.querySelectorAll("[data-pattern-editor] tbody button")].find(x=>x.textContent.trim()==="保存新配色")');
 await until(()=>js('document.querySelector("[data-pattern-editor]")?.textContent?.includes("G0179-7")'),'new version created with numbered identity');
 await assert('document.querySelector("[data-pattern-editor]").textContent.includes("暮霭紫")','new colorway retains parent color labels');
 await snap('pattern-new-colorway-saved-1440');

 await click('document.querySelector("[aria-label=关闭配色编辑]")');
 await click('document.querySelectorAll("nav button")[1]');
 await until(()=>js('!!document.querySelector("main table tbody")'),'fabric list');
 await click('[...document.querySelectorAll("main table tbody button")].find(x=>x.textContent.trim()==="编辑")');
 await until(()=>js('!!document.querySelector("main table input[aria-label=品号]")'),'inline fabric edit');
 await assert('document.querySelector("main table input[aria-label=品号]").readOnly===true','referenced fabric number locked');
 await snap('fabric-editor-1440');
 await click('[...document.querySelectorAll("main table button")].find(x=>x.textContent.trim()==="取消")');

 // P5 XLSX import visual smoke: REAL File/FileReader in Edge, intentionally MOCK backend.
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.trim()==="导入 XLSX")');
 await until(()=>js('!!document.querySelector("section[aria-label=\\"V2 面料XLSX导入\\"]")'),'P5 XLSX import review screen');
 await snap('p5-import-empty-1440');
 await assert('document.querySelector("input[aria-label=\\"选择XLSX文件\\"]")?.accept.includes(".xlsx")',
  'P5 file chooser only accepts XLSX');
 const excel=new ExcelJS.Workbook(),sheet=excel.addWorksheet('面料资料');
 sheet.addRow(['品号','品名','成分','克重','克重单位','门幅(cm)','备注']);
 sheet.addRow(['F018','样品更新',null,null,null,null,null]);
 sheet.addRow(['F777','新增演示面料','100%真丝',16.5,'mm',145,'测试']);
 sheet.addRow(['D001','重复甲',null,null,null,null,null]);
 sheet.addRow(['D001','重复乙',null,null,null,null,null]);
 sheet.addRow(['F998','错误单位',null,88,null,null,null]);
 const b64=Buffer.from(await excel.xlsx.writeBuffer()).toString('base64');
 const fileOK=await js('(()=>{const bytes=Uint8Array.from(atob('+JSON.stringify(b64)+'),c=>c.charCodeAt(0));'+
  'const f=new File([bytes],"p5-qa.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});'+
  'const transfer=new DataTransfer();transfer.items.add(f);'+
  'const input=document.querySelector("input[aria-label=\\"选择XLSX文件\\"]");'+
  'if(!input)return false;input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
 if(!fileOK)throw Error('P5 Edge file input failed');
 await until(()=>js('!document.querySelector("main button")?.disabled'),'P5 file selected');
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.includes("生成预览"))');
 await until(()=>js('document.querySelector("main table tbody")?.textContent.includes("F777")'),'P5 preview returned five rows');
 await assert('document.querySelectorAll("main table thead th").length===8','P5 preview has eight columns');
 await assert('document.querySelectorAll("main table tbody tr").length>=5','P5 preview shows source row numbers and error rows');
 await snap('p5-import-preview-1440');
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:true});
 await snap('p5-import-preview-360');
 await assert('document.documentElement.scrollWidth<=innerWidth+3','P5 mobile preview no body overflow at 360');
 await assert('(()=>{const x=document.querySelector("[aria-label=\\\"面料导入预览横向滚动表格\\\"]");return x&&x.scrollWidth>x.clientWidth+100;})()',
  'P5 mobile table independently overflows horizontally at 360');
 await assert('(()=>{const x=document.querySelector("[aria-label=\\\"面料导入预览横向滚动表格\\\"]");x.focus();x.scrollLeft=150;return document.activeElement===x&&x.scrollLeft>=100;})()',
  'P5 horizontal table can focus and scroll at 360');
 await send('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:true});
 await js('(()=>{const x=document.querySelector("[aria-label=\\\"面料导入预览横向滚动表格\\\"]");x.scrollLeft=0;return true;})()');
 await snap('p5-import-preview-320');
 await assert('document.documentElement.scrollWidth<=innerWidth+3','P5 mobile preview no body overflow at 320');
 await assert('document.body.textContent.includes("表格可左右滑动查看全部字段")','P5 mobile table has scroll instruction at 320');

 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await click('document.querySelector("main table tbody input[type=checkbox]")');
 await assert('document.querySelector("main table tbody input[type=checkbox]")?.checked===true',
  'P5 admin explicitly selects one existing fabric for update');
 await snap('p5-import-admin-selected-1440');
 await js('(()=>{window.confirm=(msg)=>{window.__p5Confirm=msg;return true;};return true;})()');
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.includes("确认导入"))');
 await until(()=>js('!!document.querySelector("section[aria-label=\\"导入结果\\"]")'),'P5 demo import result');
 await assert('window.__p5Confirm?.includes("明确更新 1")','P5 requires count-aware confirmation');
 await assert('document.querySelector("section[aria-label=\\"导入结果\\"]").textContent.includes("新增 1")',
  'P5 results show one created record');
 await snap('p5-import-results-1440');
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.includes("返回面料库"))');
 await until(()=>js('!!document.querySelector("main table tbody")'),'P5 returned to fabrics without production write');
 await click('document.querySelectorAll("nav button")[2]');
 await until(()=>js('!!document.querySelector("main[data-review-view=products] table")'),'product list');
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.includes("新增产品"))');
 await until(()=>js('document.querySelector("main>section")?.getAttribute("aria-label")==="V2 产品编辑"'),'create editor');
 await snap('product-create-1440');
 await click('document.querySelector("button[aria-label=选择花型版本]")');
 await until(()=>js('document.querySelector("[role=dialog]")?.textContent?.includes("G0179-1")'),'version choices');
 await click('[...document.querySelectorAll("[role=dialog] button")].find(x=>x.textContent.includes("G0179-1"))');
 await click('document.querySelector("button[aria-label=选择面料]")');
 await until(()=>js('!!document.querySelector("input[aria-label=搜索面料]")'),'fabric chooser');
 await fill('input[aria-label=搜索面料]','F040');
 await until(()=>js('document.querySelector("[role=dialog]")?.textContent?.includes("F040")'),'F040 fabric choices');
 await click('[...document.querySelectorAll("[role=dialog] button")].find(x=>x.textContent.includes("F040"))');
 await assert('document.querySelector("input[aria-label=自动货号]").value==="G0179-1-F040"','generated product number only');
 await assert('!document.querySelector("input[aria-label=允许供样]")','create product form has no sampling control');
 await assert('document.querySelector("input[aria-label=启用状态]")?.checked===true','ordinary active control retained');
 await snap('product-draft-1440');
 await fill('input[aria-label=产品备注]','浏览器 QA 仅内存');
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.includes("保存产品"))');
 await until(()=>js('document.querySelector("[role=status]")?.textContent?.includes("G0179-1-F040")'),'save back to catalog');
 await until(()=>js('[...document.querySelectorAll("main table tbody tr")].some(x=>x.textContent.includes("G0179-1-F040")&&!x.textContent.includes("暂不供样")&&x.textContent.includes("已启用"))'),'create preserves default sampling and active state');
 await assert('document.querySelectorAll("main table thead th").length===10','product table retains ten columns');
 await click('(()=>{const r=[...document.querySelectorAll("main table tbody tr")].find(x=>x.textContent.includes("G0179-1-F040"));return [...r.querySelectorAll("button")].find(x=>x.textContent.trim()==="编辑");})()');
 await until(()=>js('document.querySelector("input[aria-label=产品备注]")?.value==="浏览器 QA 仅内存"'),'editor reload');
 await assert('!document.querySelector("input[aria-label=允许供样]")','edit product form has no sampling control');
 await assert('document.querySelector("input[aria-label=启用状态]")?.checked===true','edit retains active control');
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.includes("保存产品"))');
 await until(()=>js('document.querySelector("[role=status]")?.textContent?.includes("G0179-1-F040")'),'edit saves without sampling control');
 await snap('product-demo-saved-1440');
 await click('[...document.querySelectorAll("button")].find(x=>x.getAttribute("aria-label")==="查看产品图 G0179-1-F018")');
 await until(()=>js('document.querySelectorAll("[role=dialog] [role=tab]").length===3'),'product original image tabs');
 await assert('document.querySelector("[role=dialog] [role=tab][aria-selected=true]").textContent.includes("面料大图")','initial category is fabric display');
 await until(()=>js('document.querySelector("[role=tabpanel]:not([hidden]) img")?.naturalWidth===1440'),'actual original resolution loaded');
 await assert('window.__reviewImageRequests.filter(x=>x.variant==="original").every(x=>!x.ids.includes("bbbbbbbb-2222-4222-8222-222222222222")&&!x.ids.includes("cccccccc-3333-4333-8333-333333333333"))','unvisited categories do not request originals');
 await snap('product-original-tab-1440');
 await click('document.querySelector("[role=tab][data-image-role=detail]")');
 await until(()=>js('document.querySelector("[role=tabpanel]:not([hidden]) img")?.naturalWidth===1440'),'detail tab loads original');
 await assert('!window.__reviewImageRequests.some(x=>x.variant==="original"&&x.ids.includes("cccccccc-3333-4333-8333-333333333333"))','effect original not requested before tab selected');
 const beforeReturn=await js('window.__reviewImageRequests.filter(x=>x.variant==="original").length');
 await click('document.querySelector("[role=tab][data-image-role=fabricDisplay]")');
 await assert('document.querySelector("[role=tabpanel]:not([hidden]) img")?.naturalWidth===1440','switch back retains loaded original');
 await assert('window.__reviewImageRequests.filter(x=>x.variant==="original").length==='+beforeReturn,'switch back makes no additional original signing request');
 await click('document.querySelector("[role=tab][data-image-role=aiEffect]")');
 await until(()=>js('document.querySelector("[role=tabpanel]:not([hidden]) img")?.naturalWidth===1440'),'effect tab loads original');
 await click('document.querySelector("[role=tab][data-image-role=fabricDisplay]")');
 await js('document.querySelector("[role=tab][data-image-role=fabricDisplay]").focus()');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End'});
 await until(()=>js('document.activeElement.getAttribute("data-image-role")==="aiEffect"'),'tab End keyboard navigation');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home'});
 await until(()=>js('document.activeElement.getAttribute("data-image-role")==="fabricDisplay"'),'tab Home keyboard navigation');


 await js('document.querySelector("[role=tabpanel]:not([hidden])").focus()');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});
 await assert('document.activeElement.getAttribute("aria-label")==="关闭图片预览"','original tab panel focus wraps to close inside modal');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:8});
 await assert('document.activeElement.getAttribute("role")==="tabpanel"','close shift-tab wraps to active panel, not inactive tab');
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:true});
 await snap('product-original-tab-360');
 await assert('document.documentElement.scrollWidth<=innerWidth+3','original tab mobile has no body overflow');
 await click('document.querySelector("[aria-label=关闭图片预览]")');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await click('[...document.querySelectorAll("button")].find(x=>x.getAttribute("aria-label")==="查看花型原图 G0180-2-F019")');
 await until(()=>js('document.querySelector("[role=dialog] img")?.naturalWidth===1440'),'product list thumbnail opens actual original');
 await click('document.querySelector("[aria-label=关闭图片预览]")');

 await click('document.querySelectorAll("nav button")[5]');
 await until(()=>js('!!document.querySelector("select[name=type]")'),'document browser');
 await js('(()=>{const e=document.querySelector("select[name=type]");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"bulk");e.dispatchEvent(new Event("change",{bubbles:true}));})()');
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.trim()==="查询")');
 await until(()=>js('!!document.querySelector("main table tbody tr")'),'bulk filtered list');
 await click('[...document.querySelectorAll("main button")].find(x=>x.textContent.trim()==="编辑单据")');
 await until(()=>js('document.querySelectorAll("[aria-label=逐匹米数] input").length===20'),'two sales lines each ten initial pieces');
 await assert('document.querySelectorAll("[aria-label=逐匹米数] input").length===20','default ten numeric inputs per sales row');
 await js('(()=>{const e=document.querySelector("article:first-of-type input[aria-label=第1匹米数]");e.focus();e.select();})()');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'1',code:'Digit1',text:'1'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'1',code:'Digit1'});
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'e',code:'KeyE',text:'e'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'e',code:'KeyE'});
 await assert('document.querySelector("article:first-of-type [aria-label=逐匹米数] [role=alert]")?.textContent.includes("最多两位小数")','partial native numeric input never silently becomes a cleared piece');
 await fill('article:first-of-type input[aria-label=第1匹米数]','1.25');
 await fill('article:first-of-type input[aria-label=第2匹米数]','2.75');
 await assert('document.querySelector("article [aria-label=逐匹米数]").textContent.includes("已填 2 匹 · 毛米数 4.00 米")','sales gross comes from piece sum');
 await click('[...document.querySelectorAll("article:first-of-type button")].find(x=>x.textContent.trim()==="增加10匹输入位")');
 await assert('document.querySelectorAll("article:first-of-type [aria-label=逐匹米数] input").length===20','sales piece positions append');
 await fill('article:first-of-type input[aria-label=第1匹米数]','');
 await assert('document.querySelector("article [aria-label=逐匹米数]").textContent.includes("已填 1 匹 · 毛米数 2.75 米")','clearing one slot preserves other position and recalculates');
 await js('document.querySelector("[aria-label=逐匹米数]").scrollIntoView({block:"center"})');
 await snap('sales-piece-inputs-1440');
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:true});
 await assert('document.documentElement.scrollWidth<=innerWidth+3','sales piece input mobile no body overflow');await snap('sales-piece-inputs-360');
 const report={environment:'Edge headless + localhost Vite + in-memory seeded API',
  timestamp:new Date().toISOString(),viewports:[320,360,1280,1440],
  checks,files:screens,productionTouched:false};
 await writeFile(path.join(dir,'browser-qa.json'),JSON.stringify(report,null,2));
 console.log('P4_6_BROWSER_QA_PASS '+JSON.stringify({checks:checks.length,screenshots:screens.length,folder:dir}));
}catch(e){
 const error=String(e.stack??e);
 await mkdir(dir,{recursive:true});
 try{console.error('P4_6_DEBUG '+JSON.stringify(await js('({url:location.href,title:document.title,text:document.body.innerText.slice(0,1800),errors:window.__reviewErrors??[],root:document.querySelector("#root")?.innerHTML.slice(0,400),resources:performance.getEntriesByType("resource").map(x=>x.name).slice(0,20),scripts:Array.from(document.scripts).map(x=>({src:x.src,type:x.type,text:x.textContent.slice(0,80)}))})')));
  console.error('P4_6_MODULE '+JSON.stringify(await js('(async()=>{const r=await fetch("/src/product-master-v2-review/main.tsx");return {status:r.status,text:(await r.text()).slice(0,1000)}})()')));
  await snap('failure-current');}catch(err){console.error('P4_6_DEBUG_UNAVAILABLE '+String(err));}
 await writeFile(path.join(dir,'browser-qa-failure.json'),JSON.stringify({error,checks,screens},null,2));
 console.error('P4_6_BROWSER_QA_FAIL '+error);
 process.exitCode=1;
}finally{
 try{ws?.close();}catch{}
 try{edge?.kill();}catch{}try{vite?.close();}catch{}
 await sleep(500);await rm(profile,{recursive:true,force:true,maxRetries:2,retryDelay:150}).catch(()=>{});
}
