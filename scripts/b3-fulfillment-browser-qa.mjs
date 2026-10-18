/** Real candidate React + SSH-forwarded HTTP + restored MySQL, no mock injection. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,readdir,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
const config=JSON.parse(await readFile(process.env.FABRIC_SSH_LOCAL_CONFIG,'utf8'));
const credentials=JSON.parse(await readFile(process.env.FABRIC_QA_ADMIN_FILE,'utf8'));
const dir=path.resolve('artifacts/product-master-ui/qa/b3-fulfillment');await mkdir(dir,{recursive:true});
const downloads=await mkdtemp(path.resolve('tmp/b3-downloads-'));
const listener=createServer();await new Promise(r=>listener.listen(Number(process.env.FABRIC_QA_LOCAL_PORT??0),'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const ssh=spawn('ssh',['-N','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-p',String(config.ssh.port),'-L',`127.0.0.1:${port}:127.0.0.1:3004`,config.ssh.username+'@'+config.ssh.host],{stdio:'ignore',windowsHide:true});
const base=`http://127.0.0.1:${port}`,profile=await mkdtemp(path.resolve('tmp/b3-edge-'));
const edge=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
let ws,serial=0,acceptDialog=false;const pending=new Map(),checks=[],screens=[],runtimeEvents=[],networkFailures=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const now=Date.now();while(Date.now()-now<25000){if(await fn())return;await sleep(80);}throw Error('Timeout '+label);}
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});ws.send(JSON.stringify({id,method,params}));});}
async function js(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Browser evaluation failed');return r.result.value;}
async function click(label,selector='button'){await js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing action');b.click();})()`);}
async function fill(selector,value){await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function check(expression,label){assert(await js(expression),label);checks.push(label);}
async function snap(name){const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(dir,name+'.png'),Buffer.from(r.data,'base64'));screens.push(name+'.png');}
let sessionId,stage='login',heldCreate=null;
async function input(label,value){await js(`(()=>{const label=[...document.querySelectorAll('main label')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}));const e=label?.querySelector('input,textarea,select');if(!e)throw Error('Missing labelled field');const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function privateJson(endpoint,method='GET',body){return js(`(async()=>{const response=await fetch(${JSON.stringify(endpoint)},{method:${JSON.stringify(method)},headers:{Authorization:'Bearer '+sessionStorage.getItem('fabric-v2-session'),'Content-Type':'application/json'},body:${body===undefined?'undefined':JSON.stringify(JSON.stringify(body))}});if(!response.ok)throw Error('Private request failed '+response.status);return response.json();})()`);}
async function grant(enabled){
 assert(/^[1-9]\d*$/.test(sessionId));const {spawnSync}=await import('node:child_process');
 const code=`import subprocess\nidentity=subprocess.check_output(['mysql','--batch','--skip-column-names','-e','SELECT @@server_uuid'],text=True).strip()\nassert identity=='a937ff09-72b6-11f1-b04e-52540034488b'\nquery=${JSON.stringify(enabled?`INSERT INTO customer_sample_session_access (session_id,user_id,can_manage) SELECT id,created_by_user_id,1 FROM customer_sample_sessions WHERE id=${sessionId} ON DUPLICATE KEY UPDATE can_manage=1`:`DELETE FROM customer_sample_session_access WHERE session_id=${sessionId}`)}\nsubprocess.run(['mysql','fabric_v2_test_b3_20261017','-e',query],check=True,capture_output=True)\n`;
 const r=spawnSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-p',String(config.ssh.port),config.ssh.username+'@'+config.ssh.host,'python3 -'],{input:code,encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(r.status,0,'isolated QA grant toggle');
}
try{
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}},'B3 SSH health');
 let debug;await until(async()=>{try{debug=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);return debug>0;}catch{return false;}},'Edge');
 const target=(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(m.method==='Fetch.requestPaused'){heldCreate=m.params.requestId;}if(m.method==='Page.javascriptDialogOpening'){runtimeEvents.push(m.params.type);void send('Page.handleJavaScriptDialog',{accept:acceptDialog});}if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1400,height:1100,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base});await until(()=>js(`Boolean(document.querySelector('form[aria-label="账号登录"]'))`),'login');await fill('input[name="username"]',credentials.username);await fill('input[name="password"]',credentials.password);await click('登录');await until(()=>js(`Boolean(document.querySelector('nav[aria-label="主导航"]'))`),'navigation');
 await click('客户选样','nav[aria-label="主导航"] button');await until(()=>js(`Boolean(document.querySelector('input[aria-label="搜索客户"]'))&&!document.body.textContent.includes('正在读取选样单')`),'directory loaded');await click('新建选样单');
 const customer='浏览器选样QA'+Date.now();await input('客户名称',customer);await click('创建选样单');await until(()=>js(`Boolean(document.querySelector('section[aria-label="客户选样明细"]'))`),'new selection');await until(()=>js(`document.body.textContent.includes('暂无已选产品')`),'empty selection');checks.push('real browser creates its own customer selection and explicit grant');
 const directory=await privateJson('/api/v2/customer-samples/sessions?query='+encodeURIComponent(customer));sessionId=directory.items[0].id;
 stage='manual';await click('人工补选');await fill('input[placeholder="色卡编号、花型编号、面料品号或品名"]','B3');await until(()=>js(`Boolean(document.querySelector('button[aria-label^="加入色卡 B3"]'))`),'card search');
 await js(`document.querySelector('button[aria-label^="加入色卡 B3"]').click()`);await until(()=>js(`document.body.textContent.includes('已选产品 2 款')`),'two selected products');checks.push('existing card-based manual selection adds current two products without a separate product picker');
 await click('关闭补选','dialog button');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 stage='photo scan';
 const cards=await privateJson('/api/v2/sample-cards?query=B3&limit=20'),physical=cards.items.find(c=>c.cardNo.startsWith('B3'));assert(physical?.qrPayload);
 const photo=path.join(downloads,'physical-card.png');await QRCode.toFile(photo,physical.qrPayload,{width:640,margin:4});
 const beforePhoto=await privateJson('/api/v2/customer-samples/sessions/'+sessionId+'?limit=20');
 await until(()=>js(`Boolean(document.querySelector('input[aria-label="拍照或选图识别色卡"]'))`),'photo entry');
 const doc=await send('DOM.getDocument'),fileNode=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[aria-label="拍照或选图识别色卡"]'});
 await input('扫描或输入色卡编码',physical.qrPayload);heldCreate=null;await send('Fetch.enable',{patterns:[{urlPattern:'*cardPhotoScan-*.js',requestStage:'Request'}]});
 try{
  await send('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[photo]});await until(()=>Boolean(heldCreate),'photo decoder delayed');
  await check(`(()=>{const f=document.querySelector('form[aria-label="扫码加入选样"]');return f.querySelector('input:not([type="file"])').disabled&&[...f.querySelectorAll('input[type="file"]')].every(input=>input.disabled)&&![...f.querySelectorAll('button')].some(button=>!button.disabled);})()`,'pending photo decode blocks conflicting HID/manual input and submission');
 }finally{if(heldCreate)await send('Fetch.continueRequest',{requestId:heldCreate});await send('Fetch.disable');heldCreate=null;}
 await until(()=>js(`document.body.textContent.includes('已识别色卡，请确认加入')`),'real QR photo decode');
 assert.deepEqual(await privateJson('/api/v2/customer-samples/sessions/'+sessionId+'?limit=20'),beforePhoto);checks.push('real card PNG decodes locally without submitting or changing selection');
 await click('确认加入');await until(()=>js(`document.body.textContent.includes('重复产品保持原选择')`),'explicit photo scan submit');await check(`document.body.textContent.includes('已选产品 2 款')`,'explicit photo scan uses existing authenticated deduplicating card endpoint');
 const blank=path.join(downloads,'blank.png');await sharp({create:{width:200,height:200,channels:3,background:'#fff'}}).png().toFile(blank);await send('DOM.setFileInputFiles',{nodeId:fileNode.nodeId,files:[blank]});await until(()=>js(`document.body.textContent.includes('未识别到二维码')`),'blank photo error');await check(`!document.querySelector('input[aria-label="拍照或选图识别色卡"]').disabled`,'unreadable photo gives retryable feedback');
 if(await js(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='关闭补选'))`))await click('关闭补选');await snap('selection');
 stage='shipment';await click('寄样记录');await until(()=>js(`Boolean(document.querySelector('input[aria-label^="寄样数量"]'))`),'shipment form');await fill('input[aria-label^="寄样数量"]','1.5');await click('保存寄样批次');await until(()=>js(`document.body.textContent.includes('正整数')`),'invalid quantity rejection');await check(`document.querySelector('input[aria-label^="寄样数量"]').value==='1.5'`,'invalid shipment input is retained without an API write');
 await fill('input[aria-label^="寄样数量"]','3');await input('物流公司','顺丰');await input('快递单号','BROWSER-B3');
 await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='保存寄样批次');b.click();b.click();})()`);
 await until(()=>js(`document.body.textContent.includes('寄样批次已保存')&&document.body.textContent.includes('待寄 1 款')`),'persisted shipment');const shipments=await privateJson('/api/v2/customer-samples/sessions/'+sessionId+'/shipments');assert.equal(shipments.total,1);checks.push('double-click creates one actual batch; pending/actual quantity and history refresh correctly');await snap('shipment');
 stage='followup';await click('客户跟进');await until(()=>js(`Boolean(document.querySelector('form[aria-label="登记跟进"]'))`),'follow form');await input('联系日期','2026-10-17');await input('客户确认','no');await input('反馈','颜色合适，等待版型确认');await input('跟进结果','已联系客户');await input('下次跟进日期','2026-10-18');await js(`document.querySelector('input[aria-label^="关联 "]').click()`);await click('保存跟进记录');
 await until(()=>js(`document.body.textContent.includes('跟进记录已保存')&&document.body.textContent.includes('下次跟进：2026-10-18')`),'followup persisted');const followups=await privateJson('/api/v2/customer-samples/sessions/'+sessionId+'/followups');assert.equal(followups.items[0].customerConfirmed,false);assert.equal(followups.items[0].productIds.length,1);checks.push('follow-up real form persists feedback, false confirmation, next date and optional product link');await snap('followup');
 stage='draft';await input('跟进结果','未保存草稿');acceptDialog=false;await click('寄样记录');await until(()=>js(`Boolean(document.querySelector('form[aria-label="登记跟进"]'))`),'unsaved cancel');await check(`document.querySelector('form[aria-label="登记跟进"]').textContent.includes('跟进结果')`,'cancelling navigation retains an unsaved follow-up');acceptDialog=true;await click('寄样记录');await until(()=>js(`Boolean(document.querySelector('form[aria-label="登记寄样"]'))`),'discard accepted');checks.push('explicit unsaved navigation confirmation protects follow-up draft');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await snap('narrow-shipment');await check(`document.querySelector('section[aria-label="寄样管理"]').getBoundingClientRect().width<=390`,'shipment workspace container stays within narrow screen');
 stage='revocation';await grant(false);await click('客户跟进');await until(()=>js(`document.body.textContent.includes('访问权限已失效，请返回列表')`),'revoked grant');await check(`!document.body.textContent.includes(${JSON.stringify(customer)})&&!document.querySelector('section[aria-label="客户选样明细"]')&&!document.querySelector('form[aria-label="登记跟进"]')`,'real SQL grant revocation clears customer header, selection and follow-up data');await snap('revoked');
 await grant(true);await click('返回客户选样');await until(()=>js(`Boolean(document.querySelector('input[aria-label="搜索客户"]'))`),'back');await fill('input[aria-label="搜索客户"]',customer);await click('查询');await until(()=>js(`Boolean(document.querySelector('tbody button'))`),'filtered customer');await click('查看选样');await click('寄样记录');await until(()=>js(`document.body.textContent.includes('BROWSER-B3')`),'history reread');checks.push('return/search/reopen rereads persisted shipment history after grant restoration');
 const failures=[];async function probe(name,run){try{await run();checks.push(name);}catch(error){failures.push({name,error:String(error.message)});}}
 stage='review regressions';
 await probe('main navigation cancellation retains an unsaved customer follow-up',async()=>{
  await click('客户跟进');await until(()=>js(`Boolean(document.querySelector('form[aria-label="登记跟进"]'))`),'followup draft');await input('跟进结果','主导航保护草稿');acceptDialog=false;const previous=runtimeEvents.length;await click('花型库','nav[aria-label="主导航"] button');await sleep(150);
  assert(await js(`Boolean(document.querySelector('form[aria-label="登记跟进"]'))`),'main navigation discarded the draft');assert(runtimeEvents.length>previous,'no draft confirmation was shown');
 });
 acceptDialog=true;await click('客户选样','nav[aria-label="主导航"] button');
 if(await js(`Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='返回客户选样'))`))await click('返回客户选样');
 await until(()=>js(`Boolean(document.querySelector('tbody button'))`),'existing sessions');
 await probe('pending create blocks conflicting existing-session navigation and recovers normal controls',async()=>{
  await click('新建选样单');await input('客户名称','延迟新建QA'+Date.now());heldCreate=null;await send('Fetch.enable',{patterns:[{urlPattern:'*/api/v2/customer-samples/sessions',requestStage:'Response'}]});
  try{await click('新建选样单');await until(()=>Boolean(heldCreate),'create committed/delayed response');assert(await js(`document.querySelector('tbody button').disabled`),'existing-session navigation remained enabled during create');}
  finally{if(heldCreate)await send('Fetch.continueRequest',{requestId:heldCreate});await send('Fetch.disable');heldCreate=null;}
 });
 await until(()=>js(`Boolean(document.querySelector('section[aria-label="客户选样业务"]'))`),'create completes');await click('返回客户选样');await until(()=>js(`Boolean(document.querySelector('tbody button'))`),'directory');
 await probe('one actual shipment and one follow-up can include products across selection pages',async()=>{
  const stamp='REG'+Date.now();const master=await privateJson('/api/v2/pattern-masters','POST',{masterNo:stamp}),fabric=await privateJson('/api/v2/fabrics','POST',{fabricNo:stamp,fabricName:'跨页寄样验收'});
  for(let i=0;i<21;i++){const color=await privateJson('/api/v2/pattern-masters/'+master.id+'/colorways','POST',{});await privateJson('/api/v2/products','POST',{patternColorwayId:color.id,fabricId:fabric.id});}
  const {card}=await privateJson('/api/v2/sample-cards','POST',{masterId:master.id,fabricId:fabric.id});const cross=await privateJson('/api/v2/customer-samples/sessions','POST',{customerReference:stamp});await privateJson('/api/v2/customer-samples/sessions/'+cross.id+'/items/manual','POST',{cardId:card.id});
  await fill('input[aria-label="搜索客户"]',stamp);await click('查询');await until(()=>js(`document.querySelector('tbody')?.textContent.includes(${JSON.stringify(stamp)})`),'cross-page session');await click('查看选样');await click('寄样记录');await until(()=>js(`Boolean(document.querySelector('input[aria-label^="寄样数量"]'))`),'cross-page form');await fill('input[aria-label^="寄样数量"]','2');
  assert(await js(`![...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='下一页产品').disabled`),'product paging blocked after first quantity');await click('下一页产品');await until(()=>js(`document.querySelectorAll('input[aria-label^="寄样数量"]').length===1`),'last product');await fill('input[aria-label^="寄样数量"]','3');await click('保存寄样批次');await until(()=>js(`document.body.textContent.includes('寄样批次已保存')`),'cross-page batch saved');const history=await privateJson('/api/v2/customer-samples/sessions/'+cross.id+'/shipments');assert.equal(history.total,1);assert.equal(history.items[0].items.length,2);
  await click('客户跟进');await until(()=>js(`Boolean(document.querySelector('input[aria-label^="关联 "]'))`),'cross-page follow');await input('跟进结果','跨页产品反馈');await js(`document.querySelector('input[aria-label^="关联 "]').click()`);await click('下一页产品');await until(()=>js(`document.querySelectorAll('input[aria-label^="关联 "]').length===1`),'last follow product');await js(`document.querySelector('input[aria-label^="关联 "]').click()`);await click('保存跟进记录');await until(()=>js(`document.body.textContent.includes('跟进记录已保存')`),'cross-page follow saved');const follow=await privateJson('/api/v2/customer-samples/sessions/'+cross.id+'/followups');assert.equal(follow.items[0].productIds.length,2);
 });
 await writeFile(path.join(dir,'review-regressions.json'),JSON.stringify({passed:checks.length,checks,failures,screens,sessionId,realMySQL:true,productionChanged:false,humanUIAccepted:false},null,2));assert.equal(failures.length,0,JSON.stringify(failures));console.log(JSON.stringify({passed:checks.length,checks,screens,sessionId,productionChanged:false}));
}catch(error){console.error(JSON.stringify({stage,passed:checks.length,error:error instanceof Error?error.message:'failed'}));process.exitCode=1;}
finally{if(sessionId){try{await grant(true);}catch{}}if(ws)ws.close();edge.kill();ssh.kill();}
