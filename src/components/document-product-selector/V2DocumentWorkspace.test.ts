import test,{after} from 'node:test';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const NativeChannel=globalThis.MessageChannel,channels:MessageChannel[]=[];
globalThis.MessageChannel=class extends NativeChannel{constructor(){super();channels.push(this);}};
after(()=>{channels.forEach(c=>{c.port1.close();c.port2.close();});globalThis.MessageChannel=NativeChannel;});
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import V2DocumentWorkspace,{DocumentTotalsSummary} from './V2DocumentWorkspace';
import {DocType} from '../../types';
import type {CompanyProfile} from '../../types';
const profile={name:'公司A',address:'地址A',phone:'0575',defaultTerms:'标准备注',
 depositTerms:'定金备注'} as CompanyProfile;
test('P6 V2 workspace exposes actual create header and safe V2-only product entry',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{
  apiFetch:fetch,role:'sales',companyProfile:profile,onSaved:()=>{},onCancel:()=>{}
 }));
 for(const label of ['V2单据编辑工作区','公司名称','公司地址','公司电话','单据展示条款','开单人','收货人','收货联系电话','收货地址','已结清','从产品库添加','创建单据'])
  assert(html.includes(label),label);
 assert(!html.includes('上一页客户'),'初始页面不展开客户列表');
 assert(!html.includes('/api/orders'));
 assert(!html.includes('预收定金'),'sample does not offer a deposit input');
});
test('P6 V2 workspace loading for stored doc requires V2 get and does not pretend legacy local document loaded',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{
  apiFetch:fetch,role:'admin',documentId:'27',companyProfile:profile,onSaved:()=>{},onCancel:()=>{}
 }));
 assert(html.includes('正在读取V2单据'));
 assert(!html.includes('创建单据'));
});

test('editor restores published hierarchy with collapsed optional contacts and no invented style number',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{apiFetch:fetch,role:'admin',companyProfile:profile,onSaved:()=>{},onCancel:()=>{}}));
 assert(!html.includes('款式号'));assert(!html.includes('name="styleNo"'));
 assert.match(html,/<details[^>]*><summary[^>]*>单据签署与联系信息/);
 assert(!/<details[^>]*\sopen/.test(html));assert(html.includes('合计金额'));assert(html.includes('总计米数'));
});

test('deposit editor totals show contract and computed deposit without receivable, pieces or settlement',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentTotalsSummary,{type:DocType.DEPOSIT,totals:{totalMeters:10,totalPieces:0,totalAmount:300,totalDeductionMeters:0,depositAmount:75,receivableAmount:0},error:''}));
 for(const value of ['总计米数','合计金额','定金金额','75.00'])assert(html.includes(value));
 assert(!/应收|应付|匹数|扣损|结清/.test(html));
});

test('new document type order is sample, sales, deposit',()=>{const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{apiFetch:fetch,role:'admin',companyProfile:profile,onSaved(){},onCancel(){}}));assert.deepEqual([...html.matchAll(/<option value="(sample|sales|deposit)"[^>]*>/g)].map(m=>m[1]),['sample','sales','deposit']);});
test('P1-4 create button stays disabled until at least one product line exists',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{
  apiFetch:fetch,role:'sales',companyProfile:profile,onSaved:()=>{},onCancel:()=>{}
 }));
 // 空明细时「创建单据」必须禁用，并给出明确引导，而不是让用户点进去才发现不能保存。
 const button=html.match(/<button[^>]*type="button"[^>]*disabled="[^"]*"[^>]*>\s*<svg[^>]*>[\s\S]*?创建单据/);
 assert(button,'创建单据按钮应在无明细时禁用');
 assert(html.includes('暂无明细'),'缺少空状态引导');
 assert(html.includes('从产品库添加'),'空状态应指向选品入口');
});

test('document terms are editable in signature section with default text',()=>{const html=renderToStaticMarkup(React.createElement(V2DocumentWorkspace,{apiFetch:fetch,role:'admin',companyProfile:profile,onSaved(){},onCancel(){}}));assert.match(html,/<textarea[^>]*name="terms"[^>]*>标准备注<\/textarea>/);assert(!/<textarea[^>]*readonly/i.test(html));assert(!html.includes('来自开单设置'));});

test('type change preserves custom terms and switches untouched defaults',async()=>{
 for(const depositTerms of [profile.depositTerms,'']){
 let r!:ReactTestRenderer;const api:typeof fetch=async url=>Response.json(String(url).includes('next-number')?{orderNo:'YB-1'}:{items:[]});
 await act(async()=>{r=create(React.createElement(V2DocumentWorkspace,{apiFetch:api,role:'admin',companyProfile:{...profile,depositTerms},onSaved(){},onCancel(){}}));});
 const type=()=>r.root.findAllByType('select').find(n=>n.props.value===DocType.SAMPLE||n.props.value===DocType.DEPOSIT||n.props.value===DocType.SALES)!;
 await act(async()=>type().props.onChange({target:{value:DocType.DEPOSIT}}));assert.equal(r.root.findByProps({name:'terms'}).props.value,depositTerms);
 await act(async()=>r.root.findByProps({name:'terms'}).props.onChange({target:{value:'本单专用条款'}}));
 await act(async()=>type().props.onChange({target:{value:DocType.SALES}}));assert.equal(r.root.findByProps({name:'terms'}).props.value,'本单专用条款');
 await act(async()=>r.root.findByProps({name:'terms'}).props.onChange({target:{value:''}}));
 await act(async()=>type().props.onChange({target:{value:DocType.DEPOSIT}}));assert.equal(r.root.findByProps({name:'terms'}).props.value,'');
 await act(async()=>type().props.onChange({target:{value:DocType.SALES}}));assert.equal(r.root.findByProps({name:'terms'}).props.value,'');
 await act(async()=>r.unmount());
 }
});

test('V1.2 actual document editor uses shared quick profile draft and retries the atomic save with one key',async()=>{
 const writes:any[]=[];let saved=0;const initial={id:'new',docNo:'YB-V12',date:'2026-10-21',customerName:'',styleNo:'',type:DocType.SAMPLE,items:[{id:'new-1',itemNo:'P1',productName:'测试面料',colorNo:'1',meters:1,price:100,amount:100,remark:'',v2ProductId:'1',v2SourceKind:'catalog'}],companyName:'公司A',companyAddress:'地址',companyPhone:'电话',terms:'',issuer:'',receiver:'',receiverAddress:'',bottomPhone:'',totalMeters:1,totalRolls:1,totalAmount:100,receivableAmount:100,deposit:0,deductionMeters:0,settled:false,createdAt:'',updatedAt:''} as any;
 const record={id:'9',ownerId:'1',orderNo:'YB-V12',date:'2026-10-21',receivingUnit:'快建客户',type:'sample',deposit:0,styleNo:'',issuer:'',receiver:'',receiverPhone:'',receiverAddress:'',settled:false,displaySnapshot:null,totalMeters:1,totalPieces:1,totalAmount:100,deductionMeters:0,items:[{id:'11',productId:'1',source:'catalog',snapshot:{},productNo:'P1',productName:'测试面料',colorNo:'1',composition:'',weight:null,widthCm:null,meters:1,unitPrice:100,amount:100,remark:'',pieceMeters:null,deductionMeters:0}],customerLink:{customerId:'8',linkVersion:'1'}};
 const api:typeof fetch=async(url,init)=>{if(String(url).includes('/capability'))return Response.json({enabled:true});if(String(url)==='/api/v2/documents'&&init?.method==='POST'){writes.push(JSON.parse(String(init.body)));if(writes.length===1)throw Error('uncertain response');return Response.json(record);}return Response.json({items:[],total:0,limit:20,offset:0});};let r!:ReactTestRenderer;
 await act(async()=>{r=create(React.createElement(V2DocumentWorkspace,{apiFetch:api,role:'admin',companyProfile:profile,initialDraft:initial,onSaved(){saved++;},onCancel(){}}));});
 try{const click=(name:string)=>r.root.findAllByType('button').find(n=>n.children.join('').includes(name))!.props.onClick();await act(async()=>r.root.findAllByType('button').find(n=>n.props['aria-haspopup']==='dialog')!.props.onClick());await act(async()=>click('快速建档'));await act(async()=>r.root.findByProps({'aria-label':'客户名称'}).props.onChange({target:{value:'快建客户'}}));await act(async()=>click('确认使用'));assert.equal(writes.length,0);await act(async()=>click('创建单据'));await act(async()=>click('创建单据'));assert.equal(writes.length,2);assert.equal(writes[0].customer.requestId,writes[1].customer.requestId);assert.equal(writes[0].customer.profile.displayName,'快建客户');assert.equal(writes[0].receivingUnit,'快建客户');assert.equal(saved,1);}finally{await act(async()=>r.unmount());}
});
