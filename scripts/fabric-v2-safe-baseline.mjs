/** Fabric V2 trusted source baseline. NEVER captures .env, media, customer data or git internals.
 * Usage: node scripts/fabric-v2-safe-baseline.mjs --dry-run|--create|--verify PATH|--restore-smoke PATH
 * Snapshot storage is a sibling of the project; this tool never edits/restores the live checkout.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=process.cwd();
const store=path.resolve(root,'..','fabric-agent-baselines');
const roots=['server','src','scripts','docs/product-master','docs/development','docs/ui-design',
 'docs/retrospectives/development','.agents/skills/fabric-product-master-v2',
 '.agents/skills/fabric-ui-design','.agents/skills/writing-plans',
 '.agents/skills/executing-plans','.agents/skills/test-driven-development',
 '.agents/skills/systematic-debugging','.agents/skills/requesting-code-review',
 '.agents/skills/verification-before-completion'];
const topFiles=['AGENTS.md','package.json','package-lock.json','tsconfig.json','tsconfig.node.json',
 'vite.config.ts','index.html','postcss.config.js','eslint.config.js'];
const allowed=/\.(?:[cm]?[jt]sx?|mjs|cjs|json|md|css|html|yml|yaml)$/i;
const disallowed=/(?:^|[.\\/_-])(secret|password|credential|private|id_rsa|id_ed25519|\.env|ssh|\.pem|keypair|customer-data)(?:[.\\/_-]|$)/i;
const skipDirs=new Set(['node_modules','.git','dist','build','coverage','tmp','artifacts','outputs','uploads','.next','.cache','test-results','playwright-report','backups','fixtures-media']);
const digest=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');
function collect(){
 const found=new Set();
 function visit(rel){
  const abs=path.join(root,rel);if(!fs.existsSync(abs))return;
  const stat=fs.lstatSync(abs);if(stat.isSymbolicLink())return;
  if(stat.isDirectory()){
   for(const entry of fs.readdirSync(abs,{withFileTypes:true})){
    if(skipDirs.has(entry.name)||entry.name.startsWith('.')&&!['.agents'].includes(entry.name))continue;
    visit(path.posix.join(rel.replaceAll('\\','/'),entry.name));
   }
  }else if(stat.isFile()&&allowed.test(rel)&&
   (!disallowed.test(rel)||rel.replaceAll('\\\\','/')==='server/access/password.ts')&&
   stat.size<=2*1024*1024){
   const bytes=fs.readFileSync(abs);
   if(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(bytes.toString('utf8')))throw Error('Private key marker in source allowlist; abort baseline');
   found.add(rel.replaceAll('\\','/'));
  }
 }
 for(const r of roots)visit(r);
 for(const f of topFiles)visit(f);
 return [...found].sort();
}
function makeManifest(files){
 const entries=files.map(file=>{const bytes=fs.readFileSync(path.join(root,file));return {file,bytes:bytes.length,sha256:digest(bytes)};});
 return {format:'fabric-v2-safe-source-v1',createdAt:new Date().toISOString(),count:entries.length,
  totalBytes:entries.reduce((a,b)=>a+b.bytes,0),entries};
}
function validSnapshot(snapshot){
 const absolute=path.resolve(snapshot);
 if(path.dirname(absolute)!==store||!path.basename(absolute).startsWith('v2-'))
  throw Error('Snapshot path must be a direct child of sibling fabric-agent-baselines');
 return absolute;
}
function verify(snapshot,contentRoot=snapshot){
 const manifest=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json'),'utf8'));
 if(manifest.format!=='fabric-v2-safe-source-v1'||manifest.count!==manifest.entries.length)
  throw Error('Unexpected baseline manifest');
 let bytes=0;const visited=new Set();
 for(const item of manifest.entries){
  const file=item.file;
if(typeof file!=='string'||path.isAbsolute(file)||file.includes('\\')||file.includes(':')||
    /[\x00-\x1f]/.test(file)||file.split('/').some(part=>part===''||part==='.'||part==='..')||
    path.posix.normalize(file)!==file||visited.has(file))throw Error('Unsafe baseline relative path');
  visited.add(file);
  const candidate=path.join(contentRoot,file),s=fs.lstatSync(candidate);
  if(!s.isFile()||s.isSymbolicLink())throw Error('Source verification refused');
  const data=fs.readFileSync(candidate);if(data.length!==item.bytes||digest(data)!==item.sha256)
   throw Error('Baseline hash verification failed');
  bytes+=data.length;
 }
 if(bytes!==manifest.totalBytes)throw Error('Baseline length verification failed');
 return {count:manifest.count,totalBytes:bytes};
}
function copyAll(manifest,from,to){
 for(const item of manifest.entries){
  const dest=path.join(to,item.file);fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.copyFileSync(path.join(from,item.file),dest,fs.constants.COPYFILE_EXCL);
 }
}
const [command,arg]=process.argv.slice(2);
if(command==='--dry-run'){
 const data=makeManifest(collect());console.log(JSON.stringify({mode:'dry-run',count:data.count,totalBytes:data.totalBytes,store:'sibling-only'}));
}else if(command==='--create'){
 const manifest=makeManifest(collect());
 if(manifest.count<100)throw Error('Source count too small: refused incomplete baseline');
 fs.mkdirSync(store,{recursive:true});
 const dest=path.join(store,'v2-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex'));
 fs.mkdirSync(dest,{recursive:false});
 copyAll(manifest,root,dest);
 fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 const check=verify(dest);
 console.log(JSON.stringify({mode:'created-and-verified',snapshot:dest,...check}));
}else if(command==='--verify'){
 const snap=validSnapshot(arg);console.log(JSON.stringify({mode:'verified',snapshot:snap,...verify(snap)}));
}else if(command==='--restore-smoke'){
 const snap=validSnapshot(arg),manifest=JSON.parse(fs.readFileSync(path.join(snap,'manifest.json'),'utf8'));
 verify(snap);
 // Restores into an isolated disposable directory, never into D:\\fabric.
 const tmp=fs.mkdtempSync(path.join(store,'smoke-'));
 try{copyAll(manifest,snap,tmp);console.log(JSON.stringify({mode:'restore-smoke-pass',...verify(snap,tmp)}));}
 finally{fs.rmSync(tmp,{recursive:true,force:true});}
}else{
 console.error('Specify --dry-run, --create, --verify PATH or --restore-smoke PATH');process.exitCode=2;
}
