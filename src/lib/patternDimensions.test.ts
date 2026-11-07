import assert from 'node:assert/strict';
import test from 'node:test';
import {validatePatternDimensions,parsePatternDimensionDraft} from './patternDimensions';
test('cm validation rejects values that round to zero or exceed DECIMAL precision',()=>{
 for(const width of [0.000000001,0.00001,1.23456,99999999.99999,NaN,Infinity])assert.throws(()=>validatePatternDimensions(width,1));
 assert.deepEqual(validatePatternDimensions(0.0001,31.25),{widthCm:0.0001,heightCm:31.25});
 assert.deepEqual(parsePatternDimensionDraft('.5','32.'),{widthCm:0.5,heightCm:32});
 assert.deepEqual(parsePatternDimensionDraft('',''),{widthCm:null,heightCm:null});
});
