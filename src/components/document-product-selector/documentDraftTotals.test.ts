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

test('empty optional deposit is zero and leading zeros never reject an otherwise valid amount',()=>{
 assert.equal(documentDraftTotals(doc(DocType.SALES),'').depositAmount,0);assert.equal(documentDraftTotals(doc(DocType.SALES),'020').depositAmount,20);
 assert.equal(documentDraftTotals(doc(DocType.DEPOSIT),'025.00').depositAmount,5);
});
test('numeric errors identify the row and field instead of a generic summary warning',()=>{const bad=doc(DocType.SAMPLE);bad.items[0].price=NaN;assert.throws(()=>documentDraftTotals(bad,''),/第1行.*单价/);assert.throws(()=>documentDraftTotals(doc(DocType.DEPOSIT),'101'),/定金比例.*100/);});
