import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
import {lockSelectionAccess,selectionRows,selectionDbId,SampleSessionManualError} from './sessionManual';

export interface SelectionCard{
 id:string;cardNo:string;fabricName:string;composition:string|null;
 weightValue:string|null;weightUnit:'gsm'|'mm'|null;widthCm:string|null;
 products:{id:string;productNo:string;colorwayNo:number;patternNo:string;patternImageAssetId:string|null}[];
}
export interface SelectionCardPage{items:SelectionCard[];total:number;limit:number;offset:number}
export interface SelectionCardFilters{query:string;limit:number;offset:number;selected?:boolean}
export function parseSelectionCardFilters(raw:Record<string,unknown>):SelectionCardFilters{
 if(Object.keys(raw).some(k=>!['query','limit','offset','selected'].includes(k)))throw new SampleSessionManualError(400);
 if(raw.selected!==undefined&&raw.selected!=='true')throw new SampleSessionManualError(400);
 const query=raw.query??'';
 const number=(x:unknown,fallback:number)=>x===undefined?fallback:typeof x==='string'&&/^(0|[1-9]\d*)$/.test(x)?Number(x):NaN;
 const limit=number(raw.limit,20),offset=number(raw.offset,0);
 if(typeof query!=='string'||[...query].length>100||/[\p{Cc}\p{Cf}]/u.test(query)||
  !Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new SampleSessionManualError(400);
 return {query:query.trim(),limit,offset,...(raw.selected==='true'?{selected:true}:{})};
}
/** Session-scoped, QR-free candidates. An uncarded product can never enter this query. */
export async function searchSelectionCards(pool:SamplePool,actor:AppPrincipal,sessionId:string,filters:SelectionCardFilters):Promise<SelectionCardPage>{
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;await lockSelectionAccess(tx,actor,sessionId,false);
  const from=' FROM sample_cards c JOIN pattern_masters m ON m.id=c.master_id JOIN v2_fabrics f ON f.id=c.fabric_id';
  let where=` WHERE c.deleted_at IS NULL AND c.is_active=1 AND m.is_active=1 AND f.is_active=1
   AND EXISTS (SELECT 1 FROM sample_card_tokens t WHERE t.card_id=c.id AND t.revoked_at IS NULL)
   AND EXISTS (SELECT 1 FROM v2_products p JOIN pattern_colorways cw ON cw.id=p.pattern_colorway_id
    WHERE p.fabric_id=c.fabric_id AND cw.master_id=c.master_id AND p.is_active=1 AND cw.is_active=1 AND p.is_available_for_sampling=1)`;
  const args:unknown[]=[];
  if(filters.selected){
   where+=' AND EXISTS (SELECT 1 FROM customer_sample_selected_cards selected_card WHERE selected_card.session_id=? AND selected_card.card_id=c.id)';
   args.push(sessionId);
  }
  if(filters.query){
   where+=" AND (c.card_no LIKE ? ESCAPE '!' OR m.master_no LIKE ? ESCAPE '!' OR f.fabric_no LIKE ? ESCAPE '!' OR f.fabric_name LIKE ? ESCAPE '!')";
   const term='%'+filters.query.replace(/[!%_]/g,c=>'!'+c)+'%';args.push(term,term,term,term);
  }
  const [countRaw]=await tx.query('SELECT COUNT(*) AS total'+from+where,args);
  const total=Number(selectionRows(countRaw)[0]?.total);if(!Number.isSafeInteger(total)||total<0)throw new SampleSessionManualError(409);
  const [cardRaw]=await tx.query('SELECT c.id,c.card_no,f.fabric_name,f.composition,f.weight_value,f.weight_unit,f.width_value'+from+where+' ORDER BY c.card_no,c.id LIMIT ? OFFSET ?',[...args,filters.limit,filters.offset]);
  const items:SelectionCard[]=selectionRows(cardRaw).map(row=>{
   if(typeof row.card_no!=='string'||typeof row.fabric_name!=='string'||
    (row.weight_unit!==null&&row.weight_unit!=='gsm'&&row.weight_unit!=='mm'))throw new SampleSessionManualError(409);
   return {id:selectionDbId(row.id),cardNo:row.card_no,fabricName:row.fabric_name,composition:row.composition==null?null:String(row.composition),
    weightValue:row.weight_value==null?null:String(row.weight_value),weightUnit:row.weight_unit as SelectionCard['weightUnit'],widthCm:row.width_value==null?null:String(row.width_value),products:[]};
  });
  const byId=new Map(items.map(c=>[c.id,c]));if(byId.size!==items.length)throw new SampleSessionManualError(409);
  if(items.length){
   const [products]=await tx.query(`SELECT sc.id AS card_id,p.id,p.product_no,cw.colorway_no,
    CONCAT(m.master_no,'-',cw.colorway_no) AS pattern_no,cw.pattern_image_asset_id
    FROM sample_cards sc JOIN v2_products p ON p.fabric_id=sc.fabric_id
    JOIN pattern_masters m ON m.id=sc.master_id
    JOIN pattern_colorways cw ON cw.id=p.pattern_colorway_id AND cw.master_id=sc.master_id
    WHERE sc.id IN (${items.map(()=>'?').join(',')}) AND p.is_active=1 AND cw.is_active=1 AND p.is_available_for_sampling=1
    ORDER BY sc.id,cw.colorway_no,p.id`,items.map(c=>c.id));
   for(const row of selectionRows(products)){
    const card=byId.get(selectionDbId(row.card_id)),id=selectionDbId(row.id),colorwayNo=Number(row.colorway_no);
    if(!card||typeof row.product_no!=='string'||typeof row.pattern_no!=='string'||!row.pattern_no||
     (row.pattern_image_asset_id!=null&&typeof row.pattern_image_asset_id!=='string')||
     !Number.isSafeInteger(colorwayNo)||colorwayNo<1||card.products.some(p=>p.id===id))throw new SampleSessionManualError(409);
    card.products.push({id,productNo:row.product_no,colorwayNo,patternNo:row.pattern_no,patternImageAssetId:row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id)});
   }
   if(items.some(c=>!c.products.length))throw new SampleSessionManualError(409);
  }
  await tx.commit();began=false;return {items,total,limit:filters.limit,offset:filters.offset};
 }catch(error){if(began)await tx.rollback();throw error;}finally{tx.release();}
}
