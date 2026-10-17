import {Router,json,type Response} from 'express';
import {requireV2Principal,requireV2Action,type AccessDatabase} from '../access/middleware';
import type {Pool} from './lines';

/** Third batch COMPANY-01: isolate V2 company editing from legacy /api/company,
 * but persist business text in the existing one-row company_config and signature
 * captions in an additive V2-only table. No schema changes on app startup.
 */
export interface V2CompanyPrintSettings{
 company_name:string;brand_name:string;address:string;phone:string;
 default_terms:string;deposit_terms:string;issuer_label:string;receiver_label:string;
}
type Sql={query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>};
const lengths:Record<keyof V2CompanyPrintSettings,number>={
 company_name:255,brand_name:255,address:500,phone:100,
 default_terms:10000,deposit_terms:10000,issuer_label:100,receiver_label:100
};
const labelDefault={issuer_label:'开单人签字',receiver_label:'收货人签字'};
export function parseCompanyPrintSettings(value:unknown):V2CompanyPrintSettings{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid company settings');
 const row=value as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!==Object.keys(lengths).sort().join(','))throw Error('Invalid company settings');
 for(const [name,length] of Object.entries(lengths)){
  const text=row[name];
  if(typeof text!=='string'||[...text].length>length||
    (name==='company_name'||name==='issuer_label'||name==='receiver_label')&&!text.trim())
   throw Error('Invalid company settings');
 }
 return row as unknown as V2CompanyPrintSettings;
}
function first(value:unknown):Record<string,unknown>{
 if(!Array.isArray(value)||value.length!==1||!value[0]||typeof value[0]!=='object')
  throw Error('Company settings unavailable');
 return value[0] as Record<string,unknown>;
}
export async function readV2CompanyPrintSettings(db:Sql):Promise<V2CompanyPrintSettings>{
 const [headers]=await db.query('SELECT company_name,brand_name,address,phone,default_terms,deposit_terms FROM company_config WHERE id=1 LIMIT 1');
 const row=first(headers);
 const [extra]=await db.query('SELECT issuer_label,receiver_label FROM v2_company_print_labels WHERE company_id=1 LIMIT 1');
 const labels=Array.isArray(extra)&&extra.length===1?extra[0] as Record<string,unknown>:labelDefault;
 const values={...row,...labelDefault,...labels};
 for(const key of Object.keys(lengths))if(values[key]==null)values[key]='';
 return parseCompanyPrintSettings(values);
}
export function createV2CompanyPrintSettingsRouter(db:AccessDatabase,pool:Pool):Router{
 const router=Router(),principal=requireV2Principal(db),write=requireV2Action('members.manage');
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 const error=(res:Response,e:unknown)=>res.status(e instanceof Error&&e.message==='Invalid company settings'?400:503)
  .json({error:e instanceof Error&&e.message==='Invalid company settings'?e.message:'Company settings unavailable'});
 router.get('/company-print-settings',principal,async(_req,res)=>{
  try{res.json(await readV2CompanyPrintSettings(db));}catch(e){error(res,e);}
 });
 router.patch('/company-print-settings',principal,write,json({limit:'48kb',strict:true}),async(req,res)=>{
  let data:V2CompanyPrintSettings;
  try{data=parseCompanyPrintSettings(req.body);}catch(e){error(res,e);return;}
  let tx:Awaited<ReturnType<Pool['getConnection']>>|undefined,active=false;
  try{
   tx=await pool.getConnection();await tx.beginTransaction();active=true;
   const [result]=await tx.query(
    'UPDATE company_config SET company_name=?,brand_name=?,address=?,phone=?,default_terms=?,deposit_terms=? WHERE id=1',
    [data.company_name,data.brand_name,data.address,data.phone,data.default_terms,data.deposit_terms]);
   if(Number((result as {affectedRows?:number}).affectedRows)>1)
    throw Error('Company settings cannot be updated');
   await tx.query('INSERT INTO v2_company_print_labels (company_id,issuer_label,receiver_label) VALUES (1,?,?) ON DUPLICATE KEY UPDATE issuer_label=VALUES(issuer_label),receiver_label=VALUES(receiver_label)',
    [data.issuer_label,data.receiver_label]);
   await tx.commit();active=false;
   res.json(data);
  }catch(e){if(active)await tx?.rollback();error(res,e);}
  finally{tx?.release();}
 });
 return router;
}
