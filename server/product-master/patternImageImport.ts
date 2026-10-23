/** Exact-number import creates missing identities or replaces an existing image.
 * Deleted numbers may be explicitly reused; automatic allocation stays monotonic.
 * Identity, image reference counts and counter commit in one transaction. */
import type {AppPrincipal} from '../access/types';
import {withCatalogTransaction} from '../access/catalogTransaction';
import type {Pool} from '../order-v2/lines';
import {PatternMasterError} from './patternMasters';
import {replacePatternImage,ColorwayIdentityError} from './colorwayIdentity';

type Query={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ID=18446744073709551615n;
function dbId(raw:unknown):string{
 if(typeof raw==='number'&&!Number.isSafeInteger(raw))throw Error('Unsafe database ID');
 const value=String(raw);
 if(!/^[1-9]\d{0,19}$/.test(value)||BigInt(value)>MAX_ID)throw Error('Invalid database ID');
 return value;
}
function rows(raw:unknown):Record<string,unknown>[]{
 if(!Array.isArray(raw)||raw.some(x=>!x||typeof x!=='object'||Array.isArray(x)))
  throw Error('Invalid database rows');
 return raw as Record<string,unknown>[];
}
export interface PatternImageImportInput{
 masterNo:string;colorwayNo:number;patternImageAssetId:string
}
function validate(raw:unknown):PatternImageImportInput{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new PatternMasterError('Invalid image import');
 const body=raw as Record<string,unknown>;
 if(Object.keys(body).length!==3||!Object.hasOwn(body,'masterNo')||
  !Object.hasOwn(body,'colorwayNo')||!Object.hasOwn(body,'patternImageAssetId')||
  typeof body.masterNo!=='string'||!/^[A-Z0-9]{1,64}$/.test(body.masterNo)||
  !Number.isSafeInteger(body.colorwayNo)||Number(body.colorwayNo)<1||
  Number(body.colorwayNo)>4294967295||
  typeof body.patternImageAssetId!=='string'||!uuid.test(body.patternImageAssetId))
  throw new PatternMasterError('Invalid image import identity');
 return body as unknown as PatternImageImportInput;
}
function translateError(error:unknown):never{
 if(error instanceof ColorwayIdentityError)throw new PatternMasterError(error.message,error.status);
 if(error&&typeof error==='object'){
  const code=String((error as {code?:unknown}).code);
  if(code==='ER_DUP_ENTRY')throw new PatternMasterError('Pattern import changed concurrently; refresh and try again',409);
  if(['ER_ROW_IS_REFERENCED','ER_ROW_IS_REFERENCED_2'].includes(code))
   throw new PatternMasterError('Pattern import conflicts with references',409);
 }
 throw error;
}
export async function importPatternImageAsColorway(pool:Pool,actor:AppPrincipal,raw:unknown):
 Promise<{masterId:string;colorwayId:string;masterNo:string;colorwayNo:number;patternNo:string}>{
 const input=validate(raw);
 try{
  return await withCatalogTransaction(pool,actor,(message,status)=>new PatternMasterError(message,status),
   'Insufficient product permissions',async(db:Query)=>{
    const [existing]=await db.query(
     'SELECT id,master_no,next_colorway_no FROM pattern_masters WHERE master_no=? AND deleted_at IS NULL FOR UPDATE',[input.masterNo]);
    const matches=rows(existing);
    if(matches.length>1)throw Error('Duplicate master identity');
    let masterId:string,next:bigint;
    if(matches.length){
     masterId=dbId(matches[0].id);
     const rawNext=String(matches[0].next_colorway_no);
     if(!/^[1-9]\d*$/.test(rawNext))throw Error('Invalid saved colorway counter');
     next=BigInt(rawNext);
    }else{
     const [created]=await db.query('INSERT INTO pattern_masters(master_no) VALUES (?)',[input.masterNo]);
     masterId=dbId((created as {insertId:unknown}).insertId);
     next=1n;
    }
    const [currentRaw]=await db.query(
     'SELECT id,pattern_image_asset_id FROM pattern_colorways WHERE master_id=? AND colorway_no=? FOR UPDATE',
     [masterId,input.colorwayNo]);
    const current=rows(currentRaw);
    if(current.length>1)throw Error('Duplicate colorway identity');
    let colorwayId:string,previous:string|null=null;
    if(current.length){
     colorwayId=dbId(current[0].id);
     previous=current[0].pattern_image_asset_id==null?null:String(current[0].pattern_image_asset_id);
    }else{
     const [inserted]=await db.query(
      'INSERT INTO pattern_colorways(master_id,colorway_no,remark,is_active) VALUES (?,?,?,?)',
      [masterId,input.colorwayNo,'',1]);
     colorwayId=dbId((inserted as {insertId:unknown}).insertId);
    }
    // Keep product references, tags, remarks and activation state on replacement.
    await replacePatternImage(db,colorwayId,previous,input.patternImageAssetId);
    const allocated=BigInt(input.colorwayNo)+1n;
    if(allocated>next){
     const [updated]=await db.query('UPDATE pattern_masters SET next_colorway_no=? WHERE id=?',
      [String(allocated),masterId]);
     if(Number((updated as {affectedRows?:number}).affectedRows)!==1)throw Error('Import counter update failed');
    }
    return {masterId,colorwayId,masterNo:input.masterNo,colorwayNo:input.colorwayNo,
     patternNo:input.masterNo+'-'+input.colorwayNo};
   });
 }catch(error){return translateError(error);}
}
