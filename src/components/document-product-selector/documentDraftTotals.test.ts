import test from 'node:test';import assert from 'node:assert/strict';
import {documentDraftTotals} from './documentDraftTotals';import {DocType,type DocumentData} from '../../types';
const doc=(type:DocType)=>({type,items:[{id:'new',meters:10,price:2,amount:999,rollNo:'4, 6',deductionMeters:1}],deposit:3}) as unknown as DocumentData;
test('editor live totals use shared gross/deduction/net amount rules and ignore stale draft amount',()=>{
 assert.deepEqual(documentDraftTotals(doc(DocType.SALES),'3'),{totalMeters:10,totalPieces:2,totalAmount:18,totalDeductionMeters:1,depositAmount:3,receivableAmount:15});
 const sample=doc(DocType.SAMPLE);assert.equal(documentDraftTotals(sample,'bad').receivableAmount,20);assert.equal(documentDraftTotals(sample,'bad').totalPieces,1);
 assert.equal(documentDraftTotals(doc(DocType.DEPOSIT),'25').depositAmount,5);
});
test('invalid decimal/pieces cannot be presented as zero live totals',()=>{
 assert.throws(()=>documentDraftTotals(doc(DocType.SALES),'1e'));
 const broken=doc(DocType.SALES);(broken.items[0] as any).rollNo='1e';assert.throws(()=>documentDraftTotals(broken,'0'));
});
