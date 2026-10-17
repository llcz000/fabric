import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {mergeLegacyInventory,createV2InventoryRouter} from './v2Inventory';
test('cutover preserves existing inventory aggregation, including absent inputs and negative remaining stock',()=>{
 const data=mergeLegacyInventory([{product_name:'A',in_rolls:'2',in_meters:'10.50',remark:'库存备注'}],[{product_name:'A',out_rolls_sample:'1',out_rolls_sales:'2',out_meters_sample:'1',out_meters_sales:'12'},{product_name:'B',out_rolls_sample:1,out_rolls_sales:0,out_meters_sample:3,out_meters_sales:0}]);
 assert.equal(data[0].remaining_rolls,-1);assert.equal(data[0].remaining_meters,-2.5);assert.equal(data[1].remaining_meters,-3);assert.equal(data[0].remark,'库存备注');
});
test('inventory compatibility routes still require a real V2 session before any SQL',async()=>{
 let queries=0;const app=express();app.use('/api/inventory',createV2InventoryRouter({async query(){queries++;throw Error('unexpected');},async getConnection(){throw Error('unexpected');}}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{assert.equal((await fetch('http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/inventory/ledger')).status,401);assert.equal(queries,0);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
