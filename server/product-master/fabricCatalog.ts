import {listFabrics,type Fabric} from './fabrics';

/** P4-3 fabric list-only contract. Unmounted V2 router, no legacy fallback. */
export class FabricCatalogError extends Error{
 readonly status=400;
 constructor(message:string){super(message);}
}
export interface FabricCatalogQuery{
 query:string;includeInactive:boolean;limit:number;offset:number;
}
export interface FabricCatalogItem extends Fabric{productCount:number}
export interface FabricCatalogPage{
 items:FabricCatalogItem[];total:number;limit:number;offset:number;
}
type Query={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
type Row=Record<string,unknown>;
const bigint=(v:unknown):string=>{
 if(typeof v==='number'&&!Number.isSafeInteger(v))throw Error('Unsafe fabric identity');
 const s=String(v);
 if(!/^[1-9]\d{0,19}$/.test(s)||BigInt(s)>18446744073709551615n)
  throw Error('Invalid fabric identity');
 return s;
};
const rows=(raw:unknown):Row[]=>{
 if(!Array.isArray(raw))throw Error('Invalid fabric rows');return raw as Row[];
};
const numeric=(x:unknown,name:string,defaultValue:number,min:number,max:number):number=>{
 if(x===undefined)return defaultValue;
 if(typeof x!=='string'||! /^(0|[1-9]\d*)$/.test(x)||x.length>10||
  !Number.isSafeInteger(Number(x))||Number(x)<min||Number(x)>max)
  throw new FabricCatalogError('Invalid '+name);
 return Number(x);
};
/** Only the approved free-text (number/name/composition) and inactive toggle. */
export function parseFabricCatalogQuery(raw:unknown):FabricCatalogQuery{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new FabricCatalogError('Invalid filters');
 const query=raw as Record<string,unknown>;
 if(Object.keys(query).some(x=>!['query','includeInactive','limit','offset'].includes(x)))
  throw new FabricCatalogError('Unexpected fabric filter');
 if(query.query!==undefined&&(typeof query.query!=='string'||
  [...query.query].length>100||/[\p{Cc}\p{Cf}]/u.test(query.query)))
  throw new FabricCatalogError('Invalid fabric search');
 if(query.includeInactive!==undefined&&query.includeInactive!=='true')
  throw new FabricCatalogError('Invalid inactive filter');
 return {query:(query.query as string|undefined)?.trim()??'',
  includeInactive:query.includeInactive==='true',
  limit:numeric(query.limit,'limit',50,1,100),
  offset:numeric(query.offset,'offset',0,0,1000000)};
}
function filter(input:FabricCatalogQuery):{where:string;params:unknown[]}{
 const terms:string[]=['1=1'],params:unknown[]=[];
 if(!input.includeInactive)terms.push('is_active=1');
 if(input.query){
  const escaped='%'+input.query.replace(/[!%_]/g,c=>'!'+c)+'%';
  terms.push("(fabric_no LIKE ? ESCAPE '!' OR fabric_name LIKE ? ESCAPE '!' OR composition LIKE ? ESCAPE '!')");
  params.push(escaped,escaped,escaped);
 }
 return {where:' WHERE '+terms.join(' AND '),params};
}
export async function searchFabricCatalog(db:Query,input:FabricCatalogQuery):Promise<FabricCatalogPage>{
 const f=filter(input);
 const [rawCount]=await db.query('SELECT COUNT(*) AS total FROM v2_fabrics'+f.where,f.params);
 const count=rows(rawCount)[0]?.total;
 if(!/^\d+$/.test(String(count))||!Number.isSafeInteger(Number(count)))
  throw Error('Invalid fabric search count');
 const total=Number(count);
 if(total===0||input.offset>=total)return {items:[],total,limit:input.limit,offset:input.offset};
 const page=await listFabrics(db,input); // Existing P3-3 query exactly matches where/filter above.
 if(page.length>input.limit)throw Error('Excessive fabric result page');
 if(!page.length)return {items:[],total,limit:input.limit,offset:input.offset};
 const ids=page.map(x=>bigint(x.id));
 const [rawLinks]=await db.query('SELECT fabric_id AS owner_id,COUNT(*) AS linked_count '+
  'FROM v2_products WHERE fabric_id IN ('+ids.map(()=>'?').join(',')+') GROUP BY fabric_id',ids);
 const known=new Set(ids),linked=new Map<string,number>();
 for(const row of rows(rawLinks)){
  const id=bigint(row.owner_id),value=Number(row.linked_count);
  if(!known.has(id)||!Number.isSafeInteger(value)||value<0)throw Error('Invalid fabric product count');
  linked.set(id,value);
 }
 return {items:page.map(x=>({...x,productCount:linked.get(x.id)??0})),
  total,limit:input.limit,offset:input.offset};
}
