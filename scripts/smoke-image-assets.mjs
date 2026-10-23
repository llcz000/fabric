import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['scripts/run-ts-tests.mjs',"server/image-assets/routes.test.ts","server/image-assets/companyImages.test.ts","server/order-v2/documentCompanyImagesHttp.test.ts"],{cwd:new URL('..',import.meta.url),stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
