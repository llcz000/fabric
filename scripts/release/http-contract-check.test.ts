import test from 'node:test';import assert from 'node:assert/strict';
import {checkReleaseHttpContract} from './http-contract-check';
import contract from './http-contract.json';
test('release gate checks the real complete production HTTP composition before packaging/restart',async()=>{const result=await checkReleaseHttpContract(contract);assert.deepEqual(result.checks,[{path:'/customer-tasks',status:410},{path:'/customers',status:401},{path:'/documents',status:401}]);});
test('wrong standalone-router 404 contract fails before a production switch and never permits a success status',async()=>{await assert.rejects(checkReleaseHttpContract({...contract,retiredRoutes:[{path:'/customer-tasks',status:404}]}),/410.*404|404.*410/);await assert.rejects(checkReleaseHttpContract({...contract,retiredRoutes:[{path:'/customer-tasks',status:200}]}),/contract/i);});
