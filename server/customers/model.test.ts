import test from 'node:test';import assert from 'node:assert/strict';
import {parseCustomerProfile,parseContactFollowup,shanghaiToday,validCustomerId} from './model';
import {profile} from './customer.testFixture';
test('light profile preserves unknowns and zero, decimal strings and independent price bases',()=>{
 const input=profile(),v=parseCustomerProfile(input);assert.equal(v.invoiceTitle,null);assert.equal(v.prices[0].minPrice,'0');assert.equal(v.prices[0].maxPrice,'120.50');
 assert.equal(validCustomerId('9007199254740993'),true);assert.equal(validCustomerId('18446744073709551616'),false);
 const blank={...input,brands:[],prices:[],subjectType:'unknown',relationshipStage:'unknown',stageReason:null};assert.equal(parseCustomerProfile(blank).prices.length,0);
});
test('profile rejects inverted/rounded numeric price, malformed arrays',()=>{
 const p=profile();for(const v of [{...p,prices:[{...p.prices[0],minPrice:'121'}]},{...p,prices:[{...p.prices[0],maxPrice:1.25}]},{...p,prices:[{...p.prices[0],maxPrice:'1e3'}]},{...p,ownerUserId:'2'}])assert.throws(()=>parseCustomerProfile(v));
});
test('Shanghai today boundary and followup next-date validation do not invent overdue tasks',()=>{
 assert.equal(shanghaiToday(new Date('2026-10-20T15:59:59Z')),'2026-10-20');assert.equal(shanghaiToday(new Date('2026-10-20T16:00:00Z')),'2026-10-21');
 const f={requestId:'5b434d55-91eb-45c4-85d0-298ee0603d0d',contactedOn:'2026-10-20',feedback:null,outcome:'已联系',nextAction:null,nextFollowupOn:null};assert.equal(parseContactFollowup(f).nextFollowupOn,null);
 assert.throws(()=>parseContactFollowup({...f,nextFollowupOn:'2026-10-19',nextAction:'联系'}));assert.throws(()=>parseContactFollowup({...f,nextFollowupOn:'2026-10-21'}));assert.throws(()=>parseContactFollowup({...f,contactedOn:'2026-02-30'}));
});

test('contact details may be absent or name only and completed later',()=>{
 const p=profile();assert.deepEqual(parseCustomerProfile({...p,contacts:[]}).contacts,[]);assert.equal(parseCustomerProfile({...p,contacts:[{name:'小王',phone:null,wechat:null}]}).contacts[0].name,'小王');
});

test('fabric note is optional, trimmed, bounded and round trips independently of common fabrics',()=>{
 const p=profile();assert.equal(parseCustomerProfile(p).fabricNote,null);
 const saved=parseCustomerProfile({...p,commonFabricIds:['10','11'],fabricNote:'  优先真丝，避免偏硬  '});
 assert.equal(parseCustomerProfile(JSON.parse(JSON.stringify(saved))).fabricNote,'优先真丝，避免偏硬');
 assert.deepEqual(saved.commonFabricIds,['10','11']);
 assert.throws(()=>parseCustomerProfile({...p,fabricNote:'字'.repeat(401)}));
});
