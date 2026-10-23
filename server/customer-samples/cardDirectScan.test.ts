import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import ExcelJS from 'exceljs';
import {hashSessionToken} from '../access/password';
import {createSampleCardLibraryRouter} from './cardLibraryRoutes';
import {buildSampleCardsWorkbook} from './cardExcel';
import {resolveSampleCardToken,SampleCardError} from './cardLibrary';
import {createHash} from 'node:crypto';
const token='Stable_card_token_0123456789_AbCd',bearer='a'.repeat(64);
const link='https://124.223.97.60/#/samples?scan=Stable_card_token_0123456789_AbCd';
const card={id:'11',masterId:'1',masterNo:'0012',fabricId:'2',fabricNo:'F018',cardNo:'0012-F018',description:'绢纺',composition:'100%真丝',weightValue:16,weightUnit:'mm' as const,widthValue:140,qrPayload:token,isActive:true};
test('Excel exports the same directly openable URL without changing its six text columns or stable card identity',async()=>{
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await buildSampleCardsWorkbook([card],'https://124.223.97.60'));
 const sheet=workbook.worksheets[0];assert.equal(sheet.columnCount,6);assert.equal(sheet.getCell('F2').value,link);
 assert.equal(sheet.getCell('A2').value,'0012-F018');assert.equal(sheet.getImages().length,0);assert.equal(card.qrPayload,token);
});
test('token lookup hashes the input, excludes retired/inactive/revoked cards and does not write data',async()=>{
 const calls:{sql:string;params:unknown[]}[]=[];
 const db={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{calls.push({sql,params});return [[],[]];}};
 await assert.rejects(resolveSampleCardToken(db,token),e=>e instanceof SampleCardError&&e.status===404);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].params,[createHash('sha256').update(token).digest('hex')]);
 assert.match(calls[0].sql,/c\.deleted_at IS NULL/);assert.match(calls[0].sql,/c\.is_active=1/);
 assert.match(calls[0].sql,/m\.is_active=1/);assert.match(calls[0].sql,/f\.is_active=1/);assert.match(calls[0].sql,/t\.revoked_at IS NULL/);
 assert.doesNotMatch(calls[0].sql,/INSERT|UPDATE|DELETE/);assert(!calls[0].sql.includes(token));
});
test('direct card resolution is private for both roles and list, create, Excel use a consistent trusted origin',async()=>{
 let active=true,role='admin',resolves=0;
 const db={async query(_sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{return [active&&params[0]===hashSessionToken(bearer)?[{user_id:'1',session_id:'3',username:'user',display_name:'用户',role,can_manage_own_orders:0,can_manage_products:0}]:[],[]];}};
 const deps={list:async()=>({items:[card],total:1,limit:50,offset:0}),create:async()=>({card,created:false}),selected:async()=>[card],retire:async()=>({id:'11',retired:true as const}),confirmReprinted:async()=>({id:'11',reprintRevision:'1',needsReprint:false as const}),resolve:async(value:string)=>{resolves++;assert.equal(value,token);return card;}};
 const app=express();app.use('/cards',createSampleCardLibraryRouter(db,deps,'https://124.223.97.60'));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const address=server.address();assert(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port+'/cards';
 const post=(body:unknown,auth=true)=>fetch(base+'/resolve',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
 try{
  assert.equal((await post({cardToken:token},false)).status,401);assert.equal(resolves,0);
  for(role of ['admin','sales']){const response=await post({cardToken:token});assert.equal(response.status,200);assert.equal((await response.json()).scanUrl,link);}
  assert.equal((await post({cardToken:token,sessionId:'7'})).status,400);assert.equal(resolves,2);
  const listed=await fetch(base,{headers:{authorization:'Bearer '+bearer,host:'untrusted.example'}});
  const item=(await listed.json()).items[0];assert.equal(item.qrPayload,token);assert.equal(item.scanUrl,link);
  active=false;assert.equal((await post({cardToken:token})).status,401);assert.equal(resolves,2);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
