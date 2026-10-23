import assert from 'node:assert/strict';
import test from 'node:test';
import {buildStatsUrl,loadDocumentStats,parseDocumentStats} from './documentStatsModel';

const payload={
 orderCount:3,metersTotal:35,amountTotal:350,
 pendingAmount:250,pendingCount:2,
 byType:{sample:{count:1,meters:10,amount:100},bulk:{count:1,meters:20,amount:250},deposit:{count:1,meters:5,contractAmount:700}},
 topProducts:[{productName:'棉麻布',meters:30}],
 recentOrders:[{id:'9007199254740993',orderNo:'XS-001',date:'2026-10-16',receivingUnit:'客户甲',type:'bulk',totalMeters:20,totalAmount:250}],
 compare:null
};
test('STATS-02 only sends date filters, never client owner or role',()=>{
 assert.equal(buildStatsUrl('2026-10-01','2026-10-17'),'/api/v2/documents/stats?from=2026-10-01&to=2026-10-17');
 assert.equal(buildStatsUrl('',''),'/api/v2/documents/stats');
 assert.throws(()=>buildStatsUrl('2026-11-10','2026-10-01'),/日期/);
 assert.throws(()=>buildStatsUrl('2026-02-31',''),/日期/);
});
test('STATS-01 server projections preserve bigint IDs as strings and distinct deposit contract amount',()=>{
 const data=parseDocumentStats(payload);
 assert.equal(data.recentOrders[0].id,'9007199254740993');
 assert.equal(data.byType.deposit.contractAmount,700);
 assert.equal(data.amountTotal,350);
});
test('STATS-02 malformed or excessive response cannot show cross-account or partial data',()=>{
 for(const bad of [
  {...payload,recentOrders:[{...payload.recentOrders[0],id:9007199254740993}]},
  {...payload,topProducts:[{productName:'坏数据',meters:-1}]},
  {...payload,recentOrders:Array.from({length:5},()=>payload.recentOrders[0])},
  {...payload,topProducts:Array.from({length:6},()=>payload.topProducts[0])},
  {...payload,byType:{...payload.byType,deposit:{count:1,meters:5,amount:700}}},
  {...payload,pendingAmount:-1},
  {...payload,compare:{...payload,orderCount:1.5}},
 ])assert.throws(()=>parseDocumentStats(bad),/统计/);
});
test('STATS-02 authenticated stats request has no cache, clears on access denial and does not fall back to local docs',async()=>{
 const calls:string[]=[];
 const response=async(url:string,init?:RequestInit)=>{
  calls.push(url);
  assert.equal(init?.cache,'no-store');
  assert.equal(init?.headers && (init.headers as Record<string,string>).Accept,'application/json');
  return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
 };
 const result=await loadDocumentStats(response as typeof fetch);
 assert.equal(result.topProducts[0].productName,'棉麻布');
 assert.deepEqual(calls,['/api/v2/documents/stats']);
 const denied=async()=>new Response('{}',{status:403});
 await assert.rejects(loadDocumentStats(denied as typeof fetch),/权限/);
});
