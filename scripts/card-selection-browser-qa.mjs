/** Compatibility entry: selection QA lives in the current formal Edge specs. No production access. */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
if(process.argv.slice(2).some(arg=>arg!=='--built'))throw Error('Use card-selection-browser-qa.mjs [--built]');
// The legacy --built review bundle is superseded; Playwright builds its own isolated fixture.
const result=spawnSync(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config=playwright.ui.config.ts','tests/ui/sample-directory.spec.ts','tests/ui/scan-selection.spec.ts'],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status??1;
