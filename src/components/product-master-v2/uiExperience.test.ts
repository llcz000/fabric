import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer, type ReactTestInstance} from 'react-test-renderer';
import V2App from './V2App';
import {ProductCatalogV2} from './ProductCatalogV2';
import {FabricWorkspaceV2} from './FabricImportV2';
import {V2_LOGIN_KEY} from './v2LoginStorage';
// Bundled React act uses MessageChannel; close its scheduling ports after all acts.
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{for(const channel of channels){channel.port1.close();channel.port2.close();}globalThis.MessageChannel=NativeChannel;});
const product={id:'53',productNo:'G017-2-F018',patternColorwayId:'3',fabricId:'8',masterId:'7',masterNo:'G017',colorwayNo:2,fabricNo:'F018',fabricName:'轻柔雪纺',composition:'100% 真丝',weightValue:16.5,weightUnit:'mm',widthCm:145,remark:'备注',isActive:true,isAvailableForSampling:true,masterActive:true,colorwayActive:true,fabricActive:true,isSelectable:true,rowVersion:'1',patternImageAssetId:null,topicTags:[],colorTags:[],imageCounts:{fabricDisplay:0,detail:0,aiEffect:0},totalImages:0};
const page={items:[product],total:1,limit:50,offset:0};
const stats={orderCount:0,metersTotal:0,amountTotal:0,byType:{sample:{count:0,meters:0,amount:0},bulk:{count:0,meters:0,amount:0},deposit:{count:0,meters:0,contractAmount:0}},topProducts:[],recentOrders:[]};
const text=(node:ReactTestInstance):string=>node.children.map(c=>typeof c==='string'?c:text(c)).join('');
const button=(r:ReactTestRenderer,label:string)=>r.root.findAllByType('button').find(b=>text(b)===label||b.props['aria-label']===label)!;
const tick=async(ms=0)=>{await act(async()=>{await new Promise(r=>setTimeout(r,ms));});};
function environment(hash=''){
 const old=new Map<string,PropertyDescriptor|undefined>();
 const set=(name:string,value:unknown)=>{old.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
 const storage=new Map([[V2_LOGIN_KEY,JSON.stringify({token:'a'.repeat(64),expiresAt:Date.now()+60000})]]);
 const store={getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)};
 const events=new EventTarget();let questions=0,index=0;
 const entries=[{url:'http://localhost/'+hash,state:null as any}];
 const location={get href(){return entries[index].url;},get hash(){return new URL(entries[index].url).hash;}};
 const history={get state(){return entries[index].state;},replaceState(state:any,_title:string,url?:string){entries[index]={state,url:url?new URL(url,location.href).href:location.href};},pushState(state:any,_title:string,url?:string){const next={state,url:url?new URL(url,location.href).href:location.href};entries.splice(++index);entries.push(next);},go(delta:number){const next=index+delta;if(next<0||next>=entries.length)return;index=next;const event=new Event('popstate');Object.assign(event,{state:history.state});events.dispatchEvent(event);},back(){history.go(-1);}};
 const documentEvents=new EventTarget();
 const documentStub={querySelector:():any=>null,querySelectorAll:()=>[],addEventListener:documentEvents.addEventListener.bind(documentEvents),removeEventListener:documentEvents.removeEventListener.bind(documentEvents),dispatchEvent:documentEvents.dispatchEvent.bind(documentEvents),activeElement:null,body:{style:{overflow:''}}};
 const host={history,location,document:documentStub,confirm:()=>{questions++;return true;},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
 const requests:{url:string;method:string}[]=[];let pendingDelete:((value:Response)=>void)|null=null;
 const transport=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),method=init?.method??'GET';requests.push({url,method});
  if(method==='DELETE')return new Promise<Response>(resolve=>{pendingDelete=resolve;});
  const payload=url==='/api/v2/access/login'?{token:'b'.repeat(64),expiresIn:3600}:url==='/api/v2/access/me'?{id:'1',username:'demo',displayName:'演示账号',role:'admin'}:url==='/api/company'?{company_name:'演示公司',images:{}}:url==='/api/v2/pattern-sharing'?{enabled:false}:url.includes('/fabrics/catalog?')?{items:[],total:0,limit:50,offset:0}:url.includes('/products?')?page:url.includes('/stats')?stats:url.includes('/reserve-number')?{orderNo:'DEMO-001'}:url.includes('/customers?')?{items:[]}:{};
  return Response.json(payload);
 };
 set('window',host);set('document',documentStub);set('HTMLElement',class {});set('HTMLDialogElement',class {});set('KeyboardEvent',class extends Event{key:string;constructor(type:string,init:any){super(type,init);this.key=init.key;}});set('localStorage',store);set('sessionStorage',store);set('fetch',transport);set('IS_REACT_ACT_ENVIRONMENT',true);
 return {requests,host,get questions(){return questions;},resolveDelete(status=200){pendingDelete?.(new Response('{}',{status}));},cleanup(){for(const [k,v] of old){if(v)Object.defineProperty(globalThis,k,v);else Reflect.deleteProperty(globalThis,k);}}};
}
async function app(env:ReturnType<typeof environment>){let r!:ReactTestRenderer;await act(async()=>{r=create(React.createElement(V2App));});await tick(30);return r;}
test('fabric import shares the page toolbar and cannot discard an inline draft',async()=>{
 const env=environment();let r!:ReactTestRenderer;
 try{
  await act(async()=>{r=create(React.createElement(FabricWorkspaceV2,{apiFetch:fetch,canManage:true}));});await tick(30);
  const toolbar=r.root.findAllByType('header').find(h=>text(h).includes('新增面料'))!;
  assert(text(toolbar).includes('从Excel导入'),'import belongs in the title toolbar');
  assert(text(toolbar).includes('导出筛选结果'),'export belongs in the same toolbar');
  await act(async()=>button(r,'新增面料').props.onClick());
  assert.equal(button(r,'从Excel导入').props.disabled,true,'inline draft must not be unmounted by import');
  await act(async()=>button(r,'取消').props.onClick());
  await act(async()=>button(r,'从Excel导入').props.onClick());
  assert.equal(r.root.findAllByType('input').some(n=>n.props['aria-label']==='选择XLSX文件'),true);
  await act(async()=>r.unmount());
  await act(async()=>{r=create(React.createElement(FabricWorkspaceV2,{apiFetch:fetch,canManage:false,allowExport:false}));});await tick(30);
  assert.equal(button(r,'从Excel导入'),undefined,'read-only actor cannot import');
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
test('UI-01 changed document draft is retained when navigation is cancelled; discard navigates',async()=>{
 const env=environment();let r!:ReactTestRenderer;
 try{r=await app(env);await act(async()=>button(r,'新增单据').props.onClick());await tick();
  const input=r.root.findAllByType('input').find(n=>n.props.name==='docNo')!;
  await act(async()=>input.props.onChange({target:{value:'尚未保存的客户'}}));
  await act(async()=>button(r,'产品库').props.onClick());
  assert.equal(r.root.findAll(n=>n.props.role==='alertdialog').length,1,'navigation must ask before unmounting draft');
  await act(async()=>button(r,'继续编辑').props.onClick());
  assert.equal(r.root.findAllByType('input').find(n=>n.props.name==='docNo')!.props.value,'尚未保存的客户');
  await act(async()=>button(r,'产品库').props.onClick());await act(async()=>button(r,'放弃修改').props.onClick());await tick(30);
  assert.equal(r.root.findAll(n=>n.props['aria-label']==='V2 产品库').length,1);
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
test('review: after logout and login a previously visited module remains navigable',async()=>{
 const env=environment('#/fabric');let r!:ReactTestRenderer;
 try{r=await app(env);await act(async()=>button(r,'退出登录').props.onClick());await tick();
  const inputs=r.root.findAllByType('input');for(const input of inputs)await act(async()=>input.props.onChange({target:{value:'demo'}}));
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));await tick(30);
  await act(async()=>button(r,'面料库').props.onClick());await tick(250);
  assert.equal(r.root.findAll(n=>n.props['aria-label']==='V2 面料库').length,1);
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
test('review: internal browser back dismisses a modal before leaving its module',async()=>{
 const env=environment();let r!:ReactTestRenderer;
 try{r=await app(env);await act(async()=>button(r,'产品库').props.onClick());await tick(30);
  await act(async()=>button(r,'查看产品图 G017-2-F018').props.onClick());await tick();
  env.host.document.querySelector=()=>({dispatchEvent:(event:Event)=>env.host.document.dispatchEvent(event)});
  await act(async()=>env.host.history.back());
  assert.equal(r.root.findAll(n=>n.props['aria-label']==='V2 产品库').length,1,'back must preserve current module while closing modal');
  assert.equal(r.root.findAll(n=>n.props.role==='dialog').length,0);
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
test('UI-03 product route and filters restore on reload; internal browser back changes module',async()=>{
 const env=environment('#/products?productNo=G017&fabricName=%E9%9B%AA%E7%BA%BA&offset=50');let r!:ReactTestRenderer;
 try{r=await app(env);await tick(260);
  assert.equal(r.root.findAllByType('input').find(n=>n.props['aria-label']==='货号')?.props.value,'G017');
  assert(env.requests.some(x=>x.url.includes('productNo=G017')&&x.url.includes('fabricName=')&&x.url.includes('offset=50')));
  await act(async()=>button(r,'经营大盘').props.onClick());assert.equal(env.host.location.hash,'#/stats');
  await act(async()=>env.host.history.back());await tick(260);
  assert.equal(r.root.findAllByType('input').find(n=>n.props['aria-label']==='货号')?.props.value,'G017');
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
test('UI-06 product search retains table while old rows cannot be acted on',async()=>{
 const env=environment();let r!:ReactTestRenderer;
 try{await act(async()=>{r=create(React.createElement(ProductCatalogV2,{apiFetch:fetch,canManage:true,onEdit(){}}));});await tick(30);
  assert.equal(r.root.findAllByType('table').length,1);
  await act(async()=>r.root.findAllByType('input').find(n=>n.props['aria-label']==='货号')!.props.onChange({target:{value:'G018'}}));
  assert.equal(r.root.findAllByType('table').length,1,'table geometry must not disappear during debounce');
  assert.equal(button(r,'编辑').props.disabled,true,'stale row cannot be edited');
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
test('UI-07 one deletion confirmation stays open during request and preserves failure for retry',async()=>{
 const env=environment('#/products');let r!:ReactTestRenderer;
 try{r=await app(env);await act(async()=>button(r,'产品库').props.onClick());await tick(30);await act(async()=>button(r,'删除').props.onClick());
  await act(async()=>button(r,'确认删除').props.onClick());
  assert.equal(env.questions,0,'no second browser confirmation');
  assert.equal(r.root.findAll(n=>n.props.role==='alertdialog').length,1,'keep confirmation during write');
  assert.equal(button(r,'正在删除…').props.disabled,true);
  await act(async()=>button(r,'经营大盘').props.onClick());
  assert(text(r.root).includes('正在保存或上传'));
  assert.equal(r.root.findAll(n=>n.props['aria-label']==='V2 产品库').length,1);
  await act(async()=>env.resolveDelete(409));await tick();
  assert(text(r.root).includes('产品已被引用'));assert.equal(button(r,'确认删除').props.disabled,false);
  assert.equal(env.requests.filter(x=>x.method==='DELETE').length,1);
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
test('UI-03 reloading a later history entry keeps browser-back ordering',async()=>{
 const env=environment();let r!:ReactTestRenderer;
 try{r=await app(env);await act(async()=>button(r,'产品库').props.onClick());await tick(30);
  await act(async()=>button(r,'经营大盘').props.onClick());
  await act(async()=>r.unmount());r=await app(env);
  assert.equal(env.host.history.state.__fabricV2RouteIndex,2,'reload must not renumber the current history entry');
  await act(async()=>env.host.history.back());await tick(30);
  assert.equal(r.root.findAll(n=>n.props['aria-label']==='V2 产品库').length,1);
  await act(async()=>button(r,'新增单据').props.onClick());await tick();
  assert.equal(env.host.history.state.__fabricV2RouteIndex,2,'reload must retain the current history index');
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
test('UI-01 opening settings and changing text registers the same leave protection',async()=>{
 const env=environment('#/settings');let r!:ReactTestRenderer;
 try{r=await app(env);const name=r.root.findAllByType('input').find(n=>n.props.value==='演示公司')!;
  await act(async()=>name.props.onChange({target:{value:'未保存公司名'}}));await act(async()=>button(r,'产品库').props.onClick());
  assert.equal(r.root.findAll(n=>n.props.role==='alertdialog').length,1);
  await act(async()=>button(r,'继续编辑').props.onClick());assert(r.root.findAllByType('input').some(n=>n.props.value==='未保存公司名'));
 }finally{if(r)await act(async()=>r.unmount());env.cleanup();}
});
