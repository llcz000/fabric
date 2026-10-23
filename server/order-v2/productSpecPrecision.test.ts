import assert from 'node:assert/strict';
import test from 'node:test';
import {assertActiveDocumentProduct,OrderLineError} from './lines';

function product(weight:string|null,width:string|null){
 const row={id:'1',product_no:'G01-1-F01',product_active:1,fabric_active:1,colorway_active:1,master_active:1,
  fabric_no:'F01',fabric_name:'Silk',composition:'100% silk',weight_value:weight,weight_unit:weight===null?null:'mm',width_value:width,colorway_no:1,master_no:'G01'};
 return {async query(){return [[row],[]] as [unknown,unknown];},async beginTransaction(){},async commit(){},async rollback(){},release(){}};
}
test('catalog selection and copy accept valid two-decimal specs including binary floating-point tails',async()=>{
 for(const [weight,width] of [['19.99','145.01'],['0.29','140.29'],['20.00','145.00'],['0','0'],['9999999999.99','9999999999.99'],[null,null]] as const)
  await assertActiveDocumentProduct(product(weight,width),'1');
});
test('catalog selection still rejects truly excessive decimal precision and non-finite specs',async()=>{
 for(const [weight,width] of [['19.999','145'],['20','145.001'],['NaN','145'],['20','Infinity'],['-1','145'],['20','-1'],['10000000000','145'],['20','10000000000'],['1e-7','145'],['20','1e21']])
  await assert.rejects(assertActiveDocumentProduct(product(weight,width),'1'),e=>e instanceof OrderLineError&&e.status===422);
});
