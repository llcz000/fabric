import type {AppPrincipal} from '../access/types';
import type {Pool} from './lines';
import {DocumentWriteError,lockV2DocumentWriter} from './documents';
import {parseScopedOrderFilters} from './orderQueries';
/** Reserves a draft number durably; abandoned drafts may leave gaps. No saved number is reassigned. */
export async function reserveV2DocumentNumber(pool:Pool,actor:AppPrincipal,input:unknown):Promise<string>{
 const body=input as {type?:unknown;date?:unknown};
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['type','date'].includes(k))||!['sample','bulk','deposit'].includes(String(body.type)))throw new DocumentWriteError('Invalid document number request');
 const date=parseScopedOrderFilters({from:body.date}).from;
 if(!date)throw new DocumentWriteError('Invalid document date');
 const type=body.type as 'sample'|'bulk'|'deposit',prefix=({sample:'YB',bulk:'XS',deposit:'DJ'}[type])+'-'+date.replaceAll('-','')+'-';
 const connection=await pool.getConnection();let begun=false;
 try{
  await connection.beginTransaction();begun=true;await lockV2DocumentWriter(connection,actor);
  await connection.query('INSERT INTO v2_document_number_counters(document_type,document_date,next_number) VALUES (?,?,1) ON DUPLICATE KEY UPDATE next_number=next_number',[type,date]);
  const [counter]=await connection.query('SELECT next_number FROM v2_document_number_counters WHERE document_type=? AND document_date=? FOR UPDATE',[type,date]);
  const [saved]=await connection.query('SELECT COALESCE(MAX(CAST(SUBSTRING(order_no,?) AS UNSIGNED)),0) AS highest FROM orders WHERE order_no REGEXP ?',[prefix.length+1,'^'+prefix+'[0-9]+$']);
  if(!Array.isArray(counter)||counter.length!==1||!Array.isArray(saved)||saved.length!==1)throw Error('Counter metadata unavailable');
  const current=BigInt(counter[0].next_number),historical=BigInt(saved[0].highest)+1n,number=current>historical?current:historical;
  if(number<1n||number>=18446744073709551615n)throw Error('Document number range exhausted');
  await connection.query('UPDATE v2_document_number_counters SET next_number=? WHERE document_type=? AND document_date=?',[(number+1n).toString(),type,date]);
  await connection.commit();begun=false;return prefix+number.toString().padStart(3,'0');
 }catch(error){if(begun)await connection.rollback();throw error;}finally{connection.release();}
}
