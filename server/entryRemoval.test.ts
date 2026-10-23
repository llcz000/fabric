import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {createRequire} from 'node:module';
const {build}=createRequire(path.join(process.cwd(),'package.json'))('esbuild') as typeof import('esbuild');

test('published server dependency graph cannot include the retired product API assembly',async()=>{
 const bundle=await build({entryPoints:['server.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,metafile:true,logLevel:'silent'});
 const inputs=Object.keys(bundle.metafile!.inputs).map(x=>x.replaceAll('\\','/'));
 assert(!inputs.some(x=>x.endsWith('server/appAssembly.ts')),'legacy API assembly must not be shipped');
 const text=bundle.outputFiles[0].text;
 assert(!text.includes('ADMIN_PASSWORD'),'legacy global password login must not be shipped');
 assert(!text.includes('Running in JSON local file fallback mode'),'startup cannot reopen old JSON storage');
});
test('published frontend graph includes V2 and public shares without the retired application',async()=>{
 const bundle=await build({entryPoints:['src/App.tsx'],bundle:true,platform:'browser',format:'esm',packages:'external',outdir:'tmp/entry-graph',write:false,metafile:true,logLevel:'silent'});
 const inputs=Object.keys(bundle.metafile!.inputs).map(x=>x.replaceAll('\\','/'));
 for(const file of ['ProductLibrary.tsx','StatsDashboard.tsx','DocumentEditor.tsx','DocumentList.tsx'])
  assert(!inputs.some(x=>x.endsWith('/components/'+file)),file+' must not be reachable from the entry');
 assert(inputs.some(x=>x.endsWith('/V2App.tsx')));
 assert(inputs.some(x=>x.endsWith('/PublicPatternPage.tsx')));
});
