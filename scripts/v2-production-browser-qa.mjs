/** Real candidate React + SSH-forwarded HTTP + restored MySQL, no mock injection. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const config=JSON.parse(await readFile(process.env.FABRIC_SSH_LOCAL_CONFIG,'utf8'));
const credentials=JSON.parse(await readFile(process.env.FABRIC_QA_ADMIN_FILE,'utf8'));
const dir=path.resolve('artifacts/product-master-ui/qa/production-candidate');await mkdir(dir,{recursive:true});
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const ssh=spawn('ssh',['-N','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-p',String(config.ssh.port),'-L',`127.0.0.1:${port}:127.0.0.1:3001`,config.ssh.username+'@'+config.ssh.host],{stdio:'ignore',windowsHide:true});
const base=`http://127.0.0.1:${port}`,profile=await mkdtemp(path.resolve('tmp/v2-release-edge-'));
const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws,serial=0,acceptDialog=false;const pending=new Map(),checks=[],screens=[],runtimeEvents=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const now=Date.now();while(Date.now()-now<25000){if(await fn())return;await sleep(80);}throw Error('Timeout '+label);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id,method,params}));});}
async function js(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Browser evaluation failed');return r.result.value;}
async function click(label,selector='button'){await js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing action');b.click();})()`);}
async function fill(selector,value){await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function check(expression,label){assert(await js(expression),label);checks.push(label);}
async function snap(name){const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(dir,name+'.png'),Buffer.from(r.data,'base64'));screens.push(name+'.png');}
try{
 await until(async()=>{try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'SSH candidate health');
 let debug;await until(async()=>{try{debug=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return debug>0;}catch{return false;}},'Edge');
 const target=(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(m.method==='Page.javascriptDialogOpening'){runtimeEvents.push(m.params.type);void send('Page.handleJavaScriptDialog',{accept:acceptDialog});}if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1100,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__runtimeErrors=[];addEventListener('error',e=>window.__runtimeErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__runtimeErrors.push(String(e.reason)));"});
 await send('Page.navigate',{url:base});await until(()=>js(`Boolean(document.querySelector('form[aria-label="账号登录"]'))`),'real login');
 await fill('input[name="username"]',credentials.username);await fill('input[name="password"]',credentials.password);await click('登录');
 await until(()=>js(`Boolean(document.querySelector('nav[aria-label="主导航"]'))`),'real navigation');checks.push('real browser login and current company load');
 for(const [label,ready,name] of [
  ['花型库','section[aria-label="V2 花型库"]','patterns'],
  ['面料库','table','fabrics'],['产品库','table','products'],['色卡库','table','cards'],['成员管理','section[aria-label="成员管理"]','members']
 ]){
  await click(label,'nav[aria-label="主导航"] button');await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(ready)}))`),label);
  await until(()=>js(`!document.querySelector('main [role="status"]')?.textContent.includes('正在')`),label+' data');
  await check(`![...document.querySelectorAll('main [role="alert"]')].some(e=>/失败|不可用|无效/.test(e.textContent))`,label+' real API rendered without an error');await snap(name);
 }
 await click('单据列表','nav[aria-label="主导航"] button');await until(()=>js(`Boolean(document.querySelector('input[name="from"]'))`),'document search');
 await fill('input[name="from"]','2026-10-17');await click('查询');await sleep(400);
 await check(`document.body.textContent.includes('部署验收客户')`,'real saved fixture documents appear in existing query');await snap('fixture-documents');
 await fill('input[name="customer"]','部署验收客户');await click('查询');await until(()=>js(`Boolean(document.querySelector('tbody tr button'))`),'fixture result');
 await click('预览 / Excel');await until(()=>js(`Boolean(document.querySelector('[data-v2-print-sheet] img'))`),'current company print images');
 await check(`document.querySelectorAll('[data-v2-print-sheet] img').length===3&&document.body.textContent.includes('演练开单签字')`,'actual current company logo, two QR codes and signature labels render');
 await js(`Promise.all([...document.querySelectorAll('[data-v2-print-sheet] img')].map(i=>i.decode()))`);
 const pdf=Buffer.from((await send('Page.printToPDF',{preferCSSPageSize:true,printBackground:true})).data,'base64');
 await writeFile(path.join(dir,'fixture-print.pdf'),pdf);const box=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf.toString('latin1'));assert(box,'PDF page size metadata');
 assert(Math.abs(Number(box[1])-240/25.4*72)<2&&Math.abs(Number(box[2])-140/25.4*72)<2,'browser PDF must use the approved 240×140 mm paper');checks.push('actual browser PDF uses 240×140 mm paper');
 await snap('print-current-company');await click('返回查询');
 await until(()=>js(`Boolean(document.querySelector('input[name="customer"]'))`),'back to list');
 await click('复制');await until(()=>js(`Boolean(document.querySelector('input[name="docNo"]')?.value)`),'copy reserves fresh number');
 const copyNo=await js(`document.querySelector('input[name="docNo"]').value`);assert.match(copyNo,/^YB-/);await fill('input[name="customerName"]','QA-BROWSER-'+Date.now());
 const copyCustomer=await js(`document.querySelector('input[name="customerName"]').value`);await click('创建单据');await until(()=>js(`Boolean(document.querySelector('input[name="customer"]'))`),'copy saved');
 await fill('input[name="customer"]',copyCustomer);await click('查询');await until(()=>js(`document.body.textContent.includes(${JSON.stringify(copyNo)})`),'new copied record');checks.push('copy creates a separately persisted document with a freshly reserved number');
 acceptDialog=false;await click('删除');await check(`document.body.textContent.includes(${JSON.stringify(copyNo)})`,'declining native delete confirmation retains the document');
 acceptDialog=true;await click('删除');await until(()=>js(`document.body.textContent.includes('没有符合条件的单据')`),'confirmed delete refreshed list');assert(runtimeEvents.filter(x=>x==='confirm').length>=2);checks.push('accepting native confirmation deletes only the copied fixture and refreshes list');
 await click('新增单据','nav[aria-label="主导航"] button');await until(()=>js(`Boolean(document.querySelector('section[aria-label="V2单据编辑工作区"]'))`),'create');
 await until(()=>js(`Boolean(document.querySelector('input[name="docNo"]')?.value)`),'default number');
 await check(`document.querySelector('input[name="docNo"]').value.startsWith('YB-')`,'new document reserves a real durable default number');
 await check(`!document.querySelector('input[name="deposit"]')`,'sample create omits deposit');await snap('new-document');
 await click('花型库','nav[aria-label="主导航"] button');await until(()=>js(`Boolean(document.querySelector('[role="table"]'))`),'narrow patterns');
 await click('新增花型');await until(()=>js(`Boolean(document.querySelector('dialog[open][aria-label="新增花型"]'))`),'new pattern dialog');
 const patternNo='BROWSER'+Date.now();await fill('input[name="masterNo"]',patternNo);await click('保存花型');await until(()=>js(`!document.querySelector('dialog[open][aria-label="新增花型"]')&&document.body.textContent.includes(${JSON.stringify(patternNo)})`),'pattern persisted');checks.push('real pattern create dialog persists and closes after success');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await snap('patterns-narrow');
 await check(`window.__runtimeErrors.length===0`,'no browser runtime exceptions');
 await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:checks.length,checks,screens,backend:'real candidate via SSH port forward',database:'restored MySQL rehearsal',userUIAccepted:false,formalProductionCutover:false},null,2));
 console.log(JSON.stringify({passed:checks.length,screens,dir}));
}finally{ws?.close();edge.kill();ssh.kill();}
