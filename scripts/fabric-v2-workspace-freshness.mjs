/** Read-only gate before agent dispatch. Compare source-only workspace against a verified baseline. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const roots=['server','src','scripts','docs/product-master','docs/development','docs/ui-design',
 'docs/retrospectives/development','.agents/skills/fabric-product-master-v2',
 '.agents/skills/fabric-ui-design','.agents/skills/writing-plans',
 '.agents/skills/executing-plans','.agents/skills/test-driven-development',
 '.agents/skills/systematic-debugging','.agents/skills/requesting-code-review',
 '.agents/skills/verification-before-completion'];
const top=['AGENTS.md','package.json','package-lock.json','tsconfig.json','tsconfig.node.json',
 'vite.config.ts','index.html','postcss.config.js','eslint.config.js'];
const ignore=new Set(['node_modules','.git','dist','build','coverage','tmp','artifacts',
 'outputs','uploads','.next','.cache','test-results','playwright-report','backups','fixtures-media']);
const baselineAllowed=/\.(?:[cm]?[jt]sx?|mjs|cjs|json|md|css|html|yml|yaml)$/i;
const baselineDenied=/(?:^|[.\/_-])(secret|password|credential|private|id_rsa|id_ed25519|\.env|ssh|\.pem|keypair|customer-data)(?:[.\/_-]|$)/i;
function extras(workspace,seen,mainMode){
 let extra=0;
 function visit(rel){
  const full=path.join(workspace,rel);
  if(!fs.existsSync(full))return;
  const entry=fs.lstatSync(full);
  if(entry.isSymbolicLink())throw Error('Unexpected workspace symlink');
  if(entry.isDirectory()){
   for(const next of fs.readdirSync(full,{withFileTypes:true})){
    if(!rel&&next.name==='.fabric-acp-workspace.json'&&next.isFile()&&!mainMode)continue;
    if(ignore.has(next.name)&&next.isDirectory()){
     if(mainMode)continue;
     throw Error('Unexpected generated directory in isolated workspace');
    }
    if(next.name.startsWith('.')&&next.name!=='.agents'&&next.isDirectory())
     throw Error('Unexpected hidden source directory');
    visit(path.posix.join(rel,next.name));
   }
  }else if(entry.isFile()){
   if(!seen.has(rel)&&(!mainMode||(baselineAllowed.test(rel)&&
      (!baselineDenied.test(rel)||rel==='server/access/password.ts')&&entry.size<=2*1024*1024)))extra++;
  }else throw Error('Unexpected workspace source type');
 }
 if(mainMode){
  // Main checkout may include Python/SQL or intentionally excluded credential-adjacent
  // filenames that are never copied into a source-only snapshot.
  for(const root of roots)visit(root);
  for(const file of top)visit(file);
 }else visit(''); // Agent must have no unapproved extra file anywhere, including root.
 return extra;
}
function check(snapshot,workspace,mainMode){
 const file=path.join(snapshot,'manifest.json');
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.format!=='fabric-v2-safe-source-v1'||!Array.isArray(manifest.entries)||
  manifest.entries.length!==manifest.count)throw Error('Invalid source baseline');
 let matched=0,missing=0,changed=0;
 const seen=new Set();
 for(const e of manifest.entries){
  const rel=e.file;
  if(typeof rel!=='string'||path.isAbsolute(rel)||rel.includes('\\')||rel.includes(':')||
   rel.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(rel))throw Error('Invalid manifest path');
  seen.add(rel);
  const full=path.join(workspace,rel);
  if(!fs.existsSync(full)||!fs.lstatSync(full).isFile()){missing++;continue;}
  const bytes=fs.readFileSync(full);
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==e.sha256||bytes.length!==e.bytes)changed++;else matched++;
 }
 const extra=extras(workspace,seen,mainMode);
 return {checked:manifest.count,matched,missing,changed,extra,ready:missing===0&&changed===0&&extra===0};
}
try{
 const [, ,snapshot,workspace,flag]=process.argv;
 if(!snapshot||!workspace||process.argv.length>5||flag!==undefined&&flag!=='--main')
  throw Error('Usage: node scripts/fabric-v2-workspace-freshness.mjs SNAPSHOT WORKSPACE [--main]');
 if(flag==='--main'&&path.resolve(workspace)!==process.cwd())
  throw Error('--main is valid only when WORKSPACE is the current source checkout');
 const result=check(path.resolve(snapshot),path.resolve(workspace),flag==='--main');
 process.stdout.write(JSON.stringify(result)+'\n');
 if(!result.ready)process.exitCode=2;
}catch(error){process.stderr.write(String(error.message)+'\n');process.exitCode=2;}
