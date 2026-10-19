import assert from 'node:assert/strict';
import test from 'node:test';
import {processV2ImageJobs} from './v2ImageProcessor';
test('V2 processing never calls legacy reference reconciliation, recycle or COS purge',async()=>{
 let ran=0;const worker={async runOnce(){return ++ran<3;},async recycleOnce(){throw Error('destructive');},async purgeOnce(){throw Error('destructive');},async reconcileOnce(){throw Error('legacy reference domain');}};
 await processV2ImageJobs(worker);assert.equal(ran,3);
});
