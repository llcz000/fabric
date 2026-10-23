/** Shared checkout entry forwards only to the declared active workspace. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
let workspace=root;
if(fs.existsSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'))){
 const p=JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
 const candidate=path.resolve(root,p.workspace);
 if(fs.existsSync(candidate)){workspace=fs.realpathSync(candidate);if(!workspace.startsWith(root+path.sep)||workspace===root)throw Error('Invalid active release workspace');}
}
if(!fs.existsSync(path.join(workspace,'scripts/release/cli.mjs')))throw Error('Active release tool is missing');
const result=spawnSync(process.execPath,[path.join(workspace,'scripts/release/cli.mjs'),...process.argv.slice(2)],{cwd:workspace,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
