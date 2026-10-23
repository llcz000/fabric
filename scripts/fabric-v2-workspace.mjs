/** Route shared-directory workflows to the explicitly validated V2 worktree. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const commands=new Set(['dev','build','start','lint','test:unit','test:image-export','test:image-assets','test:security','test:image-assets:smoke','build:camera']);
const command=process.argv[2];
try{
 if(command!=='check'&&!commands.has(command))throw Error('Unsupported V2 workspace command');
 const pointer=JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
 const workspace=fs.realpathSync(path.resolve(root,pointer.workspace));
 if(workspace===fs.realpathSync(root))throw Error('V2 workspace cannot point to the retired shared source');
 const verified=spawnSync(process.execPath,['scripts/check-fabric-v2-development-source.mjs'],{cwd:workspace,stdio:'inherit'});
 if(verified.error)throw verified.error;
 if(verified.status!==0)throw Error('V2 source verification failed; reconcile and validate the source before running');
 if(command!=='check'){
  // Only fixed allowlisted script names enter the Windows command interpreter.
  const child=spawn(process.env.ComSpec??'cmd.exe',['/d','/s','/c','npm run '+command],{cwd:workspace,stdio:'inherit'});
  child.once('error',error=>{console.error(error.message);process.exitCode=1;});
  child.once('close',code=>{process.exitCode=code??1;});
 }
}catch(error){console.error(error.message);process.exitCode=1;}
