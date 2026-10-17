import React,{useRef,useState} from 'react';
import {createLatestRequestGuard} from './catalogModel';
import {ArrowLeft,FileSpreadsheet,Upload} from 'lucide-react';
import {FabricLibraryV2} from './FabricLibraryV2';
import {
 fileAsBase64,previewFabricImport,commitFabricImport,formatFabricImportStatus,
 validateSelectedRows,type FabricImportPreview,type FabricImportResult,
 type FabricImportMapping
} from './fabricImportModel';

type ImportFilter='all'|'create'|'skip'|'error';
const fields=[
 ['fabricNo','品号'],['fabricName','品名'],['composition','成分'],['weightValue','克重'],
 ['weightUnit','克重单位'],['widthValue','门幅'],['remark','备注']
] as const;
export interface FabricImportPreviewTableProps{
 preview:FabricImportPreview;selected:number[];isAdmin:boolean;filter:ImportFilter;
 onToggle(rowNumber:number,checked:boolean):void;
}
export function FabricImportPreviewTable({preview,selected,isAdmin,filter,onToggle}:FabricImportPreviewTableProps){
 const rows=preview.rows.filter(r=>filter==='all'||r.action===filter);
 const fmt=(v:unknown)=>v===null||v===undefined||v===''?'—':String(v);
 return <div role="region" aria-label="面料导入预览横向滚动表格" tabIndex={0}
  className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-[#dde0ea] bg-white">
  <table className="w-full min-w-[920px] border-collapse text-left text-[11px] text-[#1e293b]">
   <thead className="border-b bg-[#f8fafc] text-slate-600">
    <tr>{['Excel行','品号','品名','成分','克重','门幅 / cm','处理','原因／确认'].map(h=>
     <th key={h} scope="col" className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>)}</tr>
   </thead>
   <tbody>{rows.map(row=>{
    const existing=row.existing;
    const checked=selected.includes(row.rowNumber);
    const status=checked?'更新':row.action==='create'?'新增':row.action==='error'?'失败':'跳过';
    const fabric=row.fabric;
    return <React.Fragment key={row.rowNumber}>
     <tr className="border-b border-slate-100 align-top hover:bg-[#f8fafc]">
      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{row.rowNumber}</td>
      <td className="whitespace-nowrap px-2 py-1.5 font-medium">{fabric?.fabricNo??row.fabricNoHint??'—'}</td>
      <td className="px-2 py-1.5">{fmt(fabric?.fabricName)}</td>
      <td className="px-2 py-1.5">{fmt(fabric?.composition)}</td>
      <td className="whitespace-nowrap px-2 py-1.5">
       {fabric?.weightValue==null?'—':fabric.weightValue+' '+fabric.weightUnit}</td>
      <td className="whitespace-nowrap px-2 py-1.5">{fmt(fabric?.widthValue)}</td>
      <td className="px-2 py-1.5">
       <span className={'inline-flex whitespace-nowrap rounded border border-current/10 px-2 py-0.5 '+(status==='失败'?'bg-rose-50 text-rose-700':
        status==='新增'?'bg-sky-50 text-sky-700':status==='更新'?'bg-amber-50 text-amber-700':
        'bg-slate-100 text-slate-500')}>{status}</span>
      </td>
      <td className="min-w-[225px] max-w-[290px] px-2 py-1.5">
       <span className="block text-slate-600">{row.reason}</span>
       {existing&&isAdmin&&fabric?<label className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-[#0053da]">
        <input type="checkbox" checked={checked} onChange={e=>onToggle(row.rowNumber,e.target.checked)}/>
        明确选择更新已有面料</label>:null}
      </td>
     </tr>
     {existing&&Object.keys(row.changes??{}).length>0?<tr className="border-b border-slate-100 bg-[#fafbff]">
      <td colSpan={8} className="px-2 pb-1.5 text-[11px] text-slate-500">
       <details><summary className="cursor-pointer">展开已有面料差异（{Object.keys(row.changes??{}).length}项）</summary>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
         {Object.entries(row.changes??{}).map(([k,v])=><div key={k}>
          <span className="font-semibold">{fields.find(([key])=>key===k)?.[1]??k}</span>：
          {fmt(v.from)} → {fmt(v.to)}
         </div>)}
        </div>
       </details>
      </td>
     </tr>:null}
    </React.Fragment>;
   })}</tbody>
  </table>
  {rows.length===0?<p className="p-8 text-center text-xs text-slate-500">当前分类没有数据</p>:null}
 </div>;
}
export interface FabricImportV2Props{
 apiFetch:typeof fetch;canManage:boolean;isAdmin:boolean;onCancel():void;onFinished?():void;
}
/** Standalone review slice. Production app navigation is intentionally unchanged. */
export function FabricImportV2({apiFetch,canManage,isAdmin,onCancel,onFinished}:FabricImportV2Props){
 const [file,setFile]=useState<File|null>(null);
 const [sheet,setSheet]=useState(''),[headerRow,setHeaderRow]=useState('1');
 const [defaultUnit,setDefaultUnit]=useState(''),[mapping,setMapping]=useState<FabricImportMapping>({});
 const [expanded,setExpanded]=useState(false);
 const [preview,setPreview]=useState<FabricImportPreview|null>(null);
 const [chosen,setChosen]=useState<number[]>([]);
 const [filter,setFilter]=useState<ImportFilter>('all');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [result,setResult]=useState<FabricImportResult|null>(null);
 const latest=useRef(createLatestRequestGuard());
 const invalidate=()=>{latest.current.cancel();setPreview(null);setChosen([]);setResult(null);setError('');setFilter('all');};
 const choose=(value:File|null)=>{
  invalidate();setFile(value);
  if(value&&!value.name.toLowerCase().endsWith('.xlsx'))setError('仅支持 .xlsx 文件，请先另存为 XLSX');
 };
 const showPreview=async()=>{
  if(!file||busy||!canManage)return;
  invalidate();const revision=latest.current.next();setBusy(true);
  try{
   if(!/^[1-9]\d*$/.test(headerRow)||Number(headerRow)>50)throw Error('表头行必须为1～50');
   const fileBase64=await fileAsBase64(file);
   const data=await previewFabricImport(apiFetch,fileBase64,{
    filename:file.name,...(sheet.trim()?{sheetName:sheet.trim()}:{}),headerRow:Number(headerRow),
    ...(defaultUnit?{defaultWeightUnit:defaultUnit as 'gsm'|'mm'}:{}),
    ...(Object.keys(mapping).length?{mapping}:{})
   });
   if(latest.current.isCurrent(revision))setPreview(data);
  }catch(e){if(latest.current.isCurrent(revision))setError(e instanceof Error?e.message:'Excel预览失败，请检查工作表和字段映射');}
  finally{setBusy(false);}
 };
 const toggle=(row:number,checked:boolean)=>setChosen(previous=>
  checked?[...previous,row]:previous.filter(x=>x!==row));
 const commit=async()=>{
  if(!preview||busy||!canManage)return;
  try{
   const updates=validateSelectedRows(preview,chosen,isAdmin);
   const intro='准备新增 '+preview.counts.create+' 条，明确更新 '+updates.length+
    ' 条；其余行跳过或标记失败。将再次检查数据库冲突，确认提交吗？';
   if(typeof window!=='undefined'&&!window.confirm(intro))return;
   setBusy(true);setError('');
   const response=await commitFabricImport(apiFetch,preview.token,updates);
   setResult(response);setPreview(null);setChosen([]);
   onFinished?.();
  }catch(e){setError(e instanceof Error?e.message:'导入失败，需重新预览');}
  finally{setBusy(false);}
 };
 return <section aria-label="V2 面料XLSX导入" className="min-h-[540px] bg-[#faf8ff] p-3 text-[#1e293b] sm:p-4">
  <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
   <div><h1 className="flex items-center gap-2 text-lg font-semibold"><FileSpreadsheet size={22}/>面料 XLSX 导入</h1>
    <p className="mt-1 text-xs text-slate-500">只支持 .xlsx · 七列模板 · 先预览确认，后写入面料库</p></div>
   <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-xs text-[#0053da]">
    <ArrowLeft size={14}/>返回面料库</button>
  </header>
  {!canManage?<p role="alert" className="rounded border p-4 text-rose-700">当前账号没有面料导入权限。</p>:
   <>
    <div className="rounded-lg border border-[#dde0ea] bg-white p-3">
     <label className="block text-xs font-semibold">选择 Excel 文件（仅 XLSX，最大 8 MB）
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
       aria-label="选择XLSX文件" disabled={busy} onChange={e=>choose(e.target.files?.[0]??null)}
       className="mt-1 block w-full rounded border border-slate-200 p-1.5 text-xs sm:max-w-[400px]"/></label>
     <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <label>工作表
       <input aria-label="工作表" value={sheet} disabled={busy} onChange={e=>{invalidate();setSheet(e.target.value);}}
        placeholder="默认：面料资料" className="ml-2 w-36 rounded border px-2 py-1.5"/></label>
      <label>表头行
       <input aria-label="表头行" type="number" min="1" max="50" value={headerRow} disabled={busy}
        onChange={e=>{invalidate();setHeaderRow(e.target.value);}}
        className="ml-2 w-16 rounded border px-2 py-1.5"/></label>
      <label>克重缺省单位
       <select aria-label="克重缺省单位" value={defaultUnit} disabled={busy}
        onChange={e=>{invalidate();setDefaultUnit(e.target.value);}}
        className="ml-2 rounded border px-2 py-1.5">
        <option value="">不猜测（推荐）</option><option value="gsm">gsm</option><option value="mm">mm / 姆米</option>
       </select></label>
      <button type="button" onClick={()=>setExpanded(x=>!x)} className="text-[#0053da] underline">
       {expanded?'收起':'展开'}字段来源确认</button>
     </div>
     {expanded?<div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-4">
      {fields.map(([key,label])=><label key={key} className="text-[11px]">
       {label}来源列（1～64）
       <input aria-label={label+'来源列'} type="number" min="1" max="64" disabled={busy}
        value={mapping[key]??''} onChange={e=>{
         invalidate();const col=e.target.value;
         setMapping(previous=>{const changed={...previous};
          if(!col)delete changed[key];else changed[key]=Number(col);
          return changed;});
        }} className="mt-1 block w-full rounded border px-2 py-1"/>
      </label>)}
     </div>:null}
     <button type="button" onClick={showPreview} disabled={!file||busy||!file.name.toLowerCase().endsWith('.xlsx')}
      className="mt-2 inline-flex items-center gap-1 rounded-md bg-[#346ef6] px-3 py-1.5 text-xs text-white disabled:opacity-40">
      <Upload size={15}/>{busy?'处理中…':'生成预览'}</button>
    </div>
    {error?<p role="alert" className="mt-3 rounded border border-rose-200 bg-white px-3 py-2 text-xs text-rose-700">{error}</p>:null}
    {preview?<div className="mt-3 space-y-2">
     <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-[11px]">预览：<strong>{preview.sheetName}</strong> ·
       新增 {preview.counts.create} · 默认跳过 {preview.counts.skip} · 错误 {preview.counts.error} ·
       管理员选中更新 {chosen.length}
       <span className="ml-2 text-[#0053da] sm:hidden">表格可左右滑动查看全部字段</span>
      </div>
      <div className="flex flex-wrap gap-1">
       {([['all','全部'],['create','新增'],['skip','跳过／待更新'],['error','失败']] as const).map(([key,label])=>
        <button type="button" key={key} onClick={()=>setFilter(key)}
         className={'rounded px-2 py-1 text-xs '+(filter===key?'bg-[#346ef6] text-white':'border bg-white text-slate-600')}>{label}</button>)}
      </div>
     </div>
     <FabricImportPreviewTable preview={preview} isAdmin={isAdmin} selected={chosen}
      onToggle={toggle} filter={filter}/>
     <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#dde0ea] bg-white/95 p-2.5 shadow-sm backdrop-blur-sm">
      <p className="text-xs text-slate-500">有效新增 {preview.counts.create} 条；
       更新 {chosen.length} 条。重复或错误行不会写入，预览后资料改变会被阻止。</p>
      <button type="button" onClick={commit} disabled={busy||preview.counts.create+chosen.length===0}
       className="rounded-md bg-[#346ef6] px-3 py-1.5 text-xs text-white disabled:opacity-40">
       {busy?'正在提交…':'确认导入'}</button>
     </footer>
    </div>:null}
    {result?<section className="mt-4 rounded-xl border bg-white p-4" aria-label="导入结果">
     <h2 className="text-sm font-semibold">导入处理完成</h2>
     <p className="mt-2 text-xs">新增 {result.counts.created} · 更新 {result.counts.updated} ·
      跳过 {result.counts.skipped} · 失败 {result.counts.failed}</p>
     <div className="mt-3 max-h-64 overflow-auto text-xs">
      {result.rows.map(r=><p className="border-b py-1" key={r.rowNumber}>Excel 第 {r.rowNumber} 行
       （{r.fabricNo??'无有效品号'}）：{formatFabricImportStatus(r.status)} — {r.reason}</p>)}
     </div>
    </section>:null}
   </>}
 </section>;
}
export function FabricWorkspaceV2({apiFetch,canManage=false,isAdmin=false,allowExport=true}:{
 apiFetch:typeof fetch;canManage?:boolean;isAdmin?:boolean;allowExport?:boolean;
}){
 const [importing,setImporting]=useState(false),[revision,setRevision]=useState(0);
 return importing?<FabricImportV2 apiFetch={apiFetch} canManage={canManage} isAdmin={isAdmin}
  onCancel={()=>setImporting(false)}
  onFinished={()=>setRevision(n=>n+1)}/>:
 <div>
  {canManage?<div className="flex justify-end bg-[#faf8ff] px-5 pt-3">
   <button type="button" onClick={()=>setImporting(true)}
    className="rounded-lg border border-[#346ef6] bg-white px-3 py-1.5 text-xs text-[#0053da]">
    导入 XLSX</button>
  </div>:null}
  <FabricLibraryV2 key={revision} apiFetch={apiFetch} canManage={canManage} allowExport={allowExport}/>
 </div>;
}
export default FabricImportV2;
