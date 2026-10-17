import {Router,json} from 'express';
import {z} from 'zod';
import {requireV2Principal,type AccessDatabase} from '../access/middleware';
import type {Pool} from '../order-v2/lines';
import type {AppPrincipal} from '../access/types';
import {lockV2DocumentWriter,DocumentWriteError} from '../order-v2/documents';
type Row=Record<string,any>;
/** Existing inventory accounting is deliberately preserved; this is an authentication adapter, not STOCK-01 redesign. */
export function mergeLegacyInventory(incoming:Row[],outgoing:Row[]){
 const ins=new Map(incoming.map(r=>[r.product_name,{rolls:Number(r.in_rolls),meters:Number(r.in_meters),remark:r.remark||''}]));
 const outs=new Map(outgoing.map(r=>[r.product_name,{rolls:Number(r.out_rolls_sample)+Number(r.out_rolls_sales),meters:Number(r.out_meters_sample)+Number(r.out_meters_sales)}]));
 return [...new Set([...ins.keys(),...outs.keys()])].map(name=>{const i=ins.get(name)??{rolls:0,meters:0,remark:''},o=outs.get(name)??{rolls:0,meters:0};
  return {product_name:name,total_in_rolls:i.rolls,total_in_meters:i.meters,total_out_rolls:o.rolls,total_out_meters:o.meters,remaining_rolls:i.rolls-o.rolls,remaining_meters:i.meters-o.meters,remark:i.remark};
 }).sort((a,b)=>b.total_in_meters-a.total_in_meters);
}
export function createV2InventoryRouter(db:Pool&AccessDatabase){
 const routes=Router();routes.use(requireV2Principal(db));routes.use(json({limit:'100kb'}));routes.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const failure=(res:import('express').Response,error:unknown)=>res.status(error instanceof DocumentWriteError?error.status:503).json({error:'库存操作失败，请检查资料与权限'});
 routes.get('/entries',async(_req,res)=>{try{const [data]=await db.query('SELECT * FROM inventory_entries ORDER BY entry_date DESC,created_at DESC');if(!Array.isArray(data))throw Error('Invalid inventory');res.json(data);}catch(e){failure(res,e);}});
 routes.get('/ledger',async(_req,res)=>{try{
  const [incoming]=await db.query(`SELECT ie.product_name,SUM(ie.rolls) AS in_rolls,SUM(ie.meters) AS in_meters,
   (SELECT ie2.remark FROM inventory_entries ie2 WHERE ie2.product_name=ie.product_name ORDER BY ie2.created_at DESC LIMIT 1) AS remark
   FROM inventory_entries ie GROUP BY ie.product_name`);
  const [outgoing]=await db.query(`SELECT oi.product_name,
   SUM(CASE WHEN o.template_type='sample' THEN 1 ELSE 0 END) AS out_rolls_sample,
   SUM(CASE WHEN o.template_type='bulk' THEN 1 ELSE 0 END) AS out_rolls_sales,
   SUM(CASE WHEN o.template_type='sample' THEN oi.meters ELSE 0 END) AS out_meters_sample,
   SUM(CASE WHEN o.template_type='bulk' THEN oi.meters ELSE 0 END) AS out_meters_sales
   FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.template_type IN ('sample','bulk') GROUP BY oi.product_name`);
  if(!Array.isArray(incoming)||!Array.isArray(outgoing))throw Error('Invalid inventory');res.json(mergeLegacyInventory(incoming,outgoing));
 }catch(e){failure(res,e);}});
 const entry=z.object({entry_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),product_name:z.string().max(255).default(''),rolls:z.number().int().min(0).max(2147483647).default(0),meters:z.number().finite().min(0).max(9999999999.99).default(0),remark:z.string().max(500).default('')}).strict();
 routes.post('/entries',async(req,res)=>{
  const parsed=z.array(entry).min(1).safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid inventory entries'});return;}
  let connection:Awaited<ReturnType<Pool['getConnection']>>|undefined,active=false;
  try{connection=await db.getConnection();await connection.beginTransaction();active=true;await lockV2DocumentWriter(connection,res.locals.principal as AppPrincipal);
   for(const e of parsed.data)await connection.query('INSERT INTO inventory_entries(entry_date,product_name,rolls,meters,remark) VALUES(?,?,?,?,?)',[e.entry_date,e.product_name,e.rolls,e.meters,e.remark]);
   await connection.commit();active=false;res.json({success:true,count:parsed.data.length});
  }catch(error){if(active)await connection?.rollback();failure(res,error);}finally{connection?.release();}
 });
 routes.delete('/entries/:id',async(req,res)=>{
  const id=String(req.params.id);if(!/^[1-9]\d{0,9}$/.test(id)){res.status(400).json({error:'Invalid inventory entry'});return;}
  let connection:Awaited<ReturnType<Pool['getConnection']>>|undefined,active=false;
  try{connection=await db.getConnection();await connection.beginTransaction();active=true;await lockV2DocumentWriter(connection,res.locals.principal as AppPrincipal);
   const [result]=await connection.query('DELETE FROM inventory_entries WHERE id=?',[id]);if(Number((result as {affectedRows:unknown}).affectedRows)!==1)throw new DocumentWriteError('Inventory entry not found',404);
   await connection.commit();active=false;res.json({success:true});
  }catch(error){if(active)await connection?.rollback();failure(res,error);}finally{connection?.release();}
 });
 return routes;
}
