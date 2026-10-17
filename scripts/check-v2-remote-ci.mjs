/** Offline static CI guardrail, NOT a deployment authorization.
 * Checks the exact review-only workflow for accidental production wiring.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function verifyReviewWorkflow(text){
 assert.equal(typeof text,'string');
 const needed=[
  [/^on:\s*$/m,'events'],
  [/^  push:\s*$/m,'push trigger'],
  [/^      - codex\/fabric-v2-integration-review-20261017\s*$/m,'review branch trigger'],
  [/^  pull_request:\s*$/m,'PR trigger'],
  [/^permissions:\s*\n  contents: read\s*$/m,'minimal token permissions'],
  [/^    runs-on: ubuntu-24\.04\s*$/m,'remote Ubuntu build'],
  [/^          persist-credentials: false\s*$/m,'no persisted git credential'],
  [/^        run: npm ci\s*$/m,'locked install'],
  [/^        run: npm run test:unit\s*$/m,'unit tests'],
  [/^        run: npm run build\s*$/m,'build'],
  [/^        uses: actions\/upload-artifact@v4\s*$/m,'review build artifact'],
  [/^            !dist\/\*\*\/\*\.map\s*$/m,'sourcemap exclusion'],
  [/^          retention-days: 7\s*$/m,'short artifact retention']
 ];
 for(const [pattern,description] of needed)
  assert.match(text,pattern,'Missing CI boundary: '+description);
 for(const name of ['backend','frontend','tooling'])
  assert.ok(text.includes('scripts/tsconfig-ci-'+name+'.json'),'Missing TS '+name);
 assert.ok(text.includes('scripts/tsconfig-b3-fulfillment.json'),'Missing V2 type-check');
 assert.ok(text.includes('scripts/check-fabric-v2-doc-navigation.mjs'),'Missing doc checks');
 const forbidden=[
  [/^\s*(?:environment|deployment|deploy):\s*\S*/im,'deploy job or environment'],
  [/\$\{\{\s*(?:secrets|vars)\./i,'external credentials'],
  [/^\s*permissions:\s*\n(?:\s{2,}(?!contents: read)[^\n]*\n)+/m,'extra token permissions'],
  [/^\s*run:\s*.*\b(?:ssh|scp|rsync|kubectl|docker\s+push|npm\s+publish)\b/im,'remote publish operation'],
  [/^\s*[-]?\s*run:\s*(?:npm\s+run\s+start|node\s+dist\/server)/mi,'starting a server in CI'],
  [/^\s*(?:pull_request_target|schedule):/m,'privileged or unexpected trigger']
 ];
 for(const [pattern,label] of forbidden)
  assert.doesNotMatch(text,pattern,'CI must not include '+label);
 // The only permitted jobs are under a single read-only CI job.
 assert.match(text,/^jobs:\s*\n  verify:\s*$/m);
 assert.equal((text.match(/^  [a-z][a-z0-9_-]*:\s*\n    name:/gm)||[]).length,1);
 return true;
}

const invoked=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const file=resolve(fileURLToPath(new URL('../.github/workflows/fabric-v2-review-build.yml',import.meta.url)));
 verifyReviewWorkflow(readFileSync(file,'utf8'));
 console.log('PASS: Fabric V2 remote CI is review-only, read-only and deploy-free');
}
