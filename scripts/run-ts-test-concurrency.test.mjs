import test from 'node:test';
import assert from 'node:assert/strict';
import {safeTestConcurrency} from './run-ts-test-concurrency.mjs';

test('Fabric full test suite uses bounded Windows-safe process concurrency',()=>{
 assert.equal(safeTestConcurrency(undefined),2);
 assert.equal(safeTestConcurrency(''),2);
 assert.equal(safeTestConcurrency('1'),1);
 assert.equal(safeTestConcurrency('4'),4);
 for(const value of ['0','-1','5','100','Infinity','1.5','NaN','3x']){
  assert.throws(()=>safeTestConcurrency(value),/concurrency/i,value);
 }
});
