import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
test('isolated review deep link accepts bounded review tabs and preserves pattern default',async()=>{
 // Compile the real browser entry with CSS omitted for this Node-only pure-function check.
 const {build}=createRequire(process.cwd()+'/package.json')('esbuild') as typeof import('esbuild');
 const bundle=await build({entryPoints:['src/product-master-v2-review/main.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},write:false});
 const module:{exports:{initialReviewView?:(search:string)=>string}}={exports:{}};
 new Function('module','exports','require',bundle.outputFiles[0].text)(module,module.exports,createRequire(process.cwd()+'/package.json'));
 const initialReviewView=module.exports.initialReviewView!;
 assert.equal(initialReviewView('?view=sampleSelection'),'sampleSelection');
 assert.equal(initialReviewView('?view=sampleCards'),'sampleCards');
 assert.equal(initialReviewView('?view=fabric'),'fabric');
 assert.equal(initialReviewView('?view=products'),'products');
 assert.equal(initialReviewView('?view=documents'),'documents');
 assert.equal(initialReviewView('?view=stats'),'stats');
 assert.equal(initialReviewView('?view=pattern'),'pattern');
 for(const query of ['', '?view=unknown','?view=__proto__','?view=https://example.com','?view=sampleCards%2Fscan'])assert.equal(initialReviewView(query),'pattern');
});
