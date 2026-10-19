/** Review-only report of production dependency advisories.
 * npm audit --omit=dev --json exit 1 = vulnerabilities; network/errors must fail.
 * Never considers a green audit a Fabric V2 production release approval.
 */
import assert from 'node:assert/strict';
import {appendFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const fields=['info','low','moderate','high','critical'];
export function readAuditSummary(data){
 assert(data&&typeof data==='object'&&!Array.isArray(data));
 assert.equal(data.error,undefined,'npm audit failed; unable to verify dependency risk');
 assert(data.metadata?.vulnerabilities&&typeof data.metadata.vulnerabilities==='object');
 const counts=data.metadata.vulnerabilities;
 for(const field of [...fields,'total'])
  assert(Number.isSafeInteger(counts[field])&&counts[field]>=0,'Invalid audit count: '+field);
 assert.equal(fields.reduce((sum,field)=>sum+counts[field],0),counts.total,'Mismatched audit total');
 return Object.freeze(Object.fromEntries([...fields,'total'].map(field=>[field,counts[field]])));
}
export function formatAuditSummary(counts){
 return 'Production dependency audit: '+counts.critical+' critical, '+counts.high+
  ' high, '+counts.moderate+' moderate, '+counts.low+' low; '+
  counts.total+' total. Release remains No-Go until independent Fabric P1-P7 gates pass.'+
  (counts.critical||counts.high?' Vulnerability review and remediation required before deployment.':'');
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 if(process.argv.length!==3)throw Error('Expected an npm audit JSON report path');
 const result=readAuditSummary(JSON.parse(readFileSync(process.argv[2],'utf8')));
 const summary=formatAuditSummary(result);
 console.log(summary);
 if(result.critical||result.high)console.log('::warning title=Fabric V2 production dependency advisories::'+summary);
 if(process.env.GITHUB_STEP_SUMMARY){
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
   '### Fabric V2 production dependency risk (review-only)\n\n'+summary+'\n\n'+
   'No automatic dependency upgrades; see docs/operations/fabric-v2-remote-build-and-deploy-gates.md.\n');
 }
}
