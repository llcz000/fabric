export function PatternDimensionFields({width,height,onChange,disabled=false}:{width:string;height:string;onChange(width:string,height:string):void;disabled?:boolean}){
 return <fieldset disabled={disabled} className="flex min-w-0 flex-wrap items-end gap-2 text-xs">
  <legend className="mb-2 font-medium">花型尺寸（cm，全部配色共用）</legend>
  <label className="flex min-w-0 flex-col gap-1">宽度<input aria-label="花型宽度（cm）" inputMode="decimal" value={width}
   onChange={e=>onChange(e.target.value,height)} placeholder="未填写" className="w-28 max-w-full rounded border border-slate-300 bg-white px-2 py-1.5"/></label>
  <span className="pb-2 text-slate-500" aria-hidden="true">×</span>
  <label className="flex min-w-0 flex-col gap-1">高度<input aria-label="花型高度（cm）" inputMode="decimal" value={height}
   onChange={e=>onChange(width,e.target.value)} placeholder="未填写" className="w-28 max-w-full rounded border border-slate-300 bg-white px-2 py-1.5"/></label>
 </fieldset>;
}
