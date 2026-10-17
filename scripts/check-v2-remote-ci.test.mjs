import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyReviewWorkflow} from './check-v2-remote-ci.mjs';

const workflow=readFileSync(new URL('../.github/workflows/fabric-v2-review-build.yml',import.meta.url),'utf8');
test('review workflow runs locked install, offline checks and artifact-only build without deployment',()=>{
 assert.equal(verifyReviewWorkflow(workflow),true);
});
test('no production environment/secrets/write token, SSH or startup can sneak into review CI',()=>{
 for(const malicious of [
  workflow.replace('contents: read','contents: write'),
  workflow.replace(/jobs:\r?\n/,'jobs:\n  deploy:\n    environment: production\n'),
  workflow.replace('npm run build','ssh user@prod deployment'),
  workflow.replace('npm ci','npm install'),
  workflow.replace('persist-credentials: false','persist-credentials: true'),
  workflow.replace('!dist/**/*.map','dist/**/*.map'),
  workflow+'\n  schedule:\n    - cron: "0 0 * * *"\n'
 ])assert.throws(()=>verifyReviewWorkflow(malicious));
});
