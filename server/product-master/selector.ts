/**
 * P6-1 V2 document product-picker query. No legacy products fallback.
 * All filters are server-owned, strictly bounded and parameterized.
 */
export interface SelectorDb{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>}
export interface SelectorFilters{productNo:string;fabricName:string;limit:number;offset:number}
export interface SelectableProduct{
 id:string;productNo:string;fabricName:string;masterNo:string;colorwayNo:number;
 composition:string|null;weight:number|null;weightUnit:'gsm'|'mm'|null;widthCm:number|null;
 patternImageAssetId:string|null;
}
export class SelectorQueryError extends Error{readonly status=400;constructor(message:string){super(message);}}
function textFilter(value:unknown,label:string,max:number):string{
 if(value===undefined)return '';
 if(typeof value!=='string'||value.length>max)throw new SelectorQueryError('Invalid '+label);
 return value.trim();
}
function pageInt(value:unknown,label:string,defaultValue:number,max:number,min:number):number{
 if(value===undefined)return defaultValue;
 if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||
   value.length>10||Number(value)<min||Number(value)>max)
   throw new SelectorQueryError('Invalid '+label);
 return Number(value);
}
export function parseSelectorQuery(input:Record<string,unknown>):SelectorFilters {
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(x=>!['productNo','fabricName','limit','offset'].includes(x)))
  throw new SelectorQueryError('Invalid selector parameters');
 return {
  productNo:textFilter(input.productNo,'productNo',160),
  fabricName:textFilter(input.fabricName,'fabricName',255),
  limit:pageInt(input.limit,'limit',20,50,1),
  offset:pageInt(input.offset,'offset',0,1000000,0)
 };
}
function escapeLike(value:string):string {
 return '%'+value.replace(/[\\%_]/g, x=>'\\'+x)+'%';
}
function strings(rows:unknown):Record<string,unknown>[] {
 if(!Array.isArray(rows))throw new Error('Selector response is not a row set');
 return rows as Record<string,unknown>[];
}
const JOIN=`FROM v2_products p
 JOIN pattern_colorways c ON c.id=p.pattern_colorway_id
 JOIN pattern_masters m ON m.id=c.master_id
 JOIN v2_fabrics f ON f.id=p.fabric_id
 WHERE p.is_active=1 AND f.is_active=1 AND c.is_active=1 AND m.is_active=1`;
export async function searchSelectableProducts(db:SelectorDb,filters:SelectorFilters):
 Promise<{items:SelectableProduct[];total:number;limit:number;offset:number}>{
 const predicates:string[]=[];const params:unknown[]=[];
 if(filters.productNo){predicates.push("p.product_no LIKE ? ESCAPE '\\\\'");params.push(escapeLike(filters.productNo));}
 if(filters.fabricName){predicates.push("f.fabric_name LIKE ? ESCAPE '\\\\'");params.push(escapeLike(filters.fabricName));}
 const clause=JOIN+(predicates.length?' AND '+predicates.join(' AND '):'');
 const [countRaw]=await db.query('SELECT COUNT(*) AS total '+clause,params);
 const total=Number(strings(countRaw)[0]?.total);
 if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid selector count');
 if(total===0)return {items:[],total,limit:filters.limit,offset:filters.offset};
 const [raw]=await db.query(`SELECT
  p.id,p.product_no,f.fabric_name,m.master_no,c.colorway_no,
  f.composition,f.weight_value,f.weight_unit,f.width_value,c.pattern_image_asset_id
  ${clause}
  ORDER BY p.product_no ASC, p.id ASC LIMIT ? OFFSET ?`,
  [...params,filters.limit,filters.offset]
 );
 const items:SelectableProduct[]=strings(raw).map(row=>({
  id:String(row.id),productNo:String(row.product_no),fabricName:String(row.fabric_name),
  masterNo:String(row.master_no),colorwayNo:Number(row.colorway_no),
  composition:row.composition==null?null:String(row.composition),
  weight:row.weight_value==null?null:Number(row.weight_value),
  weightUnit:row.weight_unit==null?null:row.weight_unit as 'gsm'|'mm',
  widthCm:row.width_value==null?null:Number(row.width_value),
  patternImageAssetId:row.pattern_image_asset_id==null?null:String(row.pattern_image_asset_id)
 }));
 return {items,total,limit:filters.limit,offset:filters.offset};
}
