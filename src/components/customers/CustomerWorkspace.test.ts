import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {CustomerSessionPicker,CustomerWorkspace} from './CustomerWorkspace';
import {CustomerProfileForm} from './CustomerProfileForm';
import {ConfirmProvider} from '../ui/ConfirmDialog';
import {V2LeaveContext,readLeaveState,type LeaveRegistry} from '../product-master-v2/useV2LeaveProtection';
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const profile={displayName:'已有客户',subjectType:'unknown',invoiceTitle:null,brands:[],contacts:[{name:'',phone:'123',wechat:null}],region:null,salesChannel:'unknown',prices:[],tier:'unrated',tierReason:null,relationshipStage:'unknown',stageReason:null};
const customer={id:'1',profile,ownerUserId:'2',rowVersion:'1',archived:false,canEdit:true,canManageAccess:true,canTransferOwner:false,access:[]};
function button(r:ReactTestRenderer,text:string){return r.root.findAllByType('button').find(n=>(n.children.join('')+' '+(n.props['aria-label']??'')).includes(text))!;}
async function mount(el:React.ReactElement){let r!:ReactTestRenderer;await act(async()=>{r=create(el,{createNodeMock:e=>e.type==='dialog'?{showModal(){},close(){}}:null});});return r;}
test('customer details are read only in a dialog while the directory remains mounted',async()=>{
 const api:typeof fetch=async url=>String(url).includes('capability')?Response.json({enabled:true}):String(url).endsWith('/customers/1')?Response.json(customer):Response.json({items:[customer],total:1,limit:20,offset:0});
 const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:api}));
 try{await act(async()=>button(r,'查看档案').props.onClick());assert.equal(r.root.findAllByType('table').length,1);assert.equal(r.root.findAllByProps({'aria-label':'客户档案表单'}).length,0);assert.equal(r.root.findAllByType('dialog').length,1);assert.doesNotMatch(JSON.stringify(r.toJSON()),/重新读取|刷新档案/);}finally{await act(async()=>r.unmount());}
});
test('single brand is part of basic data and unrelated edits preserve existing brands',async()=>{
 let latest:any;
 function Form(){const [value,setValue]=React.useState({...profile,brands:['主品牌','原有品牌']} as any);latest=value;return React.createElement(CustomerProfileForm,{value,onChange:setValue});}
 const r=await mount(React.createElement(Form));
 try{assert.equal(r.root.findAllByProps({'aria-label':'品牌'}).length,1);assert.doesNotMatch(JSON.stringify(r.toJSON()),/添加品牌|移除品牌/);await act(async()=>r.root.findByProps({'aria-label':'地区'}).props.onChange({target:{value:'杭州'}}));assert.deepEqual(latest.brands,['主品牌','原有品牌']);await act(async()=>r.root.findByProps({'aria-label':'品牌'}).props.onChange({target:{value:'单品牌'}}));assert.deepEqual(latest.brands,['单品牌']);}finally{await act(async()=>r.unmount());}
});
test('customer form exposes only simple RMB/metre price fields and hides invoice without deleting old data',async()=>{
 let latest:any;
 function Form(){const [value,setValue]=React.useState({...profile,invoiceTitle:'原开票抬头',prices:[{fabricCategory:'真丝',minPrice:'45',maxPrice:'90',currency:'CNY',unit:'metre',taxBasis:'included',remark:'常用价'}]} as any);latest=value;return React.createElement(CustomerProfileForm,{value,onChange:setValue});}
 const r=await mount(React.createElement(Form));
 try{assert.equal(r.root.findAllByProps({'aria-label':'主要开票抬头'}).length,0);for(const name of ['币种1','价格单位1','含税口径1'])assert.equal(r.root.findAllByProps({'aria-label':name}).length,0);assert(r.root.findByProps({'aria-label':'面料类别1'}));assert(r.root.findByProps({'aria-label':'价格备注1'}));await act(async()=>r.root.findByProps({'aria-label':'地区'}).props.onChange({target:{value:'杭州'}}));assert.equal(latest.invoiceTitle,'原开票抬头');assert.equal(latest.prices[0].taxBasis,'included');await act(async()=>button(r,'添加价格范围').props.onClick());assert.equal(latest.prices[1].currency,'CNY');assert.equal(latest.prices[1].unit,'metre');assert.equal(latest.prices[1].taxBasis,'unknown');}finally{await act(async()=>r.unmount());}
});
test('refresh preserves visible customers until the new response arrives',async()=>{
 let resolve!:(r:Response)=>void,reads=0;
 const api:typeof fetch=async url=>{if(String(url).includes('capability'))return Response.json({enabled:true});if(++reads===1)return Response.json({items:[customer],total:1,limit:20,offset:0});return new Promise<Response>(r=>{resolve=r;});};
 const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:api}));
 try{await act(async()=>button(r,'刷新').props.onClick());assert.match(JSON.stringify(r.toJSON()),/已有客户/);assert.equal(button(r,'查看档案').props.disabled,true);await act(async()=>resolve(Response.json({items:[],total:0,limit:20,offset:0})));assert.doesNotMatch(JSON.stringify(r.toJSON()),/已有客户/);}finally{await act(async()=>r.unmount());}
});
test('a revoked directory request removes previously visible customer data',async()=>{
 let reads=0;
 const api:typeof fetch=async url=>String(url).includes('capability')?Response.json({enabled:true}):++reads===1?Response.json({items:[customer],total:1,limit:20,offset:0}):Response.json({}, {status:403});
 const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:api}));
 try{await act(async()=>button(r,'刷新').props.onClick());assert.doesNotMatch(JSON.stringify(r.toJSON()),/已有客户/);assert(r.root.findByProps({role:'alert'}));}finally{await act(async()=>r.unmount());}
});
test('picker searches existing customers then opens actual returned session once despite double submit',async()=>{
 const writes:any[]=[];let opened:any;const api:typeof fetch=async(url,init)=>{if(String(url).includes('with-sample-session')){writes.push(JSON.parse(String(init?.body)));return Response.json({customer,session:{id:'8',customerReference:'已有客户',status:'open'}});}return Response.json({items:[customer],total:1,limit:20,offset:0});};
 const r=await mount(React.createElement(CustomerSessionPicker,{apiFetch:api,onCreated:s=>{opened=s;},onClose(){}}));
 await act(async()=>button(r,'选择').props.onClick());const form=r.root.findAllByType('form').find(n=>n.props['aria-label']==='选择客户并新建选样')!;
 await act(async()=>{const a=form.props.onSubmit({preventDefault(){}});void form.props.onSubmit({preventDefault(){}});await a;});
 assert.equal(writes.length,1);assert.equal(writes[0].customerId,'1');assert.equal(opened.id,'8');await act(async()=>r.unmount());
});
test('workspace creates a minimal real profile and preserves draft on conflict',async()=>{
 let posted:any;const api:typeof fetch=async(url,init)=>{if(String(url).includes('capability'))return Response.json({enabled:true});if(init?.method==='POST'){posted=JSON.parse(String(init.body));return Response.json({error:'secret stack'}, {status:409});}return Response.json({items:[],total:0,limit:20,offset:0});};
 const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:api}));await act(async()=>button(r,'新建客户').props.onClick());
 for(const [label,value] of [['客户名称','新客户']])await act(async()=>r.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 await act(async()=>r.root.findByProps({'aria-label':'客户档案表单'}).props.onSubmit({preventDefault(){}}));
 assert.equal(posted.profile.displayName,'新客户');assert.deepEqual(posted.profile.contacts,[]);assert.equal(r.root.findByProps({'aria-label':'客户名称'}).props.value,'新客户');assert.match(JSON.stringify(r.toJSON()),/草稿/);assert.doesNotMatch(JSON.stringify(r.toJSON()),/secret stack/);await act(async()=>r.unmount());
});
test('disabled capability does not expose directory or issue customer reads',async()=>{
 const urls:string[]=[];const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:async url=>{urls.push(String(url));return Response.json({enabled:false});}}));assert.equal(urls.length,1);assert.match(JSON.stringify(r.toJSON()),/尚未启用/);await act(async()=>r.unmount());
});
test('V1.2 directory has only followup filter and no retired workflow entries',async()=>{
 const api:typeof fetch=async url=>Response.json(String(url).includes('capability')?{enabled:true}:{items:[customer],total:1,limit:20,offset:0});const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:api}));try{assert(r.root.findByProps({'aria-label':'待回访筛选'}));assert.doesNotMatch(JSON.stringify(r.toJSON()),/跟进待办|合作阶段|归档|负责人|寄样待反馈/);}finally{await act(async()=>r.unmount());}
});
test('customer activity opens the authorized session ID and hides admin owner transfer',async()=>{
 let opened='';const api:typeof fetch=async(url)=>{const path=String(url);if(path.includes('capability'))return Response.json({enabled:true});if(path.includes('/activity'))return Response.json({items:[{kind:'session',id:'8',summary:'第一次选样',occurredOn:'2026-10-20'}],total:1,limit:20,offset:0});if(path.endsWith('/customers/1'))return Response.json(customer);return Response.json({items:[customer],total:1,limit:20,offset:0});};
 const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:api,onOpenSession:id=>{opened=id;}}));await act(async()=>button(r,'查看档案').props.onClick());await act(async()=>button(r,'业务历史').props.onClick());await act(async()=>button(r,'查看选样详情').props.onClick());assert.equal(opened,'8');assert.doesNotMatch(JSON.stringify(r.toJSON()),/转移负责人至该账号/);await act(async()=>r.unmount());
});
test('identity change clears customer state and ignores an older list response',async()=>{
 let resolve!:(r:Response)=>void;const oldPage=new Promise<Response>(r=>{resolve=r;});const oldApi:typeof fetch=async url=>String(url).includes('capability')?Response.json({enabled:true}):oldPage;
 const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:oldApi}));const newApi:typeof fetch=async url=>Response.json(String(url).includes('capability')?{enabled:true}:{items:[],total:0,offset:0,limit:20});
 await act(async()=>r.update(React.createElement(CustomerWorkspace,{apiFetch:newApi})));await act(async()=>resolve(Response.json({items:[customer],total:1,offset:0,limit:20})));assert.doesNotMatch(JSON.stringify(r.toJSON()),/已有客户/);await act(async()=>r.unmount());
});
test('quick create submits only validated minimal profile and retains request id for uncertain retry',async()=>{
 const writes:any[]=[];let opened=0;const api:typeof fetch=async(_url,init)=>{if(init?.method==='POST'){writes.push(JSON.parse(String(init.body)));if(writes.length===1)throw Error('network lost after commit');return Response.json({customer,session:{id:'8',customerReference:'快速客户',status:'open'}});}return Response.json({items:[],total:0,offset:0,limit:20});};
 const r=await mount(React.createElement(CustomerSessionPicker,{apiFetch:api,onCreated(){opened++;},onClose(){}}));await act(async()=>button(r,'快速建档').props.onClick());
 const submit=()=>r.root.findByProps({'aria-label':'选择客户并新建选样',className:'space-y-4'}).props.onSubmit({preventDefault(){}});
 await act(async()=>submit());assert.equal(writes.length,0);
 for(const [label,value] of [['客户名称','快速客户'],['联系人1微信','customerwx']])await act(async()=>r.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 await act(async()=>submit());await act(async()=>submit());assert.equal(writes.length,2);assert.equal(writes[0].requestId,writes[1].requestId);assert.equal(writes[0].profile.contacts[0].name,'');assert.equal(writes[0].profile.invoiceTitle,null);assert.equal(opened,1);await act(async()=>r.unmount());
});
test('revoked access during profile save removes private customer details',async()=>{
 const api:typeof fetch=async(url,init)=>{if(String(url).includes('capability'))return Response.json({enabled:true});if(init?.method==='PATCH')return Response.json({error:'internal SQL'},{status:403});if(String(url).endsWith('/customers/1'))return Response.json(customer);return Response.json({items:[customer],total:1,offset:0,limit:20});};
 const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:api}));await act(async()=>button(r,'编辑客户').props.onClick());await act(async()=>r.root.findByProps({'aria-label':'客户档案表单'}).props.onSubmit({preventDefault(){}}));assert.doesNotMatch(JSON.stringify(r.toJSON()),/已有客户|internal SQL/);await act(async()=>r.unmount());
});
test('V1.2 simple profile exposes preferences and one return date, hides collaboration and ratings',async()=>{
 const api:typeof fetch=async url=>{if(String(url).includes('capability'))return Response.json({enabled:true});if(String(url).endsWith('/customers/1'))return Response.json(customer);return Response.json({items:[customer],total:1,limit:20,offset:0});};const r=await mount(React.createElement(CustomerWorkspace,{apiFetch:api}));try{await act(async()=>button(r,'编辑客户').props.onClick());assert(r.root.findByProps({'aria-label':'重点客户'}));assert(r.root.findByProps({'aria-label':'下次回访日期'}));assert.doesNotMatch(JSON.stringify(r.toJSON()),/负责人账号|协作与归档|等级调整理由|阶段调整理由|联系与待办|删除客户/);}finally{await act(async()=>r.unmount());}
});


test('customer fabric picker browses on open, keeps multi selection across searches and edits independent note',async()=>{
 let latest:any;const requests:string[]=[];const beforeDocument=globalThis.document;globalThis.document={addEventListener(){},removeEventListener(){}} as any;
 const fabrics=[{id:'10',fabricNo:'F001',fabricName:'真丝双绉',composition:'真丝',weightValue:null,weightUnit:null,widthValue:140,remark:null,isActive:true,productCount:1},{id:'11',fabricNo:'F002',fabricName:'棉麻平纹',composition:'棉麻',weightValue:null,weightUnit:null,widthValue:150,remark:null,isActive:true,productCount:0}];
 const api:typeof fetch=async url=>{const s=String(url);requests.push(s);return Response.json(s.includes('/tags')?{items:[]}:s.includes('/catalog')?{items:s.includes('F002')?[fabrics[1]]:fabrics,total:2,limit:50,offset:0}:fabrics.find(f=>s.endsWith('/'+f.id)));};
 function Form(){const [value,setValue]=React.useState({...profile,commonFabricIds:['10']} as any);latest=value;return React.createElement(CustomerProfileForm,{apiFetch:api,value,onChange:setValue});}
 const r=await mount(React.createElement(Form));
 try{const combo=r.root.findByProps({role:'combobox','aria-label':'搜索常用面料'});await act(async()=>combo.props.onFocus());await act(async()=>new Promise(res=>setTimeout(res,220)));
 assert.equal(r.root.findByProps({role:'listbox'}).props['aria-multiselectable'],true);
 const option=()=>r.root.findByProps({role:'option','aria-label':'选择面料 F002'});await act(async()=>option().props.onClick());assert.deepEqual(latest.commonFabricIds,['10','11']);assert.equal(combo.props['aria-expanded'],true);
 await act(async()=>combo.props.onChange({target:{value:'F002'}}));await act(async()=>new Promise(res=>setTimeout(res,220)));assert.deepEqual(latest.commonFabricIds,['10','11']);await act(async()=>option().props.onClick());assert.deepEqual(latest.commonFabricIds,['10']);
 await act(async()=>r.root.findByProps({'aria-label':'面料备注'}).props.onChange({target:{value:'优先轻薄'}}));assert.equal(latest.fabricNote,'优先轻薄');assert.deepEqual(latest.commonFabricIds,['10']);assert(requests.some(u=>u.includes('query=F002')));
 }finally{await act(async()=>r.unmount());globalThis.document=beforeDocument;}
});
