import assert from 'node:assert/strict';
import test from 'node:test';
import {copyV2Draft} from './documentActionsModel';
import {DocType} from '../../types';
test('copy creates an independent unsaved document and line identity without mutating the saved source',()=>{
 const source={id:'4',docNo:'YB-OLD',date:'2026-01-01',type:DocType.SAMPLE,items:[{id:'11',v2ProductId:'7',v2SourceKind:'catalog',itemNo:'P001',meters:2,price:3}],settled:true,deposit:10,customerName:'客户'} as any;
 const before=structuredClone(source),copy=copyV2Draft(source,'2026-10-17');
 assert.equal(copy.id,'new');assert.equal(copy.docNo,'');assert.equal(copy.date,'2026-10-17');assert.equal(copy.settled,false);assert.equal(copy.deposit,0);
 assert.notEqual(copy.items[0].id,'11');assert.equal((copy.items[0] as any).v2ProductId,'7');assert.deepEqual(source,before);
});
