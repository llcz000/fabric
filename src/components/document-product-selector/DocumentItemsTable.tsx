import React from 'react';
import {ArrowLeftRight,Trash2} from 'lucide-react';
import {DocType,type DocumentData,type DocItem} from '../../types';
import {SalesPieceInputs} from './SalesPieceInputs';
import {documentDraftTotals} from './documentDraftTotals';
import {DocumentNumberInput} from './DocumentNumberInput';
type Detail=DocItem&{composition?:string;weight?:string;width?:string;rollNo?:string;deductionMeters?:number;v2SourceKind?:string|null};
export function DocumentItemsTable({draft,role,disabled,onChange,onReplace,onRemove}:{draft:DocumentData;role:'admin'|'sales';disabled:boolean;onChange(id:string,patch:Record<string,unknown>):void;onReplace(id:string):void;onRemove(id:string):void}){
 const sale=draft.type===DocType.SALES,sample=draft.type===DocType.SAMPLE;
 const headings=['序号','货号','色号','品名',...(sample?['成分','克重','门幅 / cm']:sale?['各匹米数']:[]),'米数',...(sale?['扣损米数']:[]),'单价','金额','备注','操作'];
 const field='w-full min-w-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:bg-slate-50';
 return <div className="overflow-x-auto rounded-xl border border-slate-200"><table aria-label="单据明细录入" className="w-full min-w-[1050px] table-fixed text-left text-xs"><thead className="bg-slate-50"><tr>{headings.map(label=><th className={'px-2 py-2 font-semibold '+(label==='各匹米数'?'w-[340px]':label==='序号'?'w-12':label==='操作'?'w-20':label==='品名'?'w-36':'')} key={label}>{label}</th>)}</tr></thead>
  <tbody>{draft.items.map((row,index)=>{
   const item=row as Detail,manual=role==='admin'&&item.v2SourceKind==='manual';
   const text=(key:'itemNo'|'colorNo'|'productName'|'composition'|'weight'|'width',label:string)=>manual?<input aria-label={label} className={field} disabled={disabled} value={item[key]??''} onChange={e=>onChange(item.id,{[key]:e.target.value})}/>:<span className="block break-words" data-product-field={key}>{item[key]||'—'}</span>;
   const numeric=(key:'meters'|'price'|'deductionMeters',label:string)=><DocumentNumberInput label={label} className={field} disabled={disabled} readOnly={sale&&key==='meters'} value={item[key]??0} onChange={value=>onChange(item.id,{[key]:value})}/>;
   let amount='—';try{amount=documentDraftTotals({...draft,items:[item]},'0').totalAmount.toFixed(2);}catch{}
   return <tr key={item.id} className="border-t border-slate-100 align-top hover:bg-slate-50/50"><td className="px-2 py-2 text-center text-slate-500">{index+1}</td><td className="px-2 py-2">{text('itemNo','货号')}</td><td className="px-2 py-2">{text('colorNo','色号')}</td><td className="px-2 py-2">{text('productName','品名')}{!sample&&manual&&<div className="mt-2 space-y-1">{([['composition','成分'],['weight','克重'],['width','门幅']] as const).map(([key,label])=><label key={key} className="block text-[10px] text-slate-500">{label}{text(key,label)}</label>)}</div>}{!sample&&!manual&&<span className="mt-1 block text-[10px] text-slate-500">{[item.composition,item.weight,item.width?item.width+' cm':''].filter(Boolean).join(' · ')}</span>}</td>
    {sample&&<><td className="px-2 py-2">{text('composition','成分')}</td><td className="px-2 py-2">{text('weight','克重')}</td><td className="px-2 py-2">{text('width','门幅')}</td></>}
    {sale&&<td className="px-2"><SalesPieceInputs value={item.rollNo??''} grossMeters={item.meters} disabled={disabled} onChange={patch=>onChange(item.id,patch)}/></td>}
    <td className="px-2 py-2">{numeric('meters','米数')}</td>{sale&&<td className="px-2 py-2">{numeric('deductionMeters','扣损米数')}</td>}<td className="px-2 py-2">{numeric('price','单价')}</td><td className="px-2 py-3 font-semibold tabular-nums" data-line-amount>{amount}</td><td className="px-2 py-2"><input aria-label="备注" className={field} disabled={disabled} value={item.remark} onChange={e=>onChange(item.id,{remark:e.target.value})}/></td>
    <td className="px-1 py-2"><div className="flex gap-1"><button type="button" className="rounded p-1.5 text-blue-700 hover:bg-blue-50" disabled={disabled} aria-label="更换产品" title="更换产品" onClick={()=>onReplace(item.id)}><ArrowLeftRight size={15}/></button><button type="button" className="rounded p-1.5 text-rose-700 hover:bg-rose-50" disabled={disabled} aria-label="删除明细" title="删除明细" onClick={()=>onRemove(item.id)}><Trash2 size={15}/></button></div></td></tr>;
  })}</tbody>
 </table>{!draft.items.length&&<p className="p-5 text-center text-sm text-slate-500">暂无明细，请从产品库添加。</p>}</div>;
}
