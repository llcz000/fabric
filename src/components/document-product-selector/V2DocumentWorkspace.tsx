import {SalesPieceInputs} from './SalesPieceInputs';
import React,{useEffect,useState} from 'react';
import {DocType,type CompanyProfile,type DocumentData,type DocItem} from '../../types';
import type {DocumentRecord} from '../../../server/order-v2/documents';
import ProductSelectorDialog from './ProductSelectorDialog';
import V2DocumentPrintView from './V2DocumentPrintView';
import {applySelectedProductToDraft} from './selection';
import {fromV2DocumentRecord,toV2CreatePayload,toV2EditPayload} from './documentAdapter';
import {documentResourceUrl} from './documentSearchModel';
import {calculateDocumentPayment} from '../../../server/order-v2/calculations';

/** Standalone V2-only editing entry point. Not mounted by legacy App.tsx. */
export interface V2DocumentWorkspaceProps{
 apiFetch:typeof fetch;
 role:'admin'|'sales';
 companyProfile:CompanyProfile;
 documentId?:string;
 onSaved:(document:DocumentData)=>void;
 onCancel:()=>void;
}
type DraftItem=DocItem&{v2ProductId?:string;v2SourceKind?:'catalog'|'manual'|null;v2SelectionChanged?:boolean};
function localDate():string{
 const d=new Date();
 return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function emptyDocument(company:CompanyProfile):DocumentData{
 return {id:'new',docNo:'',date:localDate(),customerName:'',styleNo:'',type:DocType.SAMPLE,items:[],
  companyName:company.name,companyAddress:company.address,companyPhone:company.phone,
  terms:company.defaultTerms,issuer:'',receiver:'',receiverAddress:'',bottomPhone:'',
  totalMeters:0,totalRolls:0,totalAmount:0,receivableAmount:0,deposit:0,deductionMeters:0,
  settled:false,createdAt:'',updatedAt:''};
}
const idPattern=/^[1-9][0-9]{0,9}$/;
const newItem=():DraftItem=>({id:`new-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
 itemNo:'',colorNo:'',productName:'',meters:0,price:0,amount:0,remark:''}) as DraftItem;
function formatError(code:number):string {
 if(code===401)return '登录已失效，请重新进入V2工作区';
 if(code===403)return '当前账号没有此单据的操作权限';
 if(code===404)return '单据不存在或当前账号不能查看';
 if(code===422)return '所选产品已停用或资料超出单据支持范围，请重新选择';
 return '单据保存或读取失败，请检查数据后重试';
}
export default function V2DocumentWorkspace({apiFetch,role,companyProfile,documentId,onSaved,onCancel}:V2DocumentWorkspaceProps){
 const [draft,setDraft]=useState<DocumentData>(()=>emptyDocument(companyProfile));
 const [removed,setRemoved]=useState<string[]>([]);
 const [picker,setPicker]=useState<{rowId:string;mode:'add'|'replace'}|null>(null);
 const [saving,setSaving]=useState(false);
 const [loading,setLoading]=useState(Boolean(documentId));
 const [error,setError]=useState('');
 const [savedId,setSavedId]=useState<string|null>(documentId??null);
 const [previewOpen,setPreviewOpen]=useState(false);
 const [depositText,setDepositText]=useState('0');
 useEffect(()=>{
  let active=true;
  setSavedId(documentId??null);setPreviewOpen(false);
  if(!documentId){setDraft(emptyDocument(companyProfile));setDepositText('0');setRemoved([]);setLoading(false);return;}
  const controller=new AbortController();
  setLoading(true);setError('');
  (async()=>{
   try{
    const response=await apiFetch(documentResourceUrl(documentId),{
     signal:controller.signal,headers:{Accept:'application/json'}
    });
    if(!response.ok)throw Error(formatError(response.status));
    const saved=fromV2DocumentRecord(await response.json(),companyProfile);
    if(active){setDraft(saved);setDepositText(String(saved.deposit??0));setRemoved([]);}
   }catch(e){
    if(active)setError(e instanceof Error?e.message:'读取单据失败');
   }finally{if(active)setLoading(false);}
  })();
  return ()=>{active=false;controller.abort();};
 },[apiFetch,documentId,companyProfile]);
 const change=(field:keyof DocumentData,value:unknown)=>
  setDraft(before=>({...before,[field]:value}));
 const updateItem=(id:string,patch:Record<string,unknown>)=>
  setDraft(before=>({...before,items:before.items.map(item=>item.id===id?
   ({...item,...patch} as DocItem):item)}));
 const removeItem=(id:string)=>{
  setDraft(before=>({...before,items:before.items.filter(item=>item.id!==id)}));
  if(idPattern.test(id))setRemoved(before=>before.includes(id)?before:[...before,id]);
 };
 const openPicker=(id:string,mode:'add'|'replace')=>setPicker({rowId:id,mode});
 const addItem=()=>{
  const item=newItem();setDraft(before=>({...before,items:[...before.items,item]}));openPicker(item.id,'add');
 };
 const pickProduct=(product:Parameters<typeof applySelectedProductToDraft>[2])=>{
  if(!picker)return;
  setDraft(before=>({...before,items:before.items.map(item=>item.id===picker.rowId?
   applySelectedProductToDraft(before.type,item,product):item)}));
  setPicker(null);
 };
 const manual=()=>{
  if(role!=='admin'||!picker)return;
  updateItem(picker.rowId,{v2ProductId:undefined,v2SourceKind:'manual',v2SelectionChanged:true});
  setPicker(null);
 };
 const save=async()=>{
  if(saving||loading)return;
  setError('');
  try{
   if(!draft.docNo.trim()||!draft.customerName.trim())throw Error('请填写单据编号和客户');
   if(draft.items.length===0)throw Error('请先通过产品库选择至少一条明细');
   setSaving(true);
   const isEdit=Boolean(savedId);
   let deposit=0;
   if(draft.type!==DocType.SAMPLE){
    if(!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(depositText.trim()))throw Error('定金须为有效非负数字，最多两位小数');
    deposit=Number(depositText.trim());
    try{calculateDocumentPayment(draft.type,draft.totalAmount??0,deposit);}catch{throw Error(draft.type===DocType.DEPOSIT?'定金比例须在0～100之间，最多两位小数':'定金金额超出支持范围');}
   }
   const paymentDraft={...draft,deposit};
   const payload=isEdit?toV2EditPayload(paymentDraft,role,removed):toV2CreatePayload(paymentDraft,role);
   const response=await apiFetch(isEdit?
    documentResourceUrl(savedId!):documentResourceUrl(),{
    method:isEdit?'PATCH':'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
   });
   if(!response.ok)throw Error(formatError(response.status));
   const serverDocument=fromV2DocumentRecord(await response.json(),companyProfile);
   setDraft(serverDocument);setDepositText(String(serverDocument.deposit??0));setRemoved([]);
   setSavedId(serverDocument.id);
   onSaved(serverDocument);
  }catch(e){setError(e instanceof Error?e.message:'保存失败');}
  finally{setSaving(false);}
 };
 const input='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-sky-600';
 const canEdit=!(loading||saving);
 const canManual=(item:DraftItem)=>role==='admin'&&item.v2SourceKind==='manual';
 const headerFields:[keyof DocumentData,string][]=[
  ['docNo','单据编号'],['date','开单日期'],['customerName','客户/收货单位'],
  ['styleNo','款式号'],['issuer','开单人'],['receiver','收货人'],
  ['bottomPhone','收货联系电话'],['receiverAddress','收货地址'],
  ['companyName','公司名称'],['companyAddress','公司地址'],['companyPhone','公司电话']
 ];
 if(previewOpen&&savedId)return <V2DocumentPrintView apiFetch={apiFetch} documentId={savedId}
  onBack={()=>setPreviewOpen(false)}/>;
 return <section className="mx-auto max-w-7xl space-y-5 rounded-2xl bg-white p-4 sm:p-6" aria-label="V2单据编辑工作区">
  <header className="flex flex-wrap justify-between gap-3">
   <div><h2 className="text-xl font-semibold">{savedId?'编辑V2单据':'新建V2单据'}</h2>
    <p className="text-xs text-slate-500">只通过V2认证接口写入；产品资料来自库内快照，修改业务字段不会刷新原产品</p></div>
   {savedId&&<button type="button" disabled={!canEdit} onClick={()=>setPreviewOpen(true)}
    className="rounded-lg border border-emerald-300 px-4 py-2 text-sm text-emerald-800">预览已保存版本 / Excel</button>}
   <button type="button" disabled={!canEdit} onClick={onCancel}
    className="rounded-lg border px-4 py-2 text-sm">取消并返回</button>
  </header>
  {loading&&<div role="status" className="text-sm text-slate-600">正在读取V2单据…</div>}
  {error&&<div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
  {!loading&&<>
   <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {!savedId&&<label className="text-xs font-semibold">单据类型
     <select className={input} value={draft.type} onChange={e=>{
      const type=e.target.value as DocType;
      if(draft.items.length>0){setError('请先清除当前明细再切换单据类型');return;}
      setDraft(before=>({...before,type,deposit:0,settled:false,terms:type===DocType.DEPOSIT?companyProfile.depositTerms:companyProfile.defaultTerms}));setDepositText('0');
     }}>
      <option value={DocType.SAMPLE}>样布码单</option><option value={DocType.DEPOSIT}>定金单</option>
      <option value={DocType.SALES}>销售发货码单</option>
     </select></label>}
    {headerFields.map(([key,label])=><label key={key} className="text-xs font-semibold text-slate-700">
     {label}<input className={input} type={key==='date'?'date':'text'}
      maxLength={key==='receiverAddress'?500:key==='companyAddress'?500:key==='companyName'?255:100}
      disabled={!canEdit||Boolean(savedId)&&['docNo','date','customerName','styleNo'].includes(key)}
      value={String(draft[key]??'')} onChange={e=>change(key,e.target.value)}/></label>)}
    {draft.type!==DocType.SAMPLE&&<label className="text-xs font-semibold">{draft.type===DocType.DEPOSIT?'定金比例（%）':'定金金额（元）'}
     <input className={input} name="deposit" type="text" inputMode="decimal" maxLength={14}
      disabled={!canEdit} value={depositText} onChange={e=>setDepositText(e.target.value)}/></label>}
    {draft.type!==DocType.DEPOSIT&&<label className="flex items-center gap-2 text-sm">
     <input type="checkbox" checked={Boolean(draft.settled)} disabled={!canEdit}
      onChange={e=>change('settled',e.target.checked)}/>已结清</label>}
    <label className="sm:col-span-2 lg:col-span-3 text-xs font-semibold">单据展示条款
     <textarea className={input} rows={3} maxLength={12000} disabled={!canEdit}
      value={draft.terms??''} onChange={e=>change('terms',e.target.value)}/></label>
   </div>
   <div className="flex items-center justify-between gap-3">
    <h3 className="font-semibold">产品明细（{draft.items.length}）</h3>
    <button type="button" disabled={!canEdit} onClick={addItem}
     className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">从产品库添加</button>
   </div>
   <div className="space-y-3">
    {draft.items.map(row=>{
     const item=row as DraftItem&{rollNo?:string;deductionMeters?:number;composition?:string;weight?:string;width?:string};
     const editable=canManual(item);
     return <article key={item.id} className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
       <p className="text-sm font-semibold">{item.itemNo||'待选择产品'} · {item.productName||'—'} · 配色{item.colorNo||'—'}</p>
       <div className="flex gap-2">
        <button type="button" disabled={!canEdit} className="rounded border px-3 py-1 text-xs"
         onClick={()=>openPicker(item.id,'replace')}>更换产品</button>
        <button type="button" disabled={!canEdit} className="rounded border border-rose-200 px-3 py-1 text-xs text-rose-700"
         onClick={()=>removeItem(item.id)}>删除明细</button>
       </div>
      </div>
      <p className="mb-2 text-xs text-slate-500">
       {item.v2SourceKind==='catalog'?'关联产品库｜资料只读':item.v2SourceKind==='manual'?'管理员手工录入':'历史资料｜不可修改主数据'}
      </p>
      {editable&&<div className="mb-3 grid gap-3 sm:grid-cols-3">
       {([['itemNo','手工货号'],['productName','品名'],['colorNo','色号'],['composition','成分'],['weight','克重'],['width','门幅']] as const).map(([key,label])=>
        <label key={key} className="text-xs">{label}<input className={input} value={String(item[key]??'')}
         onChange={e=>updateItem(item.id,{[key]:e.target.value})}/></label>)}
      </div>}
      {draft.type===DocType.SALES&&<SalesPieceInputs value={item.rollNo??''} grossMeters={item.meters} disabled={!canEdit}
       onChange={patch=>updateItem(item.id,patch)}/>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
       {([['meters','米数'],['price','单价']] as const).map(([key,label])=>
        <label key={key} className="text-xs">{label}<input className={input} type="number" min="0" step="0.01"
         disabled={!canEdit} readOnly={draft.type===DocType.SALES&&key==='meters'} value={item[key]} onChange={e=>updateItem(item.id,{[key]:Number(e.target.value)})}/></label>)}
       {draft.type===DocType.SALES&&<>
        <label className="text-xs">扣损米数<input className={input} type="number" step="0.01" min="0"
         disabled={!canEdit} value={item.deductionMeters??0} onChange={e=>updateItem(item.id,{deductionMeters:Number(e.target.value)})}/></label>
       </>}
       <label className="text-xs">备注<input className={input} disabled={!canEdit}
        value={item.remark} onChange={e=>updateItem(item.id,{remark:e.target.value})}/></label>
      </div>
     </article>;
    })}
   </div>
   <footer className="flex flex-wrap items-center justify-between gap-3">
    <p className="text-xs text-slate-600">金额及汇总以服务端重新计算为准，不能用页面合计覆盖数据库</p>
    <button type="button" disabled={!canEdit} onClick={()=>void save()}
     className="rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40">
     {saving?'正在保存…':savedId?'保存修改':'创建单据'}
    </button>
   </footer>
  </>}
  <ProductSelectorDialog open={picker!==null} mode={picker?.mode??'add'} role={role}
   apiFetch={apiFetch} onSelect={pickProduct} onCancel={()=>setPicker(null)} onRequestManual={manual}/>
 </section>;
}
