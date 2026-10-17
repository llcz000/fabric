import assert from 'node:assert/strict';
import test from 'node:test';
import {shouldWidenDocumentColumn} from './documentSupportSchema';
test('release migration never narrows a wider historical column or changes decimal scale',()=>{
 assert.equal(shouldWidenDocumentColumn('varchar(50)','varchar(100)'),true);
 assert.equal(shouldWidenDocumentColumn('varchar(255)','varchar(100)'),false);
 assert.equal(shouldWidenDocumentColumn('decimal(10,2)','decimal(14,2)'),true);
 assert.equal(shouldWidenDocumentColumn('decimal(16,2)','decimal(14,2)'),false);
 assert.throws(()=>shouldWidenDocumentColumn('decimal(12,3)','decimal(14,2)'));
 assert.throws(()=>shouldWidenDocumentColumn('text','varchar(100)'));
});
