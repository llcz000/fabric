/** OUTPUT-01: real browser downloads from existing React print UI, memory fixture only. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'vite';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
const root=process.cwd(),evidenceRoot=path.join(root,'artifacts/document-preview-output');
const engine=process.argv.includes('--chromium')?'chromium':'edge';
const dir=engine==='chromium'?path.join(evidenceRoot,'chromium'):evidenceRoot;
const site=path.join(evidenceRoot,'site'),downloads=await mkdtemp(path.join(root,'tmp/document-output-downloads-'));
await mkdir(dir,{recursive:true});
if(!process.argv.includes('--built'))await build({configFile:path.join(root,'vite.config.ts'),base:'./',build:{outDir:site,emptyOutDir:true,copyPublicDir:false,rollupOptions:{input:path.join(root,'tools/ui-review/entries/product-master-v2-review.html')}}});
const reviewEntry='tools/ui-review/entries/product-master-v2-review.html';
const reviewFile=path.join(site,reviewEntry);
const reviewHtml=await readFile(reviewFile,'utf8');
const reviewStyle=reviewHtml.match(/<link rel="stylesheet"[^>]* href="([^"]+)"[^>]*>/);
assert(reviewStyle,'built review stylesheet');
const reviewCss=await readFile(path.resolve(path.dirname(reviewFile),reviewStyle[1]),'utf8');
// Keep the compiled styles available when html2canvas clones the fixture into an iframe.
const reviewPage=reviewHtml.replace(reviewStyle[0],()=>'<style>'+reviewCss+'</style>');
let base='',ws,serial=0;const pending=new Map(),checks=[],files=[],completed=new Map();
const pattern=await sharp({create:{width:64,height:40,channels:3,background:'#fa00da'}}).png().toBuffer();
const server=createServer(async(req,res)=>{try{
 const file=path.resolve(site,decodeURIComponent(new URL(req.url??'/',base).pathname).replace(/^\//,''));
 if(!file.startsWith(site+path.sep)){res.writeHead(403).end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(file===reviewFile?reviewPage:await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(path.join(root,'tmp/document-output-'+engine+'-'));
const executable=engine==='chromium'?chromium.executablePath():'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser=spawn(executable,['--headless=new','--disable-gpu','--disable-background-networking','--disable-sync','--disable-extensions','--no-first-run','--remote-debugging-port=0','--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
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

async function printPdf(name,minPages=1,maxPages=minPages,displayHeaderFooter=false){
 await send('Emulation.setEmulatedMedia',{media:''});
 const result=await send('Page.printToPDF',{preferCSSPageSize:true,displayHeaderFooter});
 const bytes=Buffer.from(result.data,'base64');
 await writeFile(path.join(dir,name+'.pdf'),bytes);
 const pdf=bytes.toString('latin1');
 const pages=[...pdf.matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/g)];
 assert(pages.length>=minPages&&pages.length<=maxPages,`${name}: unexpected PDF pages ${pages.map(page=>page.slice(1).join(' × ')).join(', ')}`);
 for(const [,width,height] of pages){
  assert(Math.abs(Number(width)-240*72/25.4)<1,`${name}: PDF width ${width}pt`);
  assert(Math.abs(Number(height)-140*72/25.4)<1,`${name}: PDF height ${height}pt`);
 }
 return pages.length;
}
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
  if(m.method==='Fetch.requestPaused')void send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:pattern.toString('base64')});
 });
 await send('Page.enable');await send('Runtime.enable');
 await send('Fetch.enable',{patterns:[{urlPattern:'https://fabric-review.invalid/pattern/*'}]});
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__errors=[];addEventListener('error',e=>window.__errors.push(e.message));addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));`});
 await send('Page.navigate',{url:base+'/'+reviewEntry+'?view=documents'});
 await until(()=>js(`Boolean(document.querySelector('select[name="type"]'))`),'query');
 for(const type of ['sample','deposit','bulk']){
  await js(`(()=>{const e=document.querySelector('select[name="type"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(type)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('查询');
  await until(()=>js(`Boolean(document.querySelector('button[aria-label="预览 / Excel"]'))`),'matching documents');
  await js(`document.querySelector('button[aria-label="预览 / Excel"]').click()`);
  await until(()=>js(`Boolean(document.querySelector('[data-v2-print-sheet]'))`),'print');
  await check(`Math.abs(document.querySelector('[data-v2-print-sheet]').getBoundingClientRect().width-240*96/25.4)<1`,type+' fixed 240mm sheet');
  if(type==='sample'){
   await check(`(()=>{
    const print=window.print;
    let calls=0;
    window.print=()=>{calls++};
    try{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='浏览器打印').click()}
    finally{window.print=print}
    return calls===1;
   })()`,'browser print button opens the native print dialog');
   await until(()=>js(`document.querySelector('[data-sample-table="preview"] img')?.naturalWidth===64`),'sample colorway image');
   await check(`(()=>{const t=document.querySelector('[data-sample-table="preview"]'),[a,b]=t.tBodies[0].rows;return t.rows[0].cells[0].textContent==='花型'&&t.rows[0].cells[1].textContent==='货号'&&a.cells[1].textContent==='P001'&&b.cells[0].textContent==='—'&&a.cells[0].offsetWidth===56&&a.cells[1].offsetWidth>a.cells[10].offsetWidth&&a.offsetHeight>=48&&[...t.tFoot.rows].every(r=>[...r.cells].reduce((s,c)=>s+c.colSpan,0)===11)})()`,'sample screen shows aligned 56px colorway column, wider product number and missing image fallback');
   await send('Emulation.setEmulatedMedia',{media:'print'});
   await check(`getComputedStyle(document.querySelector('[data-sample-table="preview"]')).display==='none'&&getComputedStyle(document.querySelector('[data-sample-table="output"]')).display==='table'&&document.querySelector('[data-sample-table="output"] th').textContent==='货号'`,'sample browser print shows the separate image-free table');
   await send('Emulation.setEmulatedMedia',{media:'screen'});
  }else await check(`!document.querySelector('[data-sample-table]')`,type+' preview has no thumbnail column');
  const expectedWidths={
   sample:[29,11,27,25,13,17,18,21,24,21],
   deposit:[37,15,48,28,33,45],
   bulk:[23,10,22,...Array(10).fill(9),10,15,16,20]
  }[type];
  await send('Emulation.setEmulatedMedia',{media:'print'});
  await check(`(()=>{
   const s=document.querySelector('[data-v2-print-sheet]'),style=getComputedStyle(s);
   const hasSize=(selector,points)=>Math.abs(parseFloat(getComputedStyle(s.querySelector(selector)).fontSize)*.75-points)<.01;
   const table=s.querySelector('table:not([data-sample-table="preview"])');
   const footer=s.querySelector('footer');
   const [issuer,receiver]=footer.children;
   const printRules=[...s.closest('section').querySelector('style').sheet.cssRules].find(rule=>rule.conditionText==='print');
   const paper=[...printRules.cssRules].find(rule=>rule.type===CSSRule.PAGE_RULE&&rule.selectorText==='v2-document');
   const terms=table.tFoot.rows[table.tFoot.rows.length-1].cells;
   return paper?.style.margin==='0px 12mm'&&style.boxDecorationBreak==='clone'&&
    Math.abs(parseFloat(style.paddingRight)-parseFloat(style.paddingLeft)-10*96/25.4)<.01&&
    Math.abs(parseFloat(style.paddingTop)-15*96/25.4)<.01&&Math.abs(parseFloat(style.paddingBottom)-6*96/25.4)<.01&&
    style.page==='v2-document'&&style.position==='static'&&
    terms.length===1&&terms[0].matches('[data-print-terms]')&&terms[0].colSpan===table.tHead.rows[0].cells.length&&
    getComputedStyle(table).tableLayout==='fixed'&&hasSize('h3',18)&&hasSize('h2',16)&&
    hasSize('table:not([data-sample-table="preview"]) th',10)&&
    hasSize('table:not([data-sample-table="preview"]) tbody td',10)&&
    hasSize('footer',11)&&issuer.textContent.includes('开单人签字')&&
    receiver.textContent.includes('收货人签字')&&receiver.textContent.includes('电话：')&&
    receiver.getBoundingClientRect().top>issuer.getBoundingClientRect().top;
  })()`,type+' print uses its paper profile, Excel fonts, a full-width terms row and separate signature lines');
  await check(`(()=>{
   const table=document.querySelector('[data-v2-print-sheet] table:not([data-sample-table="preview"])');
   const cells=[...table.tHead.rows[0].cells],expected=${JSON.stringify(expectedWidths)};
   const fractions=()=>cells.map(cell=>206*cell.getBoundingClientRect().width/(cells.at(-1).getBoundingClientRect().right-cells[0].getBoundingClientRect().left));
   const before=fractions(),long=table.tBodies[0].rows[0].cells[0],value=long.textContent;
   long.textContent='LONG-UNBROKEN-CODE-1234567890123456789012345';
   const after=fractions();
   long.textContent=value;
   return before.length===expected.length&&before.every((width,i)=>Math.abs(width-expected[i])<.1&&Math.abs(width-after[i])<.01);
  })()`,type+' prints the fixed column widths regardless of cell content');
  await printPdf(type+'-print');
  checks.push(type+' browser-generated PDF is one 240 × 140 mm page');

  await check(`document.querySelector('[data-v2-print-sheet] img[alt="公司Logo"]')&&document.querySelectorAll('[data-v2-print-sheet] figure').length===${type==='bulk'?0:2}`,type+' preview shows its applicable company images');
  const json=JSON.parse((await download('下载打印 JSON')).toString('utf8'));
  const displayed=await js(`(()=>{const s=document.querySelector('[data-v2-print-sheet]'),t=s.querySelector('table:not([data-sample-table="preview"])');return {title:s.querySelector('h2').textContent,companyName:s.querySelector('h3').textContent,headers:[...t.querySelectorAll('th')].map(e=>e.textContent),rows:[...t.querySelectorAll('tbody tr')].map(tr=>[...tr.querySelectorAll('td')].map(e=>e.textContent)),text:s.textContent};})()`);
  assert.equal(json.title,displayed.title);assert.equal(json.companyName,displayed.companyName);
  assert.deepEqual(json.columns.map(c=>c.label),displayed.headers);assert.deepEqual(json.rows,displayed.rows);
  for(const summary of json.summaries){assert(displayed.text.includes(summary.left));if(summary.right)assert(displayed.text.includes(summary.right));}
  for(const value of [json.docNo,json.dateText,json.customerName,...json.companyLines,json.terms,...Object.values(json.signature)]){
   if(value)assert(displayed.text.includes(value),'print metadata present: '+value);
  }
  checks.push(type+' JSON document identity, current company lines, terms and signature match preview');
  assert(!('ownerId' in json));assert(!('displaySnapshot' in json));assert(!('patternThumbnailAssetIds' in json));checks.push(type+' downloaded JSON matches all print rows/summaries');
  const size=await js(`(()=>{const r=document.querySelector('[data-v2-print-sheet]').getBoundingClientRect();return {width:r.width,height:r.height};})()`);
  const png=await download('下载 PNG'),metadata=await sharp(png).metadata();
  assert.equal(metadata.format,'png');
  assert(Math.abs(metadata.width-size.width*2)<3,`${type} PNG width ${metadata.width} vs sheet ${size.width*2}`);
  assert(Math.abs(metadata.height-size.height*2)<3,`${type} PNG height ${metadata.height} vs sheet ${size.height*2}`);
  if(type==='sample'){
   const pixels=await sharp(png).removeAlpha().raw().toBuffer();
   assert(!pixels.some((red,i)=>i%3===0&&red>240&&pixels[i+1]<20&&pixels[i+2]>200),'sample PNG excludes the preview colorway pixels');
   checks.push('actual sample PNG excludes the preview colorway');
  }
  const stats=await sharp(png).stats();assert(stats.channels.some(c=>c.stdev>10),'PNG includes ink');checks.push(type+' actual PNG matches paper dimensions at scale 2 and contains visible content');
  await snap(type+'-preview');
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:844,deviceScaleFactor:1,mobile:false});
  await check(`document.documentElement.scrollWidth<=innerWidth`,type+' narrow preview keeps horizontal scrolling inside the sheet');
  const narrow=await download('下载 PNG'),narrowMeta=await sharp(narrow).metadata();
  assert.equal(narrowMeta.width,metadata.width);assert.equal(narrowMeta.height,metadata.height);
  assert.deepEqual(await sharp(narrow).raw().toBuffer(),await sharp(png).raw().toBuffer());
  checks.push(type+' narrow viewport exports identical complete paper pixels');await snap(type+'-narrow');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  if(type==='sample'){
   await js(`document.querySelector('[data-sample-table="preview"] img').dispatchEvent(new Event('error'))`);
   await until(()=>js(`document.querySelector('[data-sample-table="preview"] tbody td')?.textContent==='—'`),'failed thumbnail falls back');
   checks.push('sample image failure keeps the row and replaces only the thumbnail');
  }
  if(type==='deposit'){
   assert(displayed.text.includes('25%  ¥150.00'));assert(!/应收|应付/.test(displayed.text));checks.push('deposit JSON/preview uses rounded monetary deposit without receivable');
   // The review fixture intentionally has no XLSX endpoint: test the real error UI without claiming successful server export.
   await click('下载打印Excel');await until(()=>js(`document.querySelector('[role="alert"]')?.textContent.includes('没有导出权限')`),'explicit Excel failure');
   await check(`[...document.querySelectorAll('button')].filter(b=>['下载 PNG','下载打印 JSON','下载打印Excel'].includes(b.textContent.trim())).every(b=>!b.disabled)`,'export failure restores actions');
   await download('下载打印 JSON');await check(`!document.querySelector('[role="alert"]')`,'retrying local JSON clears prior export failure');
  }

  if(type==='sample'){
   await js(`(()=>{
    const sheet=document.querySelector('[data-v2-print-sheet]');
    const table=sheet.querySelector('[data-sample-table="output"]');
    const [a,b]=table.tBodies[0].rows;
    const rows=[['C26315-1-10102','1','10MM真丝乔其','100%桑蚕丝','10 mm','137','3.00','¥95.00','¥285.00',''],
     ['C26315-1-12102','1','真丝双绉','100%桑蚕丝','14 mm','137','1.80','¥110.00','¥198.00','']];
    [a,b].forEach((row,i)=>[...row.cells].forEach((cell,j)=>{cell.textContent=rows[i][j]}));
    table.querySelector('[data-print-terms]').textContent='备注条款：货物出门，如有质量问题，应在七天内向我公司书面通知，一经深加工或裁剪，我公司概不负责。 如客户欠款，此单作为欠款凭证。';
   })()`);
   await printPdf('sample-detailed-print',1,1,true);
   checks.push('narrow detailed sample keeps long product codes, amounts, terms and QR codes on one page');
  }
  if(type==='bulk'){
   await js(`(()=>{
    const sheet=document.querySelector('[data-v2-print-sheet]');
    sheet.querySelector('h3').textContent='杭州某某纺织服饰有限公司';
    sheet.querySelector('header p').textContent='地址：杭州市某某区北干街道兴五路68号产业园3幢1302-2室';
    sheet.querySelectorAll('header p')[1].textContent='电话：00000000000';
    sheet.querySelector('[data-print-terms]').textContent='备注条款：货物出门，如有质量问题，应在七天内向我公司书面通知，一经深加工或裁剪，我公司概不负责。 如客户欠款，此单作为欠款凭证。';
    const [a,b]=sheet.querySelector('tbody').rows;
    a.cells[0].textContent='C001-1-TT7550';a.cells[2].textContent='涤纶斜纹绸';
    b.cells[0].textContent='C002-1-15687';b.cells[2].textContent='12MM真丝斜纹绸';
   })()`);
   await printPdf('bulk-detailed-default');
   await printPdf('bulk-detailed-browser-headers',1,1,true);
   // Keep the 240 × 140 mm paper but model a driver with a smaller usable area.
   await js(`(()=>{
    const style=document.createElement('style');
    style.id='print-driver-inset';
    style.textContent='@media print{@page v2-document {margin-bottom:7mm}}';
    document.body.append(style);
   })()`);
   try{await printPdf('bulk-detailed-reduced-area')}
   finally{await js(`document.getElementById('print-driver-inset').remove()`)}
   checks.push('two detailed sales rows, long terms and both signature lines fit on one sheet with a reduced printable area');
   await js(`(()=>{
    const tbody=document.querySelector('[data-v2-print-sheet] tbody'),rows=[...tbody.rows];
    for(let i=0;i<36;i++){
     const row=rows[i%rows.length].cloneNode(true);
     if(i===35)row.cells[0].textContent='LAST-PRINT-ROW';
     tbody.append(row);
    }
   })()`);
   const pageCount=await printPdf('bulk-multipage-print',2,5);
   await printPdf('bulk-multipage-browser-headers',pageCount,pageCount,true);
   checks.push('long sales document flows across custom-sized pages');
  }
  await click('返回查询');
 }
 await check(`window.__errors.length===0`,'no browser runtime errors');
 const report={passed:checks.length,checks,errors:[],files,scope:'Current React print view, production CSS and '+engine+' PDF from memory fixtures; no production DB, COS or physical printer.',userUIAccepted:false};
 await writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
