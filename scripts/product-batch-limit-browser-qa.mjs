/** Isolated real-component regression. All API responses are synthetic; no business server is started. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright';
const out=path.resolve('artifacts/product-batch-limit-20261023');
await fs.mkdir(out,{recursive:true});
const entry=path.join(out,'review.html');
await fs.writeFile(entry,'<html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./review.tsx"></script></html>');
await fs.writeFile(path.join(out,'review.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProductBatchCreateV2} from '../../src/components/product-master-v2/ProductBatchCreateV2';
import {ConfirmProvider} from '../../src/components/ui/ConfirmDialog';
import '../../src/index.css';import '../../src/components/product-master-v2/v2Experience.css';
const versions=Array.from({length:25},(_,i)=>({id:String(i+1),masterId:'1',colorwayNo:i+1,patternNo:'G0008-'+(i+1),patternImageAssetId:null,remark:'',isActive:true,colorTags:[]}));
const fabric={id:'31',fabricNo:'F001',fabricName:'雪纺',composition:'100%聚酯纤维',weightValue:88,weightUnit:'gsm',widthValue:145,remark:null,isActive:true,productCount:0};
let posts=0;const api:typeof fetch=async(input,init)=>{
 const url=new URL(String(input),'https://preview.fabric.invalid');
 if(url.pathname==='/api/v2/pattern-catalog'){
  if(url.searchParams.get('number')==='error')return new Response('',{status:503});
  const q=url.searchParams.get('number');const found=versions.filter(v=>!q||v.patternNo.includes(q));
  return Response.json({items:found.length?[{id:'1',masterNo:'G0008',nextColorwayNo:26,isActive:true,topicTags:[],versions:found}]:[],total:found.length?1:0,limit:20,offset:0});
 }
 if(url.pathname==='/api/v2/fabrics/catalog')return Response.json({items:[fabric],total:1,limit:50,offset:0});
 if(url.pathname.endsWith('/preview')){const b=JSON.parse(String(init?.body));return Response.json({items:b.colorwayIds.map((id:string)=>({patternColorwayId:id,productNo:'G0008-'+id+'-F001',existing:false}))});}
 if(url.pathname==='/api/v2/products/batch'){posts++;document.documentElement.dataset.posts=String(posts);const b=JSON.parse(String(init?.body));return Response.json({created:b.colorwayIds.map((id:string)=>({patternColorwayId:id,productNo:'G0008-'+id+'-F001',id:String(100+Number(id))})),skipped:[]});}
 throw Error('Unexpected mock endpoint '+url.pathname);
};createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfirmProvider><ProductBatchCreateV2 apiFetch={api} onCancel={()=>{}} onSaved={()=>{}}/></ConfirmProvider></React.StrictMode>);
`);
await build({configFile:path.resolve('vite.config.ts'),build:{outDir:path.join(out,'site'),emptyOutDir:true,rollupOptions:{input:entry}}});
const site=path.join(out,'site');
const checks=[],errors=[];const browser=await chromium.launch({...(process.env.FABRIC_QA_BROWSER_PATH?{executablePath:process.env.FABRIC_QA_BROWSER_PATH}:{channel:'msedge'}),headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 const assets=await fs.readdir(path.join(site,'assets'));
 const js=await fs.readFile(path.join(site,'assets',assets.find(n=>n.endsWith('.js'))),'utf8');
 // Offline QA uses the stylesheet's system-font fallback; only the remote font import is omitted.
 const css=(await fs.readFile(path.join(site,'assets',assets.find(n=>n.endsWith('.css'))),'utf8')).replace(/^@import"[^"]+";/,'');
 const dialog=()=>page.getByRole('dialog',{name:'查找花型版本'});
 const open=()=>page.getByRole('button',{name:'勾选花型配色',exact:true});
 const choose=n=>dialog().getByRole('button',{name:'选择花型配色 G0008-'+n,exact:true});
 const shot=n=>page.screenshot({path:path.join(out,n+'.png'),fullPage:true});
 const pass=s=>{checks.push(s);console.log('PASS '+s);};
 // Load the built production component and CSS entirely offline; no network permission is needed.
 await page.setContent('<html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div></html>');
 await page.addStyleTag({content:css});await page.addScriptTag({type:'module',content:js});
 await open().click();await choose(1).waitFor();
 assert.equal(await page.getByRole('region',{name:'批量新增产品'}).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(250, 248, 255)');
 assert.equal(await dialog().evaluate(e=>getComputedStyle(e.parentElement).position),'fixed');
 assert(await dialog().getByRole('textbox').evaluate(e=>e===document.activeElement));
 for(let i=1;i<=20;i++)await choose(i).click();
 for(let i=21;i<=25;i++)await choose(i).click();
 await dialog().getByRole('alert').filter({hasText:'每次最多创建20个配色产品'}).waitFor();
 assert.equal(await dialog().locator('[aria-pressed=true]').count(),20);
 await shot('desktop-limit-dialog');pass('20项保留；第21～25次尝试仅在弹窗提示，不抛渲染异常');
 await choose(1).click();assert.equal(await dialog().getByRole('alert').count(),0);await choose(21).click();
 assert.equal(await choose(21).getAttribute('aria-pressed'),'true');
 await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});assert(await open().evaluate(e=>e===document.activeElement));
 await shot('desktop-selected');await open().click();await choose(21).waitFor();assert.equal(await choose(21).getAttribute('aria-pressed'),'true');
 pass('取消勾选后可补选；Esc关闭保留20项、恢复入口焦点、满额可重开');
 const search=()=>dialog().getByRole('textbox',{name:'搜索花型编号'});
 await search().fill('missing');await dialog().getByText('没有匹配项，请换关键词。').waitFor();
 await search().fill('error');await dialog().getByText('选项查询失败，请重试关键词。').waitFor();
 await search().fill('');await choose(21).waitFor();assert.equal(await dialog().locator('[aria-pressed=true]').count(),20);
 await dialog().getByRole('button',{name:'完成选择',exact:true}).click();pass('搜索空态及接口失败恢复不丢勾选；完成选择正常关闭');
 await page.setViewportSize({width:360,height:780});await open().click();await choose(1).click();await dialog().getByRole('alert').waitFor();await shot('narrow-limit-dialog');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await dialog().getByRole('button',{name:'关闭选择窗口'}).click();await shot('narrow-selected');
 pass('360px窗口提示、已选列表无页面横向溢出，关闭可操作');
 await page.getByRole('button',{name:'选择面料',exact:true}).click();
 await page.getByRole('button',{name:'选择面料 F001',exact:true}).click();
 await page.getByRole('button',{name:'确认批量创建',exact:true}).click();
 await page.getByText('批量新增完成：成功创建 20 个，跳过已存在组合 0 个。',{exact:false}).waitFor();
 assert.equal(await page.locator('html').getAttribute('data-posts'),'1');pass('上限错误恢复后20项仍可预览并一次提交成功（模拟API）');
 assert.deepEqual(errors,[]);
}catch(e){errors.push(String(e.stack??e));console.error(e);process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'browser-evidence.json'),JSON.stringify({checks,errors},null,2));await browser.close();}
