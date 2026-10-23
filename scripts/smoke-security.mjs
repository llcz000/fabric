import './smoke-v2-entry.mjs';
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['scripts/run-ts-tests.mjs',"server/access/routes.test.ts","server/access/sessions.test.ts","server/access/policy.test.ts","server/product-master/v2ProductionHttp.test.ts","server/frontendStatic.test.ts","server/customer-share/productSharing.test.ts"],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
