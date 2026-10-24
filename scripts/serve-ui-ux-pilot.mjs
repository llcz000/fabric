/** Compatibility entry; the application owns the preview and its dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const pointer=JSON.parse(fs.readFileSync(path.join(root,'docs/project/fabric-v2-active-workspace.json'),'utf8'));
const active=fs.realpathSync(path.resolve(root,pointer.workspace));
if(!active.startsWith(root+path.sep))throw Error('Invalid application workspace');
process.chdir(active);
await import(pathToFileURL(path.join(active,'scripts/serve-ui-ux-pilot.mjs')).href);
