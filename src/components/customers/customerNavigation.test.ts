import test from 'node:test';
import assert from 'node:assert/strict';
import {readV2Route,v2Route} from '../product-master-v2/v2Navigation';
test('customer route is a first class v2 destination',()=>{assert.equal(readV2Route('#/customers').view,'customers');assert.equal(v2Route('customers'),'#/customers');});
