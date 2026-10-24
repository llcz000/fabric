import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const active=path.join(root,'.agent-workspaces/v2-quality-20261020');
test('both documentation entrypoints resolve local links and current source locators',()=>{
 for(const cwd of [root,active]){
  const result=spawnSync(process.execPath,['scripts/check-fabric-v2-doc-navigation.mjs'],{cwd,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
 }
});
test('application checkout owns its UI tooling without parent-directory npm entries',()=>{
 for(const rel of ['scripts/ui-workflow-gate.mjs','scripts/serve-ui-ux-pilot.mjs','playwright.ui.config.ts','tests/ui/internal-fabric-design.spec.ts']){
  assert(fs.existsSync(path.join(active,rel)),'Missing local UI tooling: '+rel);
 }
 const pkg=JSON.parse(fs.readFileSync(path.join(active,'package.json')));
 for(const name of ['ui:preflight','ui:template','ui:verify','test:ui:ux'])assert(!pkg.scripts[name].includes('../..'),name+' still depends on the controller');
});
test('retired root application sources cannot be mistaken for the current application',()=>{
 for(const rel of ['src','server','server.ts','vite.config.ts','tsconfig.json'])assert.equal(fs.existsSync(path.join(root,rel)),false,'Retired application still present: '+rel);
 for(const rel of ['src','server','server.ts','vite.config.ts','tsconfig.json'])assert(fs.existsSync(path.join(active,rel)),'Current application missing: '+rel);
});
test('controller forwards focused command arguments without a hand-built shell command',()=>fixture(({dir,write})=>{
 const work='.agent-workspaces/current';
 write('scripts/fabric-v2-workspace.mjs',fs.readFileSync(path.join(root,'scripts/fabric-v2-workspace.mjs')));
 write('docs/project/fabric-v2-active-workspace.json',JSON.stringify({workspace:work}));
 write(work+'/scripts/check-fabric-v2-development-source.mjs','export {};\n');
 write(work+'/scripts/echo.mjs','console.log(JSON.stringify(process.argv.slice(2)));\n');
 write(work+'/package.json',JSON.stringify({type:'module',scripts:{'test:unit':'node scripts/echo.mjs'}}));
 const args=['src/focused.test.ts','two words'];
 const result=spawnSync(process.execPath,['scripts/fabric-v2-workspace.mjs','test:unit',...args],{cwd:dir,encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert(result.stdout.includes(JSON.stringify(args)),result.stdout);
}));
test('fresh controller initializes its declared committed application worktree when it is absent',()=>fixture(({dir,write,git})=>{
 write('scripts/init-fabric-workspace.mjs',fs.readFileSync(path.join(active,'scripts/init-fabric-workspace.mjs')));
 git('add','--all');git('commit','--quiet','-m','application tooling');
 git('branch','codex/application-fixture');
 write('scripts/fabric-v2-workspace.mjs',fs.readFileSync(path.join(root,'scripts/fabric-v2-workspace.mjs')));
 write('docs/project/fabric-v2-active-workspace.json',JSON.stringify({role:'controller',workspace:'.agent-workspaces/current',developmentRef:'codex/application-fixture'}));
 git('add','--all');git('commit','--quiet','-m','controller');
 const result=spawnSync(process.execPath,['scripts/fabric-v2-workspace.mjs','init'],{cwd:dir,encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert(fs.existsSync(path.join(dir,'.agent-workspaces/current/artifacts/workspace-preservation-20261023/source-manifest.json')));
 const branch=execFileSync('git',['branch','--show-current'],{cwd:path.join(dir,'.agent-workspaces/current'),encoding:'utf8'}).trim();
 assert.equal(branch,'codex/application-fixture','Initialized development tree must keep a branch reference');
}));
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-fresh-checkout-'));
 const write=(rel,data)=>{const f=path.join(dir,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data);};
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  git('init','--quiet');git('config','user.name','Workspace test');git('config','user.email','test@local');
  write('.gitignore','artifacts/\n');write('package.json','{"type":"module"}\n');
  write('src/app.ts','export const value=1;\n');write('server/app.ts','export const server=1;\n');write('scripts/tool.mjs','export const tool=1;\n');
  write('docs/project/项目需求总览.md','fixed requirements\n');
  write('docs/project/fabric-v2-active-workspace.json',JSON.stringify({role:'application',sourceManifest:'artifacts/workspace-preservation-20261023/source-manifest.json'}));
  git('add','--all');git('commit','--quiet','-m','fresh source');
  return fn({dir,write,git});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
async function initializer(){
 const file=path.join(active,'scripts/init-fabric-workspace.mjs');
 assert(fs.existsSync(file),'Missing committed-checkout initializer');
 return (await import(pathToFileURL(file).href)).initializeWorkspace;
}
test('fresh checkout creates only a local committed-source manifest and never overwrites it',async()=>{
 const initialize=await initializer();
 fixture(({dir,git})=>{
  const result=initialize(dir);
  assert.equal(result.releaseAuthorized,false);
  const file=path.join(dir,'artifacts/workspace-preservation-20261023/source-manifest.json');
  const manifest=JSON.parse(fs.readFileSync(file));
  assert.equal(manifest.baseHead,git('rev-parse','HEAD'));
  assert(manifest.files.some(x=>x.path==='src/app.ts'));
  assert.equal(git('status','--porcelain=v1'), '');
  const before=fs.readFileSync(file);
  initialize(dir);assert.deepEqual(fs.readFileSync(file),before);
  fs.writeFileSync(file,JSON.stringify({...manifest,files:[],requirements:{...manifest.requirements,sha256:'0'.repeat(64)}}));
  assert.throws(()=>initialize(dir),/manifest|existing|validation/i);
  fs.writeFileSync(file,'{"tampered":true}');
  assert.throws(()=>initialize(dir),/manifest|existing|validation/i);
  assert.equal(fs.readFileSync(file,'utf8'),'{"tampered":true}');
 });
});
test('initializer rejects dirty sources, ignored source additions, and linked output ancestors',async()=>{
 const initialize=await initializer();
 fixture(({dir,write})=>{
  write('src/app.ts','unreviewed change');
  assert.throws(()=>initialize(dir),/clean|dirty|committed/i);
 });
 fixture(({dir,write,git})=>{
  write('.gitignore','artifacts/\nsrc/hidden.ts\n');git('add','.gitignore');git('commit','--quiet','-m','ignore');
  write('src/hidden.ts','uncommitted ignored source');
  assert.throws(()=>initialize(dir),/untracked|uncommitted|source/i);
 });
 fixture(({dir})=>{
  const external=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-init-outside-'));
  try{fs.symlinkSync(external,path.join(dir,'artifacts'),process.platform==='win32'?'junction':'dir');assert.throws(()=>initialize(dir),/link|path|ancestor/i);assert.deepEqual(fs.readdirSync(external),[]);}
  finally{fs.rmSync(external,{recursive:true,force:true});}
 });
});
