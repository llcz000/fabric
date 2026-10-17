/** Offline static CI guardrail, NOT a deployment authorization.
 * Checks the exact review-only workflow for accidental production wiring.
 */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,relative,sep,isAbsolute} from 'node:path';

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
 assert.ok(text.includes('scripts/check-fabric-v2-dependency-baseline.test.mjs'),'Missing patched runtime baseline');
 assert.ok(text.includes('node --test scripts/check-fabric-v2-cos-sdk-v3.test.mjs'),'Missing COS 3 runtime SDK smoke');
 assert.ok(text.includes('node --test scripts/check-fabric-v2-patched-http-image.test.mjs'),'Missing patched HTTP/image runtime compatibility smoke');
 assert.ok(text.includes('scripts/report-fabric-v2-dependency-audit.test.mjs'),'Missing audit reporter tests');
 assert.ok(text.includes('npm audit --omit=dev --json'),'Missing live production audit');
 assert.ok(text.includes('scripts/report-fabric-v2-dependency-audit.mjs'),'Missing audited risk summary');
 assert.ok(text.includes('scripts/check-fabric-v2-doc-navigation.mjs'),'Missing doc checks');
 assert.ok(text.includes('node --test scripts/check-v2-sandbox-front-config.test.mjs'),'Missing sandbox frontend boundary check');
 assert.ok(text.includes('vite.js build --config scripts/vite-v2-sandbox.config.ts'),'Missing sandbox UI isolated build');
 assert.ok(text.includes('FABRIC_V2_SANDBOX_FRONTEND: I_ACKNOWLEDGE_SANDBOX'),'Missing sandbox UI build acknowledgement');
 assert.ok(text.includes('run: node --check scripts/document-output-browser-qa.mjs'),'Missing OUTPUT-01 browser QA syntax check');
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


/** Find links from tracked Markdown documents that would disappear in a clean
 * GitHub checkout. Local existence is insufficient for review CI reproducibility.
 * Never copies private or ignored files; reports exact missing path instead.
 */
export function findMissingTrackedDocLinks(root,trackedFiles){
 const base=resolve(root),missing=[];
 for(const source of [...trackedFiles].filter(x=>x.startsWith('docs/')&&x.endsWith('.md')).sort()){
  const sourcePath=resolve(base,source);
  if(!existsSync(sourcePath)){missing.push(source+': missing tracked source');continue;}
  const lines=readFileSync(sourcePath,'utf8').split(/\r?\n/);
  let fenced=false;
  for(let lineNo=0;lineNo<lines.length;lineNo++){
   const line=lines[lineNo];
   if(/^\s*(?:\x60{3}|~{3})/.test(line)){fenced=!fenced;continue;}
   if(fenced)continue;
   for(const match of line.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){
    const url=match[1].split(/\s+"/)[0];
    if(/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url))continue;
    const [link]=url.split('#');
    if(!link)continue;
    let decoded;try{decoded=decodeURI(link);}catch{missing.push(source+':'+(lineNo+1)+' invalid URI');continue;}
    const destination=resolve(base,source,'..',decoded);
    const local=relative(base,destination).split(sep).join('/');
    if(isAbsolute(local)||local==='..'||local.startsWith('../')||!trackedFiles.has(local))
     missing.push(source+':'+(lineNo+1)+' -> '+local+' (not Git-tracked)');
   }
  }
 }
 return missing;
}

export function assertGitTrackedDocLinks(root){
 const files=execFileSync('git',['ls-files','--cached','-z'],{cwd:root}).toString('utf8').split('\0').filter(Boolean);
 const missing=findMissingTrackedDocLinks(root,new Set(files));
 assert.deepEqual(missing,[],'GitHub checkout would miss linked documentation:\n'+missing.join('\n'));
 return files.length;
}

const invoked=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const file=resolve(fileURLToPath(new URL('../.github/workflows/fabric-v2-review-build.yml',import.meta.url)));
 verifyReviewWorkflow(readFileSync(file,'utf8'));
 assertGitTrackedDocLinks(resolve(file,'../','../','../'));
 console.log('PASS: Fabric V2 remote CI is review-only, read-only and deploy-free');
}
