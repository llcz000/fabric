/** P5 isolated, XLSX-only two-phase preview/commit. No main server mounting. */
import {randomBytes} from 'node:crypto';
import type {AppPrincipal} from '../access/types';
import {canManageProducts} from '../access/policy';
import type {Pool} from '../order-v2/lines';
import {lockedFabricByNumber,withFabricImportTransaction,writeFabricImportRow,type Fabric} from './fabrics';
import {previewFabricXlsx,FabricExcelError,type ExistingFabric,type FabricExcelOptions,
 type FabricExcelPreview,type FabricPreviewLine} from './fabricExcelPreview';
export class FabricImportError extends Error{
 constructor(message:string,readonly status:400|401|403|409|503=400){super(message);}
}
type Query={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
type Status='created'|'updated'|'skipped'|'failed';
export interface ImportCommitResult{
 rows:{rowNumber:number;status:Status;reason:string;fabricNo:string|null}[];
 counts:{created:number;updated:number;skipped:number;failed:number};
}
export interface PreviewReply extends FabricExcelPreview{token:string;expiresInSeconds:number}
export type CommitRequest={token:string;confirm:true;updateRows:number[]};
interface Snapshot{
 token:string;owner:string;expires:number;preview:FabricExcelPreview;
}
const columns='id,fabric_no,fabric_name,composition,weight_value,weight_unit,width_value,remark,is_active';
const safeId=(raw:unknown):string=>{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw Error('Unsafe fabric id');
 const id=String(raw);
 if(!/^[1-9]\d{0,19}$/.test(id)||BigInt(id)>18446744073709551615n)throw Error('Invalid id');
 return id;
};
function dbFabric(data:Record<string,unknown>):ExistingFabric{
 return {id:safeId(data.id),fabricNo:String(data.fabric_no),fabricName:String(data.fabric_name),
  composition:data.composition===null?null:String(data.composition),
  weightValue:data.weight_value===null?null:Number(data.weight_value),
  weightUnit:data.weight_unit===null?null:data.weight_unit as 'mm'|'gsm',
  widthValue:data.width_value===null?null:Number(data.width_value),
  remark:data.remark===null?null:String(data.remark),isActive:Number(data.is_active)===1};
}
const equals=(a:ExistingFabric,b:Fabric):boolean=>
 a.id===b.id&&a.fabricNo===b.fabricNo&&a.fabricName===b.fabricName&&
 a.composition===b.composition&&a.weightValue===b.weightValue&&
 a.weightUnit===b.weightUnit&&a.widthValue===b.widthValue&&
 a.remark===b.remark&&a.isActive===b.isActive;
const owner=(p:AppPrincipal)=>p.userId+':'+p.sessionId;
/** Session and authorization are verified again even after HTTP Bearer middleware. */
async function livePermission(db:Query,actor:AppPrincipal):Promise<'admin'|'sales'>{
 if(!actor?.userId||!actor.sessionId)throw new FabricImportError('请先登录',401);
 let user:Record<string,unknown>|undefined;
 try{
  const [a]=await db.query('SELECT id,role,is_active,can_manage_products FROM v2_access_users WHERE id=?',[actor.userId]);
  user=(a as Record<string,unknown>[])[0];
  const [sessions]=await db.query(
   'SELECT id FROM v2_access_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP()',
   [actor.sessionId,actor.userId]);
  if(!user||!Array.isArray(sessions)||!sessions.length||Number(user.is_active)!==1||user.role!==actor.role)
   throw new FabricImportError('登录状态已发生变化',401);
 }catch(e){if(e instanceof FabricImportError)throw e;throw new FabricImportError('无法校验登录状态',503);}
 // Deprecated capability flags do not gate the two authenticated roles.
 const current={...actor,canManageProducts:true};
 if(!canManageProducts(current))throw new FabricImportError('没有面料导入权限',403);
 return current.role;
}
const validatedOptions=(input:FabricExcelOptions):FabricExcelOptions=>{
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(k=>!['filename','sheetName','headerRow','mapping','defaultWeightUnit'].includes(k)))
  throw new FabricImportError('无效导入参数');
 return {...input};
};
export function createFabricImportService(database:Query,pool:Pool){
 // One active preview per authenticated session. All rows and fingerprints live server-side.
 const sessions=new Map<string,Snapshot>();
 const ttl=15*60*1000;
 return {
  async preview(actor:AppPrincipal,file:Buffer,rawOptions:FabricExcelOptions):Promise<PreviewReply>{
   await livePermission(database,actor);
   const options=validatedOptions(rawOptions);
   // File options never include client-provided "existing" snapshots.
   const provisional=await previewFabricXlsx(file,options);
   const codes=[...new Set(provisional.rows.map(x=>x.fabricNoHint??x.fabric?.fabricNo)
    .filter((x):x is string=>!!x))];
   const existing:ExistingFabric[]=[];
   for(let i=0;i<codes.length;i+=200){
    const ids=codes.slice(i,i+200);
    const [found]=await database.query('SELECT '+columns+' FROM v2_fabrics WHERE fabric_no IN ('+
     ids.map(()=>'?').join(',')+')',ids);
    if(!Array.isArray(found))throw new FabricImportError('数据库结果无效',503);
    existing.push(...(found as Record<string,unknown>[]).map(dbFabric));
   }
   // To support missing required name for EXISTING rows, rerun using live server snapshots.
   const preview=await previewFabricXlsx(file,{...options,existing});
   const key=owner(actor);
   const token=randomBytes(32).toString('hex');
   sessions.set(key,{token,owner:key,preview,expires:Date.now()+ttl});
   return {...structuredClone(preview),token,expiresInSeconds:ttl/1000};
  },
  async commit(actor:AppPrincipal,raw:unknown):Promise<ImportCommitResult>{
   if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new FabricImportError('确认请求格式错误');
   const body=raw as Record<string,unknown>;
   if(Object.keys(body).some(x=>!['token','confirm','updateRows'].includes(x))||
    typeof body.token!=='string'||!/^[0-9a-f]{64}$/.test(body.token)||
    body.confirm!==true||!Array.isArray(body.updateRows)||
    body.updateRows.length>3000||body.updateRows.some(x=>!Number.isSafeInteger(x)||x<2||x>3000)||
    new Set(body.updateRows).size!==body.updateRows.length)
    throw new FabricImportError('请明确确认导入并选择合法行号');
   const key=owner(actor),saved=sessions.get(key);
   if(!saved||saved.token!==body.token||saved.expires<=Date.now())
    throw new FabricImportError('预览已失效，请重新选择文件预览',409);
   const selected=new Set(body.updateRows as number[]);
   const matching=new Map(saved.preview.rows.map(x=>[x.rowNumber,x]));
   for(const n of selected){
    const r=matching.get(n);
    if(!r||r.action!=='skip'||!r.existing||!r.fabric)
     throw new FabricImportError('只能选择预览中的已有面料更新行');
   }
   await livePermission(database,actor);
   // Both roles must explicitly select duplicate rows after preview. The
   // locked source fingerprint is still checked before every update.
   // Consume atomically before awaiting row writes; cannot submit same snapshot twice.
   sessions.delete(key);
   const result:ImportCommitResult={rows:[],counts:{created:0,updated:0,skipped:0,failed:0}};
   for(const row of saved.preview.rows){
    const selectedUpdate=selected.has(row.rowNumber);
    const name=row.fabric?.fabricNo??row.existing?.fabricNo??null;
    let status:Status='skipped',reason=row.reason;
    if(row.action==='error'){status='failed';}
    else if(row.action==='create'||selectedUpdate){
     try{
      if(!row.fabric)throw new FabricImportError('该行不能提交');
      const applied=await withFabricImportTransaction(pool,actor,async db=>{
       const live=await lockedFabricByNumber(db,row.fabric!.fabricNo);
       if(selectedUpdate){
        if(!live||!row.existing||!equals(row.existing,live))
         return 'stale' as const;
        await writeFabricImportRow(db,row.fabric as unknown as Record<string,unknown>,live);
        return 'updated' as const;
       }
       if(live)return 'conflict' as const;
       await writeFabricImportRow(db,row.fabric as unknown as Record<string,unknown>,null);
       return 'created' as const;
      });
      if(applied==='stale'){status='failed';reason='预览后原面料已变化，请重新预览并确认';}
      else if(applied==='conflict'){status='skipped';reason='预览后出现重复品号，请重新预览';}
      else{status=applied;reason=applied==='created'?'新增成功':'更新成功';}
     }catch(e){
      // Fail the affected row and continue only for expected uniqueness/domain conflicts.
      status='failed';
      const code=e&&typeof e==='object'?String((e as {code?:unknown}).code):'';
      reason=code==='ER_DUP_ENTRY'?'品号被并发创建，请重新预览':
       '该行写入失败或权限已变化，请重新预览';
     }
    }
    result.rows.push({rowNumber:row.rowNumber,status,reason,fabricNo:name});
    result.counts[status]++;
   }
   return result;
  }
 };
}
