/** Isolated memory-only React acceptance; never starts the formal App/server or MySQL. */
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'vite';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dir=path.join(root,'artifacts/product-master-ui/qa/card-selection-compact'),site=path.join(root,'artifacts/product-master-ui/qa/query-v2/site');
let base='',debug=0;
await mkdir(dir,{recursive:true});
if(!process.argv.includes('--built'))await build({configFile:path.join(root,'vite.config.ts'),base:'./',build:{outDir:site,emptyOutDir:true,copyPublicDir:false,rollupOptions:{input:path.join(root,'tools/ui-review/entries/product-master-v2-review.html')}}});
const server=createServer(async(req,res)=>{try{
 const file=path.resolve(site,decodeURIComponent(new URL(req.url??'/',base).pathname).replace(/^\/+/,''));
 if(!file.startsWith(site+path.sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');
 res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(path.join(root,'tmp/card-selection-edge-'));
const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--disable-background-networking','--disable-sync','--disable-extensions','--no-first-run','--remote-debugging-port=0','--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const checks=[],screens=[],pending=new Map();let ws,serial=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const start=Date.now();while(Date.now()-start<18000){if(await fn())return;await sleep(80);}throw Error('Timeout '+label);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP '+method));},10000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id,method,params}));});}
async function js(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
const pane='section[aria-label="人工补选色卡"]';
async function click(text){await js(`(()=>{const el=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!el||el.disabled)throw Error('Button missing/disabled '+${JSON.stringify(text)});el.click();})()`);}
async function selectorClick(selector){await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw Error('Missing/disabled '+${JSON.stringify(selector)});el.click();})()`);}
async function search(query){await js(`(()=>{const el=document.querySelector('${pane} input[type="text"],${pane} input:not([type])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(query)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('搜索色卡');await ready();}
async function ready(){await until(()=>js(`Boolean(document.querySelector('${pane} footer'))&&!document.querySelector('${pane}').getAttribute('aria-busy').includes('true')`),'cards loaded');}
async function check(expression,label){if(!await js(expression))throw Error('Check failed '+label);checks.push(label);}
async function snap(name){const image=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(dir,name+'.png'),Buffer.from(image.data,'base64'));screens.push(name+'.png');}
async function waitNotice(text){await until(()=>js(`document.body.textContent.includes(${JSON.stringify(text)})&&!document.querySelector('${pane}').getAttribute('aria-busy').includes('true')`),'notice '+text);}
try{
 await until(async()=>{try{debug=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return debug>0;}catch{return false;}},'Edge port');
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==='page');return !!target;}catch{return false;}},'Edge');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',e=>{const message=JSON.parse(e.data);const handler=pending.get(message.id);if(handler){pending.delete(message.id);message.error?handler.reject(Error(message.error.message)):handler.resolve(message.result);}});
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__errors=[];window.__imageAccess=[];addEventListener('fabric-review:image-access',e=>window.__imageAccess.push(e.detail));addEventListener('error',e=>window.__errors.push(e.message));addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));"});
 await send('Page.navigate',{url:base+'/tools/ui-review/entries/product-master-v2-review.html?view=sampleSelection'});
 await until(()=>js(`Boolean([...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='人工补选'))`),'selection page');
 await click('人工补选');await ready();
 await check(`document.querySelector('${pane} th').textContent==='色卡编号'`,'card number is first column');
 await check(`!document.querySelector('${pane}').textContent.includes('展开配色')&&!document.querySelector('${pane}').textContent.includes('收起配色')`,'card number toggles without extra copy');
 await check(`document.querySelector('section[aria-label="客户选样明细"] > div > table th').textContent==='色卡编号'`,'selected details also begin with card number');
 await check(`!document.querySelector('${pane}').textContent.includes('搜索产品')&&!document.querySelector('${pane}').textContent.includes('按货号补选')`,'no product-only search entry');
 await check(`document.querySelector('${pane} footer').textContent.includes('共 23 张色卡')`,'card pagination uses card totals');
 await check(`window.__imageAccess.length===0`,'collapsed cards request no images');
 await selectorClick('[aria-controls="card-colors-12"]');
 await until(()=>js(`document.querySelectorAll('#card-colors-12 img').length===2&&[...document.querySelectorAll('#card-colors-12 img')].every(img=>img.complete&&img.naturalWidth===320)`),'real thumbnails loaded');
 await check(`[...document.querySelectorAll('#card-colors-12 label')].map(x=>x.textContent.trim()).join(',')==='0012-1,0012-2'`,'expanded tiles show pattern numbers rather than product numbers');
 await check(`!document.querySelector('#card-colors-12 button')&&document.querySelector('[aria-controls="card-colors-12"]').closest('tr').querySelectorAll('button').length===2`,'one add action on card row and no secondary expanded action');
 await check(`document.querySelector('[aria-label="加入色卡 0012-F018"]').textContent==='加入'`,'single action label is add');
 await check(`document.querySelectorAll('#card-colors-12 input:checked').length===2`,'expanded card defaults to all colorways');
 await selectorClick('[aria-controls="card-colors-12"]');await check(`!document.querySelector('#card-colors-12')`,'card number collapses the image list');
 await selectorClick('[aria-controls="card-colors-12"]');
 await selectorClick('[aria-label="配色 0012-2-F018"]');
 await check(`document.querySelector('[aria-label="全选色卡 0012-F018 的配色"]').indeterminate`,'partial checkbox indicates mixed selection');
 await selectorClick('[aria-label="全选色卡 0012-F018 的配色"]');await selectorClick('[aria-label="全选色卡 0012-F018 的配色"]');
 await check(`document.querySelector('[aria-label="加入色卡 0012-F018"]').disabled`,'empty subset cannot submit');
 await search('棉麻');await selectorClick('[aria-controls="card-colors-13"]');
 await check(`document.querySelectorAll('#card-colors-13 input:checked').length===2`,'new search defaults all on its card');await snap('01-search-and-default-all');
 await selectorClick('[aria-label="配色 0012-2-F019"]');
 await click('模拟补选失败一次');await selectorClick('[aria-label="加入色卡 0012-F019"]');
 await waitNotice('补选失败，请重试或刷新核对');
 await check(`document.querySelectorAll('#card-colors-13 input:checked').length===1`,'failed add preserves chosen subset');await snap('02-failure-retains-subset');
 await selectorClick('[aria-label="加入色卡 0012-F019"]');await waitNotice('0012-F019：新增 1 款');
 await check(`[...document.querySelectorAll('section[aria-label="客户选样明细"] > div > table > tbody > tr')].some(row=>row.cells[1].textContent==='0012-1-F019'&&row.cells[0].textContent==='0012-F019')`,'manual selection shows source card in details');
 await selectorClick('[aria-label="加入色卡 0012-F019"]');await waitNotice('已选 1 款');
 await check(`document.querySelectorAll('section[aria-label="客户选样明细"] > div > table > tbody > tr').length===2`,'repeat subset adds no duplicate');
 await selectorClick('[aria-label="全选色卡 0012-F019 的配色"]');
 await selectorClick('[aria-label="加入色卡 0012-F019"]');await waitNotice('0012-F019：新增 1 款');
 await check(`[...document.querySelectorAll('section[aria-label="客户选样明细"] > div > table > tbody > tr')].some(row=>row.cells[1].textContent==='0012-2-F019')`,'single add button adds whole card when all checked');await snap('03-whole-card-and-source');
 await js(`(()=>{const row=[...document.querySelectorAll('section[aria-label="客户选样明细"] > div > table > tbody > tr')].find(row=>row.cells[1].textContent==='0012-1-F019');row.querySelector('button').click();})()`);
 await click('确认移除');await until(()=>js(`document.querySelectorAll('section[aria-label="客户选样明细"] > div > table > tbody > tr').length===2&&!document.querySelector('${pane}').getAttribute('aria-busy').includes('true')`),'removed');
 await selectorClick('[aria-label="配色 0012-2-F019"]');
 await selectorClick('[aria-label="加入色卡 0012-F019"]');await waitNotice('恢复 1 款');
 await check(`document.querySelectorAll('section[aria-label="客户选样明细"] > div > table > tbody > tr').length===3`,'manual subset restores removed selection without duplicate');
 await click('模拟检索失败一次');await click('搜索色卡');await until(()=>js(`document.querySelector('${pane}').textContent.includes('检索失败')`),'search error');
 await check(`document.querySelector('${pane} input').value==='棉麻'&&!document.querySelector('${pane} tbody')`,'search failure clears stale results and retains input');
 await click('重试检索');await ready();await click('清除筛选');await ready();await click('下一页色卡');await ready();
 await check(`document.querySelector('${pane} footer').textContent.includes('第 2 页')`,'next page is accessible');
 await search('0012-F019');await check(`document.querySelector('${pane} footer').textContent.includes('第 1 页')`,'new filter resets page');
 await search('未建色卡');await check(`document.querySelector('${pane}').textContent.includes('没有匹配的可选色卡')`,'uncarded search has no candidates');
 await search('0012-F019');await selectorClick('[aria-controls="card-colors-13"]');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await js("document.querySelector('section[aria-label=\"人工补选色卡\"]').scrollIntoView()");await snap('04-mobile-expanded');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
 await selectorClick('section[aria-label="AC-84 预览控制"] input[type="checkbox"]');
 await until(()=>js(`document.body.textContent.includes('已结束 · 只读')`),'closed');
 await check(`!document.querySelector('${pane}')&&![...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='人工补选'&&!x.disabled)`,'closed session cannot supplement');
 await check(`window.__imageAccess.length>0&&window.__imageAccess.every(x=>x.variant==='thumbnail')`,'all image requests use thumbnail variant');
 await check(`window.__errors.length===0`,'no runtime errors');await snap('05-closed-read-only');
 await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,screens,passed:checks.length},null,2));console.log(JSON.stringify({passed:checks.length,screenshots:screens.length,dir}));
}finally{ws?.close();edge.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
