import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {approvedV2Pages} from './navigation';
test('D-02 seven approved writable V2 business workflows link to existing real React features',()=>{
 assert.deepEqual(approvedV2Pages.map(x=>x.id),[
  'patterns','pattern-editor','fabrics','products','product-editor','fabric-import','document-selector'
 ]);
 assert.equal(new Set(approvedV2Pages.map(x=>x.label)).size,7);
 const ui=readFileSync('src/product-master-v2-workbench/main.tsx','utf8');
 for(const dependency of ['PatternLibraryV2','FabricLibraryV2','FabricImportV2',
  'ProductCatalogWorkspaceV2','V2DocumentWorkspace'])
  assert(ui.includes(dependency),dependency);
 assert(ui.includes('session.requestWrite'));
 assert(!/from ['"].*App\.tsx/.test(ui));
});
