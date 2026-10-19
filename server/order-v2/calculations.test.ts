import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateDocumentTotals,calculateLineAmounts,DocumentCalculationError,normalizePieceMeters} from './calculations';
test('P6-1 sample amounts and header totals use cents arithmetic and fixed two digits',()=>{
 const r=calculateDocumentTotals('sample',[
  {meters:2.5,unitPrice:10.25,amount:25.63},
  {meters:1.25,unitPrice:4.2,amount:5.25}
 ],2);
 assert.deepEqual(r,{totalMeters:3.75,totalPieces:2,totalAmount:30.88,totalDeductionMeters:0,
  depositAmount:0,receivableAmount:30.88});
 assert.equal(calculateLineAmounts('sample',{meters:2.5,unitPrice:10.25}).amount,25.63);
});
test('P6-1 deposit uses percent but stores full line amount as order.total_amount',()=>{
 const r=calculateDocumentTotals('deposit',[{meters:10,unitPrice:30,amount:300}],25);
 assert.deepEqual(r,{totalMeters:10,totalPieces:0,totalAmount:300,totalDeductionMeters:0,
  depositAmount:75,receivableAmount:0});
 assert.equal(calculateDocumentTotals('deposit',[{meters:10,unitPrice:30,amount:300}],100).receivableAmount,0);
 assert.throws(()=>calculateDocumentTotals('deposit',[],101),DocumentCalculationError);
});

test('DOC-07 rounds deposit money and never treats contract balance as receivable',()=>{
 const totals=calculateDocumentTotals('deposit',[{meters:0.01,unitPrice:1,amount:0.01}],50);
 assert.equal(totals.depositAmount,0.01);assert.equal(totals.receivableAmount,0);assert.equal(totals.totalPieces,0);
});
test('P6-1 sales gross meters, piece rolls and net billable meters remain separate',()=>{
 const line=calculateLineAmounts('bulk',{meters:4,unitPrice:12.5,deductionMeters:0.5,pieceMeters:[1.25,2.75]});
 assert.deepEqual(line,{amount:43.75,rolls:2,netMeters:3.5,deductionMeters:0.5,pieceMeters:[1.25,2.75]});
 const r=calculateDocumentTotals('bulk',[
  {meters:4,unitPrice:12.5,amount:43.75,deductionMeters:0.5,pieceMeters:[1.25,2.75]},
  {meters:3,unitPrice:10,amount:30,deductionMeters:0,pieceMeters:null}
 ],20);
 assert.deepEqual(r,{totalMeters:7,totalPieces:2,totalAmount:73.75,totalDeductionMeters:0.5,
  depositAmount:20,receivableAmount:53.75});
});
test('P6-1 sales deduction >= gross is clamped to zero net, not negative amount',()=>{
 const line=calculateLineAmounts('sales',{meters:3,unitPrice:50,deductionMeters:4,pieceMeters:null});
 assert.equal(line.amount,0);assert.equal(line.netMeters,0);
});
test('P6-1 rejects roll mismatch, negative/invalid values and hidden sales fields on other templates',()=>{
 for(const bad of [
  {meters:3,unitPrice:5,pieceMeters:[1,3]},
  {meters:3,unitPrice:5,pieceMeters:[-1,4]},
  {meters:3,unitPrice:5,pieceMeters:[1,Number.NaN]},
  {meters:-1,unitPrice:5},
  {meters:1,unitPrice:1.001},
  {meters:1,unitPrice:Number.POSITIVE_INFINITY}
 ])assert.throws(()=>calculateLineAmounts('bulk',bad),DocumentCalculationError);
 assert.throws(()=>calculateLineAmounts('sample',{meters:2,unitPrice:3,deductionMeters:1}),DocumentCalculationError);
 assert.throws(()=>calculateLineAmounts('deposit',{meters:2,unitPrice:3,pieceMeters:[2]}),DocumentCalculationError);
});
test('P6-1 JSON piece_meters normalization and cents rounding',()=>{
 assert.deepEqual(normalizePieceMeters('[1.2,2.3]'),[1.2,2.3]);
 assert.deepEqual(normalizePieceMeters(null),null);
 assert.throws(()=>normalizePieceMeters('{"value":3}'),DocumentCalculationError);
 assert.equal(calculateLineAmounts('sample',{meters:0.01,unitPrice:0.5}).amount,0.01);
});
test('P6-1 reject unrecognized document type and inconsistent stored totals',()=>{
 assert.throws(()=>calculateDocumentTotals('sale' as 'bulk',[],0),DocumentCalculationError);
 assert.throws(()=>calculateDocumentTotals('bulk',[{meters:3,unitPrice:4,amount:100}],0),DocumentCalculationError);
});

test('DOC-06 permits more than 200 pieces without changing cents-based gross and deduction rules',()=>{
 const pieces=Array.from({length:235},()=>1.25);
 const line=calculateLineAmounts('bulk',{meters:293.75,unitPrice:10,deductionMeters:0.5,pieceMeters:pieces});
 assert.equal(line.rolls,235);assert.equal(line.amount,2932.5);assert.equal(line.netMeters,293.25);
});
