import {DocumentItemsTable} from './DocumentItemsTable';
import {documentDraftTotals} from './documentDraftTotals';
import React,{useEffect,useState} from 'react';
import {DocType,type CompanyProfile,type DocumentData,type DocItem} from '../../types';
import type {DocumentRecord} from '../../../server/order-v2/documents';
import ProductSelectorDialog from './ProductSelectorDialog';
import V2DocumentPrintView from './V2DocumentPrintView';
import {applySelectedProductToDraft} from './selection';
import {fromV2DocumentRecord,toV2CreatePayload,toV2EditPayload} from './documentAdapter';
import {documentResourceUrl} from './documentSearchModel';


/** V2 persistence with the published document editing hierarchy. */
export interface V2DocumentWorkspaceProps{
 apiFetch:typeof fetch;
 role:'admin'|'sales';
 companyProfile:CompanyProfile;
 documentId?:string;
 initialDraft?:DocumentData;
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
export default function V2DocumentWorkspace({apiFetch,role,companyProfile,documentId,initialDraft,onSaved,onCancel}:V2DocumentWorkspaceProps){
 const [draft,setDraft]=useState<DocumentData>(()=>emptyDocument(companyProfile));
 const [removed,setRemoved]=useState<string[]>([]);
 const [picker,setPicker]=useState<{rowId:string;mode:'add'|'replace'}|null>(null);
 const [saving,setSaving]=useState(false);
 const [loading,setLoading]=useState(Boolean(documentId));
 const [error,setError]=useState('');
 const [savedId,setSavedId]=useState<string|null>(documentId??null);
 const [previewOpen,setPreviewOpen]=useState(false);
 const [depositText,setDepositText]=useState('0');
 const [initialized,setInitialized]=useState(false),[autoNumber,setAutoNumber]=useState(true),[numberRevision,setNumberRevision]=useState(0),[numberBusy,setNumberBusy]=useState(false),[numberError,setNumberError]=useState('');
 const [customers,setCustomers]=useState<string[]>([]);
 useEffect(()=>{
  let active=true;
  setSavedId(documentId??null);setPreviewOpen(false);
  if(!documentId){const initial=initialDraft?structuredClone(initialDraft):emptyDocument(companyProfile);setDraft(initial);setDepositText(String(initial.deposit??0));setRemoved([]);setLoading(false);setInitialized(true);setAutoNumber(!initial.docNo);return;}
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
 },[apiFetch,documentId,initialDraft,companyProfile]);
 useEffect(()=>{
  if(documentId||savedId||!initialized||!autoNumber||!/^\d{4}-\d{2}-\d{2}$/.test(draft.date))return;
  const abort=new AbortController();setNumberBusy(true);setNumberError('');
  setDraft(before=>({...before,docNo:''}));
  apiFetch('/api/v2/documents/reserve-number',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:draft.type===DocType.SALES?'bulk':draft.type,date:draft.date}),signal:abort.signal}).then(async response=>{
   if(!response.ok)throw Error('默认编号获取失败，可重试或手工填写');const result=await response.json();if(typeof result.orderNo!=='string'||!result.orderNo)throw Error('默认编号无效');
   if(!abort.signal.aborted)setDraft(before=>({...before,docNo:result.orderNo}));
  }).catch(error=>{if(!abort.signal.aborted)setNumberError(error.message);}).finally(()=>{if(!abort.signal.aborted)setNumberBusy(false);});
  return()=>{abort.abort();setNumberBusy(false);};
 },[apiFetch,documentId,savedId,initialized,autoNumber,draft.type,draft.date,numberRevision]);
 useEffect(()=>{
  const abort=new AbortController();setCustomers([]);const timer=setTimeout(()=>{
   apiFetch('/api/v2/documents/customers?'+new URLSearchParams({q:draft.customerName}).toString(),{signal:abort.signal}).then(async response=>{
    if(!response.ok)return;const result=await response.json();if(!abort.signal.aborted&&Array.isArray(result.items)&&result.items.every((x:unknown)=>typeof x==='string'))setCustomers(result.items);
   }).catch(()=>{});
  },250);return()=>{clearTimeout(timer);abort.abort();};
 },[apiFetch,draft.customerName]);
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
   if(numberBusy&&autoNumber)throw Error('正在获取默认编号，请稍候');
   if(!draft.docNo.trim()||!draft.customerName.trim())throw Error('请填写单据编号和客户');
   if(draft.items.length===0)throw Error('请先通过产品库选择至少一条明细');
   setSaving(true);
   const isEdit=Boolean(savedId);
   let deposit=0;
   if(draft.type!==DocType.SAMPLE){
    if(!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(depositText.trim()))throw Error('定金须为有效非负数字，最多两位小数');
    deposit=Number(depositText.trim());
    documentDraftTotals(draft,depositText);
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
 const headerFields:[keyof DocumentData,string][]=[['customerName','客户/收货单位'],['date','开单日期'],['docNo','单据编号']];
 const contactFields:[keyof DocumentData,string][]=[['issuer','开单人'],['receiver','收货人'],['bottomPhone','收货联系电话'],['receiverAddress','收货地址']];
 let totals:ReturnType<typeof documentDraftTotals>|null=null,totalError='';
 try{totals=documentDraftTotals(draft,depositText);}catch{totalError='请检查米数、分匹、单价、扣损或定金输入，汇总将在有效后更新';}
 if(previewOpen&&savedId)return <V2DocumentPrintView apiFetch={apiFetch} documentId={savedId}
  onBack={()=>setPreviewOpen(false)}/>;
 return <section className="mx-auto max-w-7xl space-y-5 rounded-2xl bg-white p-4 sm:p-6" aria-label="V2单据编辑工作区">
  <header className="flex flex-wrap justify-between gap-3">
   <div><h2 className="text-xl font-semibold">{savedId?'编辑单据':'新建单据'}</h2>
    <p className="text-xs text-slate-500">修改已存明细的米数和价格，会保留原产品资料。</p></div>
   {savedId&&<button type="button" disabled={!canEdit} onClick={()=>setPreviewOpen(true)}
    className="rounded-lg border border-emerald-300 px-4 py-2 text-sm text-emerald-800">预览已保存版本 / Excel</button>}
   <button type="button" disabled={!canEdit} onClick={onCancel}
    className="rounded-lg border px-4 py-2 text-sm">取消并返回</button>
  </header>
  {loading&&<div role="status" className="text-sm text-slate-600">正在读取V2单据…</div>}
  {error&&<div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
  {numberError&&<p role="alert" className="text-sm text-rose-700">{numberError} <button type="button" onClick={()=>{setAutoNumber(true);setNumberRevision(n=>n+1);}}>重新获取编号</button></p>}
  {initialDraft&&!savedId&&<p className="text-sm text-slate-600">正在新建副本。未关联产品的历史明细需重新选品；保存时使用当前产品资料，原单据保留。</p>}
  {!loading&&<>
   <section className="rounded-xl border border-slate-100 p-4"><h3 className="mb-3 border-l-4 border-sky-500 pl-3 text-sm font-semibold">基本信息</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {!savedId&&<label className="text-xs font-semibold">单据类型
     <select disabled={!canEdit} className={input} value={draft.type} onChange={e=>{
      const type=e.target.value as DocType;
      if(draft.items.length>0){setError('请先清除当前明细再切换单据类型');return;}
      setDraft(before=>({...before,type,deposit:0,settled:false,terms:type===DocType.DEPOSIT?companyProfile.depositTerms:companyProfile.defaultTerms}));setDepositText('0');
     }}>
      <option value={DocType.SAMPLE}>样布码单</option><option value={DocType.DEPOSIT}>定金单</option>
      <option value={DocType.SALES}>销售发货码单</option>
     </select></label>}
    {headerFields.map(([key,label])=><label key={key} className="text-xs font-semibold text-slate-700">
     {label}<input name={key} list={key==='customerName'?'v2-customer-suggestions':undefined} className={input} type={key==='date'?'date':'text'}
      maxLength={key==='receiverAddress'?500:key==='companyAddress'?500:key==='companyName'?255:100}
      disabled={!canEdit} readOnly={['companyName','companyAddress','companyPhone'].includes(key)}
      value={String(draft[key]??'')} onChange={e=>{if(key==='docNo'){setAutoNumber(false);setNumberError('');}change(key,e.target.value);}}/></label>)}
    <datalist id="v2-customer-suggestions">{customers.map(value=><option key={value} value={value}/>)}</datalist>
    {draft.type!==DocType.SAMPLE&&<label className="text-xs font-semibold">{draft.type===DocType.DEPOSIT?'定金比例（%）':'定金金额（元）'}
     <input className={input} name="deposit" type="text" inputMode="decimal" maxLength={14}
      disabled={!canEdit} value={depositText} onChange={e=>setDepositText(e.target.value)}/></label>}
    {draft.type!==DocType.DEPOSIT&&<label className="flex items-center gap-2 text-sm">
     <input type="checkbox" checked={Boolean(draft.settled)} disabled={!canEdit}
      onChange={e=>change('settled',e.target.checked)}/>已结清</label>}
   </div></section>
   <div className="flex items-center justify-between gap-3">
    <h3 className="font-semibold">产品明细（{draft.items.length}）</h3>
    <div className="flex gap-2"><button type="button" className="rounded border px-3 py-2 text-sm" disabled={!canEdit||!draft.items.length} onClick={()=>{
     const removedIds=draft.items.filter(item=>idPattern.test(item.id)).map(item=>item.id);setRemoved(before=>[...new Set([...before,...removedIds])]);setDraft(before=>({...before,items:[]}));
    }}>清空明细</button><button type="button" disabled={!canEdit} onClick={addItem}
     className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">从产品库添加</button>
    </div>
   </div>
   <DocumentItemsTable draft={draft} role={role} disabled={!canEdit} onChange={updateItem} onReplace={id=>openPicker(id,'replace')} onRemove={removeItem}/>
   <DocumentTotalsSummary type={draft.type} totals={totals} error={totalError}/>
   <details className="rounded-xl border border-slate-100 p-4"><summary className="cursor-pointer text-sm font-semibold">单据签署与联系信息</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {contactFields.map(([key,label])=><label key={key} className="text-xs font-semibold">{label}<input name={key} className={input} maxLength={key==='receiverAddress'?500:100} disabled={!canEdit} value={String(draft[key]??'')} onChange={event=>change(key,event.target.value)}/></label>)}
    {([['companyName','公司名称'],['companyAddress','公司地址'],['companyPhone','公司电话']] as const).map(([key,label])=><label key={key} className="text-xs text-slate-500">{label}<input className={input} readOnly value={String(draft[key]??'')}/></label>)}
    <label className="sm:col-span-2 lg:col-span-4 text-xs text-slate-500">单据展示条款（来自开单设置）<textarea className={input} rows={2} readOnly value={draft.type===DocType.DEPOSIT?companyProfile.depositTerms:companyProfile.defaultTerms}/></label>
   </div></details>
   <footer className="flex flex-wrap items-center justify-between gap-3">
    <p className="text-xs text-slate-600"></p>
    <button type="button" disabled={!canEdit} onClick={()=>void save()}
     className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40">
     {saving?'正在保存…':savedId?'保存修改':'创建单据'}
    </button>
   </footer>
  </>}
  <ProductSelectorDialog open={picker!==null} mode={picker?.mode??'add'} role={role}
   apiFetch={apiFetch} onSelect={pickProduct} onCancel={()=>setPicker(null)} onRequestManual={manual}/>
 </section>;
}

export function DocumentTotalsSummary({type,totals,error}:{type:DocType;totals:ReturnType<typeof documentDraftTotals>|null;error:string}){
 return <section aria-label="单据汇总" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
    {totals?<>{type!==DocType.DEPOSIT&&<span>总匹数：<strong>{totals.totalPieces} 匹</strong></span>}<span>总计米数：<strong className="text-sky-700">{totals.totalMeters.toFixed(2)} 米</strong></span>
     {type===DocType.SALES&&totals.totalDeductionMeters>0&&<span className="text-amber-700">扣损合计：<strong>{totals.totalDeductionMeters.toFixed(2)} 米</strong></span>}
     <span>合计金额：<strong className="text-rose-700">¥{totals.totalAmount.toFixed(2)}</strong></span>
     {type!==DocType.SAMPLE&&<span>{type===DocType.DEPOSIT?'定金金额':'预收订金'}：¥{totals.depositAmount.toFixed(2)}</span>}
     {type!==DocType.DEPOSIT&&<span>应收金额：<strong>¥{totals.receivableAmount.toFixed(2)}</strong></span>}</>:<p role="alert" className="text-rose-700">{error}</p>}
   </section>;
}
