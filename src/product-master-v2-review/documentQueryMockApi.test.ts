import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentQueryReviewApi} from './documentQueryMockApi';
import {parseDocumentStats} from '../components/document-product-selector/documentStatsModel';
test('STATS review data respects sales/admin scope, dates and refuses owner override',async()=>{
 const sales=createDocumentQueryReviewApi('sales');
 const admin=createDocumentQueryReviewApi('admin');
 const s=parseDocumentStats(await (await sales.apiFetch('/api/v2/documents/stats')).json());
 const a=parseDocumentStats(await (await admin.apiFetch('/api/v2/documents/stats')).json());
 assert.equal(a.orderCount,s.orderCount+1);
 assert.equal(a.recentOrders.length,4);
 assert(s.topProducts.length<=5);
 assert(!s.recentOrders.some(item=>item.id==='900'));
 assert.equal((await sales.apiFetch('/api/v2/documents/stats?ownerId=9')).status,400);
 const filtered=parseDocumentStats(await (await sales.apiFetch('/api/v2/documents/stats?from=2026-10-15&to=2026-10-16')).json());
 assert(filtered.orderCount<s.orderCount);
 assert(filtered.recentOrders.every(item=>item.date>='2026-10-15'&&item.date<='2026-10-16'));
});
test('query review fixture uses one matching row, real pagination and owner-limited totals',async()=>{
 const demo=createDocumentQueryReviewApi('sales');
 const read=async(path:string)=>{const r=await demo.apiFetch('/api/v2/documents'+path);assert.equal(r.status,200);return r.json();};
 const page=await read('?limit=20&offset=0');assert.equal(page.items.length,20);assert(page.total>20);
 const next=await read('?limit=20&offset=20');assert(next.items.length>0);
 assert(!next.items.some((r:{id:string})=>page.items.some((p:{id:string})=>p.id===r.id)));
 const sameLine=await read('?productNo=P001&colorNo=2');assert.equal(sameLine.total,0);
 const correct=await read('?productNo=P001&colorNo=1');assert(correct.total>0);
 const totals=await read('/matching-totals?productNo=P001&colorNo=1');assert(totals.amountTotal>0);
 const id=correct.items[0].id;
 const lines=await read('/'+id+'/matching-items?productNo=P001&colorNo=1');
 assert(lines.items.every((r:{productNo:string;colorNo:string})=>r.productNo==='P001'&&r.colorNo==='1'));
 assert.equal((await demo.apiFetch('/api/v2/documents/900')).status,404);
 const admin=createDocumentQueryReviewApi('admin');assert.equal((await admin.apiFetch('/api/v2/documents/900')).status,200);
 assert.equal((await demo.apiFetch('/api/v2/documents?ownerId=9')).status,400);
 assert.equal((await demo.apiFetch('/api/orders')).status,404);
 demo.failNext();assert.equal((await demo.apiFetch('/api/v2/documents')).status,503);
 assert.equal((await demo.apiFetch('/api/v2/documents')).status,200);
});

test('document review deposit example exposes percentage input and matching rounded receipt in print',async()=>{
 const demo=createDocumentQueryReviewApi('sales');
 const page=await (await demo.apiFetch('/api/v2/documents?type=deposit')).json();
 const saved=await (await demo.apiFetch('/api/v2/documents/'+page.items[0].id)).json();
 assert.equal(saved.deposit,25);assert.equal(saved.settled,false);assert.equal(saved.totalPieces,0);
 const model=await (await demo.apiFetch('/api/v2/documents/'+saved.id+'/print-model')).json();
 assert.match(model.summaries[1].left,/25%  ¥150.00/);assert.match(model.summaries[1].right,/应收金额：¥450.00/);
});
