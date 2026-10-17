import React,{useEffect,useState} from 'react';
import InventoryManager from '../InventoryManager';
import type {InventoryEntry,InventoryRecord} from '../../types';
export default function V2InventoryWorkspace({apiFetch}:{apiFetch:typeof fetch}){
 const [entries,setEntries]=useState<InventoryEntry[]>([]),[ledger,setLedger]=useState<InventoryRecord[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');
  Promise.all(['/api/inventory/entries','/api/inventory/ledger'].map(url=>apiFetch(url,{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error('库存读取失败');const value=await r.json();if(!Array.isArray(value))throw Error('库存资料无效');return value;}))).then(([incoming,summary])=>{
   if(abort.signal.aborted)return;
   setEntries(incoming.map(e=>({id:String(e.id),entryDate:String(e.entry_date??'').slice(0,10),productName:e.product_name??'',rolls:Number(e.rolls),meters:Number(e.meters),remark:e.remark??'',createdAt:String(e.created_at??'')})));
   setLedger(summary.map(r=>({productName:r.product_name??'',totalInRolls:Number(r.total_in_rolls),totalInMeters:Number(r.total_in_meters),totalOutRolls:Number(r.total_out_rolls),totalOutMeters:Number(r.total_out_meters),remainingRolls:Number(r.remaining_rolls),remainingMeters:Number(r.remaining_meters),remark:r.remark??''})));
  }).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();
 },[apiFetch,revision]);
 return <>{error&&<p role="alert" className="p-4 text-rose-700">{error} <button onClick={()=>setRevision(n=>n+1)}>重试</button></p>}
 <InventoryManager entries={entries} ledger={ledger} ledgerLoading={loading} onRefreshLedger={()=>setRevision(n=>n+1)} onSaveEntries={async values=>{
  const response=await apiFetch('/api/inventory/entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values.map(e=>({entry_date:e.entryDate,product_name:e.productName,rolls:e.rolls,meters:e.meters,remark:e.remark})))});if(!response.ok)throw Error('入库保存失败');setRevision(n=>n+1);
 }} onDeleteEntry={async id=>{const response=await apiFetch('/api/inventory/entries/'+id,{method:'DELETE'});if(!response.ok)throw Error('入库记录删除失败');setRevision(n=>n+1);}}/>
 </>;
}
