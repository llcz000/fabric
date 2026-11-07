import {validatePatternDimensions} from '../../src/lib/patternDimensions';
export interface PatternDimensionImportRow {masterNo:string;widthCm:number;heightCm:number}
export function validateDimensionImportTarget(mode:string,database:string,serverUuid:string):void{
 const validDatabase=mode==='rehearse'?/^fabric_release_check_[a-f0-9]{16}$/.test(database):['apply','inspect'].includes(mode)&&database==='fabric_db';
 if(!validDatabase||!/^[a-f0-9-]{36}$/.test(serverUuid))throw Error('Explicit production or isolated rehearsal identity required');
}
export function mergePatternDimensionRows(source:unknown[][],corrections:unknown[][]):PatternDimensionImportRow[]{
 const header=source[0]??[],indices=['old','w_cm','h_cm'].map(key=>header.indexOf(key));
 if(indices.some(i=>i<0))throw Error('Missing source columns old/w_cm/h_cm');
 const groups=new Map<string,PatternDimensionImportRow[]>(),seen=new Set<string>();
 for(const r of source.slice(1)){
  if(r.every(c=>c==null||c===''))continue;
  const name=String(r[indices[0]]),match=/^(G\d+)-([1-9]\d*)\.(webp|png|jpe?g|gif)$/i.exec(name);
  if(!match)throw Error('Invalid pattern filename '+name);
  const key=match[1].toUpperCase(),color=key+'-'+Number(match[2]);
  if(seen.has(color))throw Error('Duplicate colorway '+color);seen.add(color);
  const d=validatePatternDimensions(r[indices[1]],r[indices[2]]);
  if(d.widthCm===null)throw Error('Missing dimensions '+name);
  const items=groups.get(key)??[];items.push({masterNo:key,widthCm:d.widthCm,heightCm:d.heightCm!});groups.set(key,items);
 }
 const conflicts=new Set([...groups].filter(([,rows])=>new Set(rows.map(r=>r.widthCm+'x'+r.heightCm)).size>1).map(([key])=>key));
 const fixed=new Map<string,PatternDimensionImportRow>();
 if(corrections.length){
  const h=corrections[0],cols=['花型号','确认宽（cm）','确认高（cm）'].map(k=>h.indexOf(k));
  if(cols.some(i=>i<0))throw Error('Missing correction columns');
  for(const r of corrections.slice(1)){
   if(r.every(c=>c==null||c===''))continue;
   const key=String(r[cols[0]]).trim().toUpperCase();
   if(fixed.has(key))throw Error('Duplicate correction '+key);
   if(!conflicts.has(key))throw Error('Unexpected correction '+key);
   const d=validatePatternDimensions(r[cols[1]],r[cols[2]]);
   if(d.widthCm===null)throw Error('Missing correction '+key);
   fixed.set(key,{masterNo:key,widthCm:d.widthCm,heightCm:d.heightCm!});
  }
 }
 for(const key of conflicts)if(!fixed.has(key))throw Error('Unresolved dimensions '+key);
 if(!groups.size)throw Error('No pattern dimensions');
 return [...groups].map(([key,rows])=>fixed.get(key)??rows[0]);
}
interface Connection{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>;beginTransaction():Promise<void>;commit():Promise<void>;rollback():Promise<void>;release():void}
export async function applyPatternDimensionImport(pool:{getConnection():Promise<Connection>},plan:PatternDimensionImportRow[]){
 if(!plan.length||new Set(plan.map(r=>r.masterNo)).size!==plan.length)throw Error('Empty or duplicate import plan');
 for(const row of plan){if(!/^G\d+$/.test(row.masterNo))throw Error('Invalid master number');validatePatternDimensions(row.widthCm,row.heightCm);if(row.widthCm==null)throw Error('Empty import dimensions');}
 const db=await pool.getConnection();let started=false;
 try{
  await db.beginTransaction();started=true;
  const [raw]=await db.query('SELECT id,master_no,width_cm,height_cm FROM pattern_masters WHERE deleted_at IS NULL AND master_no IN ('+plan.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',plan.map(r=>r.masterNo));
  if(!Array.isArray(raw))throw Error('Master inventory unavailable');
  const byNo=new Map<string,any>();for(const row of raw){if(byNo.has(row.master_no))throw Error('Ambiguous current master '+row.master_no);byNo.set(row.master_no,row);}
  const pending:PatternDimensionImportRow[]=[];
  for(const row of plan){const current=byNo.get(row.masterNo);if(!current)throw Error('Master not found '+row.masterNo);
   if(current.width_cm!=null||current.height_cm!=null){if(Number(current.width_cm)!==row.widthCm||Number(current.height_cm)!==row.heightCm)throw Error('Existing different dimensions '+row.masterNo);}
   else pending.push(row);
  }
  for(const row of pending){const [result]=await db.query('UPDATE pattern_masters SET width_cm=?,height_cm=? WHERE id=? AND deleted_at IS NULL AND width_cm IS NULL AND height_cm IS NULL',[row.widthCm,row.heightCm,String(byNo.get(row.masterNo).id)]);
   if(Number((result as {affectedRows:number}).affectedRows)!==1)throw Error('Dimension update count mismatch '+row.masterNo);
  }
  const [readback]=await db.query('SELECT id,master_no,width_cm,height_cm FROM pattern_masters WHERE deleted_at IS NULL AND master_no IN ('+plan.map(()=>'?').join(',')+') ORDER BY id',plan.map(r=>r.masterNo));
  if(!Array.isArray(readback)||readback.length!==plan.length)throw Error('Import readback count mismatch');
  const actual=new Map(readback.map(r=>[r.master_no,r]));
  for(const row of plan){const saved=actual.get(row.masterNo);if(!saved||Number(saved.width_cm)!==row.widthCm||Number(saved.height_cm)!==row.heightCm)throw Error('Import readback mismatch '+row.masterNo);}
  await db.commit();started=false;return {updated:pending.length,unchanged:plan.length-pending.length,total:plan.length};
 }catch(e){if(started)await db.rollback();throw e;}finally{db.release();}
}
