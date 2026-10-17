import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createSampleSessionManualRouter} from './sessionManualRoutes';
import {CardSelectionFixture} from './sessionCardSelection.testFixture';

test('private card search pages cards and exposes only eligible card-contained products, with no QR payload',async()=>{
 const db=new CardSelectionFixture();const pool={async getConnection(){const tx=await db.getConnection();const query=tx.query;
  tx.query=async(sql:string,args:unknown[]=[])=>{
   if(sql.includes('COUNT(*) AS total')&&sql.includes('FROM sample_cards'))return [[{total:21}],[]];
   if(sql.includes('c.card_no')&&sql.includes('FROM sample_cards')){
    assert(sql.includes('c.deleted_at IS NULL'));assert(sql.includes('c.is_active=1'));assert(sql.includes('m.is_active=1'));assert(sql.includes('f.is_active=1'));
    assert(args.includes('%棉!%!_%'),'literal wildcard escaping');
    return [[{id:'44',card_no:'0012-F018',fabric_name:'棉麻',composition:null,weight_value:'180',weight_unit:'gsm',width_value:'145',master_id:'12',fabric_id:'18'}],[]];
   }
   if(sql.includes('SELECT sc.id AS card_id')){
    assert(sql.includes('p.is_available_for_sampling=1'));assert(sql.includes('cw.is_active=1'));
    return [[{card_id:'44',id:'8',product_no:'0012-1-F018',colorway_no:1,pattern_no:'0012-1',pattern_image_asset_id:'dddddddd-4444-4444-8444-444444444444'},
     {card_id:'44',id:'9',product_no:'0012-2-F018',colorway_no:2,pattern_no:'0012-2',pattern_image_asset_id:null}],[]];
   }
   return query(sql,args);
  };return tx;}};
 let authorized=true;
 const app=express();app.use('/api/v2/customer-samples',createSampleSessionManualRouter((_req,res,next)=>{
  if(!authorized){res.status(401).end();return;}
  res.locals.principal={userId:'6',sessionId:'1',role:'sales'};next();
 },pool));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const address=server.address();assert(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/v2/customer-samples/sessions/11/cards`;
 try{
  let response=await fetch(url+'?query='+encodeURIComponent('棉%_')+'&limit=20&offset=20');assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.total,21);assert.equal(result.offset,20);
  assert.equal(result.items[0].cardNo,'0012-F018');assert.deepEqual(result.items[0].products.map((x:{id:string})=>x.id),['8','9']);assert(!JSON.stringify(result).includes('qrPayload'));
  assert.equal(result.items[0].products[0].patternNo,'0012-1');
  assert.equal(result.items[0].products[0].patternImageAssetId,'dddddddd-4444-4444-8444-444444444444');
  assert.equal(result.items[0].products[1].patternImageAssetId,null);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  for(const suffix of ['?limit=101','?productNo=x','?offset=-1','?query=a&query=b'])assert.equal((await fetch(url+suffix)).status,400);
  db.grant=false;assert.equal((await fetch(url)).status,404);db.grant=true;
  authorized=false;assert.equal((await fetch(url)).status,401);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
