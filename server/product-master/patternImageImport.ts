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
type ImportTarget={masterNo:string;colorwayNo:number};
type ExistingColorway={id:string;imageId:string|null};
export interface PatternImageImportInput extends ImportTarget{
 patternImageAssetId:string;
 expectedColorway?:ExistingColorway|null;
}
function validTarget(raw:unknown):raw is ImportTarget{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const value=raw as ImportTarget;
 return typeof value.masterNo==='string'&&/^[A-Z0-9]{1,64}$/.test(value.masterNo)&&
  Number.isInteger(value.colorwayNo)&&value.colorwayNo>=1&&value.colorwayNo<=4294967295;
}
export async function previewPatternImageImports(db:Query,raw:unknown):Promise<{items:(ImportTarget&ExistingColorway)[]}>{
 if(!Array.isArray(raw)||!raw.length||raw.length>100||!raw.every(value=>validTarget(value)&&Object.keys(value).length===2))
  throw new PatternMasterError('Invalid image import preview');
 const targets=raw as ImportTarget[];
 const [found]=await db.query(
  'SELECT m.master_no,c.colorway_no,c.id,c.pattern_image_asset_id FROM pattern_masters m '+
  'JOIN pattern_colorways c ON c.master_id=m.id WHERE m.deleted_at IS NULL AND (m.master_no,c.colorway_no) IN ('+
  targets.map(()=>'(?,?)').join(',')+')',
  targets.flatMap(target=>[target.masterNo,target.colorwayNo]));
 return {items:rows(found).map(row=>({masterNo:String(row.master_no),colorwayNo:Number(row.colorway_no),
  id:dbId(row.id),imageId:row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id)}))};
}
function validate(raw:unknown):PatternImageImportInput{
 if(!validTarget(raw))throw new PatternMasterError('Invalid image import identity');
 const body=raw as PatternImageImportInput;
 if(Object.keys(body).some(key=>!['masterNo','colorwayNo','patternImageAssetId','expectedColorway'].includes(key))||
  typeof body.patternImageAssetId!=='string'||!uuid.test(body.patternImageAssetId))
  throw new PatternMasterError('Invalid image import identity');
 const expected=body.expectedColorway;
 if(expected!==undefined&&expected!==null){
  if(typeof expected!=='object'||Object.keys(expected).length!==2||
   typeof expected.id!=='string'||!/^[1-9]\d{0,19}$/.test(expected.id)||BigInt(expected.id)>MAX_ID||
   !(expected.imageId===null||typeof expected.imageId==='string'&&uuid.test(expected.imageId)))
   throw new PatternMasterError('Invalid expected colorway');
 }
 return body;
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
    const expected=input.expectedColorway;
    if(expected===null&&current.length||expected&&(!current.length||
      dbId(current[0].id)!==expected.id||(current[0].pattern_image_asset_id??null)!==expected.imageId))
     throw new PatternMasterError('Colorway changed since import preview',409);
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
