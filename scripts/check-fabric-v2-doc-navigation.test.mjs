import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('documentation gate rejects a broken local Markdown anchor anywhere in docs',()=>{
  const root=process.cwd();
  const probe=path.join(root,'docs','zz-anchor-gate-probe.md');
  assert.equal(fs.existsSync(probe),false,'temporary anchor probe already exists');
  fs.writeFileSync(probe,'[deliberately broken anchor](project/项目需求总览.md#not-a-real-anchor-for-gate-test)\n','utf8');
  try {
    const result=spawnSync(process.execPath,['scripts/check-fabric-v2-doc-navigation.mjs'],{cwd:root,encoding:'utf8'});
    const output=(result.stdout||'')+'\n'+(result.stderr||'');
    assert.notEqual(result.status,0,'navigation gate unexpectedly accepted a broken anchor');
    assert.match(output,/zz-anchor-gate-probe\.md:\d+ broken heading anchor .*not-a-real-anchor-for-gate-test/);
  } finally {
    fs.rmSync(probe,{force:true});
  }
});
