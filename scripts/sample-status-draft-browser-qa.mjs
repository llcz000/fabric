import {initializeDefaultTags,DEFAULT_TAGS} from './lib/v2-default-tags.mjs';
import {randomBytes} from 'node:crypto';
/** Real candidate UI regression. Writes only through isolated 3004 V2 APIs. */
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {readFile,readdir,mkdtemp,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import sharp from 'sharp';import ExcelJS from 'exceljs';
const config=JSON.parse(await readFile(process.env.FABRIC_SSH_LOCAL_CONFIG,'utf8')),credentials=JSON.parse(await readFile(process.env.FABRIC_QA_ADMIN_FILE,'utf8'));
const dir=path.resolve('artifacts/product-master-ui/qa/status-draft');await mkdir(dir,{recursive:true});
const downloads=await mkdtemp(path.resolve('tmp/nine-ui-downloads-')),finished=[];
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const ssh=spawn('ssh',['-N','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-p',String(config.ssh.port),'-L',`127.0.0.1:${port}:127.0.0.1:3004`,config.ssh.username+'@'+config.ssh.host],{stdio:'ignore',windowsHide:true});
const base='http://127.0.0.1:52987',profile=await mkdtemp(path.resolve('tmp/nine-ui-edge-'));
const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let acceptDialog=()=>true;const dialogs=[];let ws,serial=0,stage='login';const pending=new Map(),checks=[],screens=[],errors=[],documents=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const begin=Date.now();while(Date.now()-begin<25000){if(await fn())return;await sleep(80);}throw Error('Timeout '+label);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id,method,params}));});}
async function js(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Browser expression failed '+(r.exceptionDetails.exception?.description??r.exceptionDetails.text).split('\n')[0]);return r.result.value;}
async function click(label,selector='button'){await js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing action '+${JSON.stringify(label)});b.click();})()`);}
async function fill(selector,value){await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field '+${JSON.stringify(selector)});const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);}
async function check(expression,label){assert(await js(expression),label);checks.push(label);}
async function snap(name){const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(dir,name+'.png'),Buffer.from(r.data,'base64'));screens.push(name+'.png');}
async function api(endpoint,method='GET',body){return js(`(async()=>{const response=await fetch('/api/v2/'+${JSON.stringify(endpoint)},{method:${JSON.stringify(method)},headers:{Authorization:'Bearer '+sessionStorage.getItem('fabric-v2-session'),'Content-Type':'application/json'},body:${body===undefined?'undefined':JSON.stringify(JSON.stringify(body))}});if(!response.ok)throw Error('QA API '+response.status);return response.json();})()`);}
try{
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}},'SSH');let debug;await until(async()=>{try{debug=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return debug>0;}catch{return false;}},'Edge');
 const target=(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(m.method==='Page.javascriptDialogOpening'){dialogs.push(m.params.message);void send('Page.handleJavaScriptDialog',{accept:acceptDialog(m.params.message)});}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Browser.downloadProgress'&&m.params.state==='completed')finished.push(m.params.guid);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:base});
 await until(()=>js(`Boolean(document.querySelector('input[name="username"]'))`),'login');await fill('input[name="username"]',credentials.username);await fill('input[name="password"]',credentials.password);await click('登录');await until(()=>js(`Boolean(document.querySelector('nav[aria-label="主导航"]'))`),'app');


 stage='cancel ending retains draft guard';await click('客户选样','nav button');await until(()=>js(`Boolean(document.querySelector('form[aria-label="新建选样单"] input'))&&!document.body.textContent.includes('正在读取选样单')`),'directory');await fill('form[aria-label="新建选样单"] input','状态草稿QA'+Date.now());await click('新建选样单');await until(()=>js(`Boolean(document.querySelector('section[aria-label="客户选样明细"]'))`),'new selection');await click('客户跟进');await until(()=>js(`Boolean(document.querySelector('form[aria-label="登记跟进"] textarea[required]'))`),'followup form');
 await js(`(()=>{const e=document.querySelector('form[aria-label="登记跟进"] textarea[required]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'必须保留的未保存草稿');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 acceptDialog=message=>!message.includes('结束后');await click('结束选样单');await until(()=>dialogs.some(message=>message.includes('结束后')),'ending cancelled');
 acceptDialog=()=>false;const before=dialogs.length;await click('选样明细');await sleep(150);
 assert(dialogs.slice(before).some(message=>message.includes('未保存')),'cancel ending must retain unsaved draft guard');
 await check(`document.querySelector('form[aria-label="登记跟进"] textarea[required]').value==='必须保留的未保存草稿'`,'cancel ending retains both followup values and subsequent navigation guard');await snap('retained');
 acceptDialog=()=>true;await click('选样明细');await until(()=>js(`Boolean(document.querySelector('section[aria-label="客户选样明细"]'))`),'discard explicit');await click('结束选样单');await until(()=>js(`document.body.textContent.includes('已结束（只读）')`),'end');checks.push('explicit discard followed by end succeeds');
 const report={passed:checks.length,checks,productionChanged:false};await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({stage,passed:checks.length,error:error.message}));process.exitCode=1;}
finally{ws?.close();edge.kill();ssh.kill();}
