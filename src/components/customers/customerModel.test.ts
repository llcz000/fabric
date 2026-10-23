import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyCustomerProfile,prepareCustomerProfile,createCustomerClient} from './customerModel';
test('quick profile requires name only; contact details can be added later',()=>{
 const p=emptyCustomerProfile();assert.throws(()=>prepareCustomerProfile(p),/名称/);p.displayName=' 客户 ';assert.deepEqual(prepareCustomerProfile(p).contacts,[]);
 p.contacts=[{name:'',phone:null,wechat:' abc '}];assert.equal(prepareCustomerProfile(p).contacts[0].wechat,'abc');
});
test('prices retain decimal strings, empty bounds stay unknown and inverted ranges fail',()=>{
 const p={...emptyCustomerProfile(),displayName:'客户',contacts:[{name:'',phone:'123',wechat:null}],prices:[{fabricCategory:'棉',minPrice:'12.300',maxPrice:null,currency:'CNY',unit:'metre' as const,taxBasis:'unknown' as const,remark:null}]};
 assert.equal(prepareCustomerProfile(p).prices[0].minPrice,'12.300');assert.equal(prepareCustomerProfile(p).prices[0].maxPrice,null);
 p.prices[0].maxPrice='1';assert.throws(()=>prepareCustomerProfile(p),/上限/);p.prices[0].minPrice='-1';assert.throws(()=>prepareCustomerProfile(p),/非负/);
});
test('same uncertain create payload reuses requestId and changed payload gets another key',async()=>{
 const bodies:any[]=[];const api=createCustomerClient(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));if(bodies.length===1)throw Error('lost');return Response.json({id:'1'});});
 const p={...emptyCustomerProfile(),displayName:'客户',contacts:[{name:'',phone:'123',wechat:null}]};
 await assert.rejects(()=>api.create(p));await api.create(p);assert.equal(bodies[0].requestId,bodies[1].requestId);
 await api.create({...p,displayName:'另一客户'});assert.notEqual(bodies[1].requestId,bodies[2].requestId);
});
test('directory omits empty enum filters instead of sending invalid channel/tier/stage',async()=>{
 let url='';const api=createCustomerClient(async input=>{url=String(input);return Response.json({items:[],total:0,limit:20,offset:0});});await api.list({query:'',channel:'',tier:'',stage:'',waiting:'false'});const q=new URL(url,'http://localhost').searchParams;assert.equal(q.has('channel'),false);assert.equal(q.has('tier'),false);assert.equal(q.has('stage'),false);assert.equal(q.get('waiting'),'false');
});
