import assert from 'node:assert/strict';
import test from 'node:test';
import {isDecimalValue,isRegisteredBusinessRole} from './businessRules';

test('fixed-scale numeric contract accepts decimal values without comparing binary multiplied tails',()=>{
 for(const value of [0,0.29,19.99,145.01,99999999.99])assert(isDecimalValue(value,2,8),String(value));
 for(const value of [null,undefined,'19.99',NaN,Infinity,-1,19.999,100000000])assert(!isDecimalValue(value,2,8),String(value));
 assert(isDecimalValue(19,0,2));assert(!isDecimalValue(19.1,0,2));
 assert(!isDecimalValue(19.99,-1,8));assert(!isDecimalValue(19.99,2,0));
});
test('both registered roles share common business capabilities and unknown roles fail closed',()=>{
 assert(isRegisteredBusinessRole('admin'));assert(isRegisteredBusinessRole('sales'));
 for(const value of ['visitor','ADMIN','',null,undefined,{},true])assert(!isRegisteredBusinessRole(value));
});
