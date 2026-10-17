import test from 'node:test';
import assert from 'node:assert/strict';
import {readAuditSummary, formatAuditSummary} from './report-fabric-v2-dependency-audit.mjs';

const counts = {info:0,low:0,moderate:13,high:11,critical:4,total:28};
test('runtime dependency audit reports remaining critical risk, never marks release as authorized',()=>{
 const result=readAuditSummary({metadata:{vulnerabilities:counts},vulnerabilities:{}});
 assert.deepEqual(result,counts);
 const summary=formatAuditSummary(result);
 assert.match(summary,/4 critical/);
 assert.match(summary,/11 high/);
 assert.match(summary,/No-Go/);
});
test('clean dependency audit is distinguishable from incomplete or malformed network response',()=>{
 const zero={info:0,low:0,moderate:0,high:0,critical:0,total:0};
 assert.deepEqual(readAuditSummary({metadata:{vulnerabilities:zero},vulnerabilities:{}}),zero);
 for(const invalid of [null,{}, {error:{code:'EAI_AGAIN'}},
   {metadata:{vulnerabilities:{...counts,total:27}}},
   {metadata:{vulnerabilities:{...counts,critical:-1}}},
   {metadata:{vulnerabilities:{...counts,high:'11'}}},
   {metadata:{vulnerabilities:{...counts,low:0.5}}}])
  assert.throws(()=>readAuditSummary(invalid));
});
