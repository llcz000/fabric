/** Route shared-directory workflows to the explicitly validated V2 worktree. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn,execFileSync} from 'node:child_process';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const commands=new Set(['dev','build','start','clean','lint','test:unit','test:image-export','test:image-assets','test:security','test:image-assets:smoke','build:camera','test:ui:ux','migrate:image-assets','migrate:product-image-roles']);
const command=process.argv[2];
try{
 if(command!=='check'&&command!=='init'&&!commands.has(command))throw Error('Unsupported V2 workspace command');
 const pointer=JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
 const target=path.resolve(root,pointer.workspace),relative=path.relative(root,target);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Invalid application workspace path');
 let parent=root;
 for(const part of relative.split(path.sep)){
  parent=path.join(parent,part);
  if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('Linked workspace ancestor');
 }
 if(command==='init'&&!fs.existsSync(target)){
  const ref=pointer.developmentRef;
  if(typeof ref!=='string'||!ref.startsWith('codex/')||!/^[A-Za-z0-9_./-]+$/.test(ref))throw Error('Committed developmentRef missing');
  const local=spawnSync('git',['rev-parse','--verify','refs/heads/'+ref+'^{commit}'],{cwd:root,encoding:'utf8'});
  const remote=spawnSync('git',['rev-parse','--verify','refs/remotes/origin/'+ref+'^{commit}'],{cwd:root,encoding:'utf8'});
  if(local.status!==0&&remote.status!==0)throw Error('Development ref absent; fetch the declared branch before initializing');
  const args=local.status===0?['worktree','add',target,ref]:['worktree','add','-b',ref,target,remote.stdout.trim()];
  execFileSync('git',args,{cwd:root,stdio:'inherit'});
 }
 const workspace=fs.realpathSync(target);
 if(workspace===fs.realpathSync(root))throw Error('V2 workspace cannot point to the retired shared source');
 if(command==='init'){
  const result=spawnSync(process.execPath,['scripts/init-fabric-workspace.mjs'],{cwd:workspace,stdio:'inherit'});
  if(result.error)throw result.error;
  process.exit(result.status??1);
 }
 const verified=spawnSync(process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{cwd:workspace,stdio:'inherit'});
 if(verified.error)throw verified.error;
 if(verified.status!==0)throw Error('V2 source verification failed; reconcile and validate the source before running');
 if(command!=='check'){
  const npm=process.env.npm_execpath??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!fs.existsSync(npm))throw Error('Run this entry through npm so npm_execpath is available');
  const args=process.argv.slice(3);
  const child=spawn(process.execPath,[npm,'run',command,...(args.length?['--',...args]:[])],{cwd:workspace,stdio:'inherit'});
  child.once('error',error=>{console.error(error.message);process.exitCode=1;});
  child.once('close',code=>{process.exitCode=code??1;});
 }
}catch(error){console.error(error.message);process.exitCode=1;}
