import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entry=path.join(root,'dist/server.cjs');
assert(fs.existsSync(entry),'Run npm run build before the V2 entry smoke');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-v2-entry-'));
try{
 for(const mode of [undefined,'legacy','production','production ']){
  const env={...process.env,FABRIC_V2_LEGACY_ROUTE_MODE:'deny_legacy',FABRIC_V2_EXPECTED_DATABASE:'',FABRIC_V2_EXPECTED_UUID:'',DB_DATABASE:'',ADMIN_PASSWORD:'probe-legacy-password-must-never-appear'};
  if(mode===undefined)delete env.FABRIC_V2_RUNTIME;else env.FABRIC_V2_RUNTIME=mode;
  const result=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[entry],{cwd:sandbox,env,stdio:['ignore','pipe','pipe']});
   let output='';
   child.stdout.on('data',b=>{output+=String(b);});child.stderr.on('data',b=>{output+=String(b);});
   const timer=setTimeout(()=>{child.kill();reject(Error('Invalid V2 settings failed to stop startup'));},5000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});
   child.once('close',code=>{clearTimeout(timer);resolve({code,output});});
  });
  assert.notEqual(result.code,0);
  assert.match(result.output,/V2 startup refused/);
  assert.doesNotMatch(result.output,/probe-legacy-password|JSON local file fallback|Running on http/);
  assert.deepEqual(fs.readdirSync(sandbox),[],'Rejected startup must not create legacy customer-data files');
 }
 console.log('V2 built entry: 4 rejected-configuration cases passed; no database, listener or business writes.');
}finally{fs.rmdirSync(sandbox);}
