import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareWorkspace} from './fabric-v2-acp-prepare.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('ACP project prepare copies only verified baseline files to a brand-new isolated directory',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-acp-prepare-'));
 try{
  const root=path.join(tmp,'fabric'),store=path.join(tmp,'fabric-agent-baselines');
  const snapshot=path.join(store,'v2-test'),target=path.join(root,'.agent-workspaces');
  fs.mkdirSync(snapshot,{recursive:true});fs.mkdirSync(target,{recursive:true});
  const bytes=Buffer.from('export const a=1;');
  fs.mkdirSync(path.join(snapshot,'server'));fs.writeFileSync(path.join(snapshot,'server','example.ts'),bytes);
  const entry={file:'server/example.ts',bytes:bytes.length,sha256:hash(bytes)};
  fs.writeFileSync(path.join(snapshot,'manifest.json'),JSON.stringify({format:'fabric-v2-safe-source-v1',count:1,totalBytes:bytes.length,entries:[entry]}));
  const result=prepareWorkspace(root,snapshot,'E','acp-e-test');
  assert.equal(result.copied,1);assert.equal(result.role,'E');
  assert.equal(fs.readFileSync(path.join(result.workspace,entry.file),'utf8'),bytes.toString());
  assert.equal(fs.existsSync(path.join(result.workspace,'.env')),false);
  assert.throws(()=>prepareWorkspace(root,snapshot,'E','acp-e-test'),/exists|EEXIST|already/i);
  assert.throws(()=>prepareWorkspace(root,snapshot,'Z','acp-z-test'),/role/i);
  fs.writeFileSync(path.join(snapshot,entry.file),'malicious');
  assert.throws(()=>prepareWorkspace(root,snapshot,'E','acp-e-next'),/hash|integrity/i);
  assert.equal(fs.existsSync(path.join(target,'acp-e-next')),false);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});
