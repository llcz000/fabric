import {createHmac} from 'node:crypto';
import type {PatternCandidate,ColorwayCandidate,ProductCandidate,PreviewCandidate} from './publicPatternProjection';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const rows=(raw:unknown):Record<string,unknown>[]=>{if(!Array.isArray(raw)||raw.some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw Error('Public catalog unavailable');return raw as Record<string,unknown>[];};
const decimal=(v:unknown)=>{if(v===null)return null;const n=Number(v);if((typeof v!=='string'&&typeof v!=='number')||!Number.isFinite(n)||n<=0)throw Error('Public specification unavailable');return n;};
const text=(v:unknown,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Public specification unavailable');return v;};
/** Private loader: caller must first verify an issued active server publication record.
 * There is no client approval flag. Public projection strips all internal keys.
 */
export async function loadPatternShareCatalog(db:Db,masterId:string,secret:Uint8Array):Promise<{candidate:PatternCandidate;previews:Map<string,string>}|null>{
 if(!id(masterId)||secret.byteLength!==32||!secret.some(Boolean))throw Error('Public catalog configuration invalid');
 const [masterRaw]=await db.query('SELECT master_no,is_active FROM pattern_masters WHERE id=?',[masterId]);
 const masters=rows(masterRaw);if(masters.length!==1||masters[0].is_active!==1)return null;
 const candidate:PatternCandidate={patternNo:text(masters[0].master_no,64),isActive:true,isPublicApproved:true,colorways:[]},previews=new Map<string,string>();
 const [colorRaw]=await db.query('SELECT CAST(id AS CHAR) AS id,colorway_no,pattern_image_asset_id,is_active FROM pattern_colorways WHERE master_id=? AND is_active=1 ORDER BY colorway_no',[masterId]);
 const colors=new Map<string,{candidate:ColorwayCandidate;asset:unknown}>();
 for(const row of rows(colorRaw)){
  if(row.is_active!==1)continue;if(!id(row.id)||!Number.isSafeInteger(row.colorway_no)||Number(row.colorway_no)<1||colors.has(row.id))throw Error('Public colorway unavailable');
  const color:ColorwayCandidate={colorwayNumber:Number(row.colorway_no),isActive:true,isPublicApproved:true,designImages:[],products:[]};colors.set(row.id,{candidate:color,asset:row.pattern_image_asset_id});candidate.colorways.push(color);
 }
 const [productRaw]=await db.query('SELECT CAST(p.id AS CHAR) AS id,CAST(p.pattern_colorway_id AS CHAR) AS colorway_id,p.is_active,f.is_active AS fabric_is_active,f.fabric_no,f.fabric_name,f.composition,f.weight_value,f.weight_unit,f.width_value FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id JOIN v2_fabrics f ON f.id=p.fabric_id WHERE c.master_id=? AND c.is_active=1 AND p.is_active=1 AND f.is_active=1 ORDER BY c.colorway_no,f.fabric_no',[masterId]);
 const products=new Map<string,ProductCandidate>();
 for(const row of rows(productRaw)){
  if(row.is_active!==1||row.fabric_is_active!==1)continue;if(!id(row.id)||!id(row.colorway_id)||products.has(row.id))throw Error('Public product unavailable');
  const color=colors.get(row.colorway_id);if(!color)continue;
  if(!(row.composition===null||typeof row.composition==='string')||!(row.weight_unit===null||row.weight_unit==='gsm'||row.weight_unit==='mm'))throw Error('Public specification unavailable');
  const weightValue=decimal(row.weight_value);if((weightValue===null)!==(row.weight_unit===null))throw Error('Public specification unavailable');
  const product:ProductCandidate={isActive:true,isPublicApproved:true,fabric:{isActive:true,isPublicApproved:true,fabricNo:text(row.fabric_no,64),fabricName:text(row.fabric_name,255),composition:row.composition as string|null,weightValue,weightUnit:row.weight_unit as string|null,widthCm:decimal(row.width_value)},images:[]};products.set(row.id,product);color.candidate.products.push(product);
 }
 const [imageRaw]=await db.query(`SELECT CAST(c.id AS CHAR) AS colorway_id,NULL AS product_id,c.pattern_image_asset_id AS asset_id,'design' AS public_role,a.status AS asset_status,v.variant,v.byte_size,v.mime
 FROM pattern_colorways c JOIN image_assets a ON a.id=c.pattern_image_asset_id JOIN image_asset_variants v ON v.asset_id=a.id AND v.variant='display'
 WHERE c.master_id=? AND c.is_active=1 AND a.status='ready'
 UNION ALL SELECT CAST(c.id AS CHAR),CAST(p.id AS CHAR),i.asset_id,i.role,a.status,v.variant,v.byte_size,v.mime
 FROM v2_product_image_assets i JOIN v2_products p ON p.id=i.product_id JOIN pattern_colorways c ON c.id=p.pattern_colorway_id JOIN v2_fabrics f ON f.id=p.fabric_id JOIN image_assets a ON a.id=i.asset_id JOIN image_asset_variants v ON v.asset_id=a.id AND v.variant='display'
 WHERE c.master_id=? AND c.is_active=1 AND p.is_active=1 AND f.is_active=1 AND i.deleted_at IS NULL AND a.status='ready'
 ORDER BY colorway_id,product_id,public_role,asset_id`,[masterId,masterId]);
 for(const row of rows(imageRaw)){
  if(!id(row.colorway_id)||!uuid(row.asset_id)||row.asset_status!=='ready'||row.variant!=='display'||!['image/webp','image/jpeg','image/png'].includes(String(row.mime))||Number(row.byte_size)<=0||Number(row.byte_size)>5*1024*1024)continue;
  const color=colors.get(row.colorway_id);if(!color)continue;
  const role=row.public_role??row.role;
  const product=typeof row.product_id==='string'?products.get(row.product_id):undefined;
  const outputRole=role==='design'?'design':role==='fabric_display'?'display':role==='detail'?'detail':role==='ai_effect'?'effect':null;
  if(!outputRole||role==='design'&&(row.product_id!==null||color.asset!==row.asset_id)||role!=='design'&&!product)continue;
  const ref='display:'+createHmac('sha256',secret).update('fabric:public-preview:v1\0'+masterId+':'+row.colorway_id+':'+String(row.product_id)+':'+row.asset_id+':'+String(role)).digest('base64url');
  const image:PreviewCandidate={kind:'display',role:outputRole,isActive:true,isPublicApproved:true,previewRef:ref};
  if(role==='design')color.candidate.designImages!.push(image);else product!.images!.push(image);previews.set(ref,row.asset_id);
 }
 return {candidate,previews};
}
