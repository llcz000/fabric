import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildKnowledge,impact,changedImpact} from './fabric-knowledge-graph.mjs';

function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-knowledge-'));
  function put(rel,data) {
    const p=path.join(root,rel);
    fs.mkdirSync(path.dirname(p),{recursive:true});
    fs.writeFileSync(p,data,'utf8');
  }
  const business='docs/project/项目需求总览.md';
  const acceptance='docs/product-master/product-master-v2-requirements.md';
  const nav='docs/00-首页.md';
  const reg={
    format:'fabric-knowledge-registry-v1',
    canonicalRequirementFile:business,acceptanceFile:acceptance,
    documents:[
      {path:business,role:'business',owner:'project',purpose:'唯一业务定义'},
      {path:acceptance,role:'acceptance',owner:'product',purpose:'需求验收细则'},
      {path:nav,role:'navigation',owner:'project',purpose:'文档索引导航'},
    ],
    domains:[{id:'core',name:'商品目录',req:['REQ-*'],source:['server/catalog'],docs:[acceptance]}],
  };
  put(business,'# 业务\n\n| 编号 | 要求 |\n|---|---|\n| REQ-01 | 仅按当前有效商品选取 |\n');
  put(acceptance,'# 验收\n\n| AC 编号 | 对应需求ID | 场景 | 验收结果 |\n|---|---|---|---|\n| AC-01 | REQ-01 | 有效库内商品 | 核验业务归属 |\n');
  put(nav,'# 入口\n\n[当前需求](project/项目需求总览.md)\n');
  put('server/catalog/index.ts','export const id = "x";\n');
  put('server/catalog/index.test.ts','import "./index";\n');
  put('scripts/fabric-knowledge-registry.json',JSON.stringify(reg));
  try { run({root,put,reg,business,acceptance,nav}); }
  finally { fs.rmSync(root,{recursive:true,force:true}); }
}
test('complete knowledge graph routes canonical ID to domain, docs, code and tests',()=>{
  fixture(({root})=>{
    const graph=buildKnowledge(root);
    assert.deepEqual(graph.errors,[]);
    assert.equal(graph.reqIds.length,1);
    assert.equal(graph.acceptance.length,1);
    assert.deepEqual(graph.acLinks.get('AC-01'),['REQ-01']);
    assert.equal(graph.uncovered.length,0);
    const report=impact(graph,'REQ-01');
    assert.deepEqual(report.acceptanceIds,['AC-01']);
    assert.deepEqual(impact(graph,'AC-01').requirementIds,['REQ-01']);
    assert.deepEqual(report.domainIds,['core']);
    assert(report.sources.includes('server/catalog/index.ts'));
    assert(report.tests.includes('server/catalog/index.test.ts'));
    assert(report.documents.includes('docs/product-master/product-master-v2-requirements.md'));
    assert(graph.edges.some(e=>e.relation==='links-to'&&e.to==='doc:docs/project/项目需求总览.md'));
  });
});
test('new unregistered markdown is rejected even with a valid link',()=>{
  fixture(({root,put})=>{
    put('docs/project/2026-10-24-需求评审.md','# Another version\n');
    const graph=buildKnowledge(root);
    assert(graph.errors.some(s=>s.includes('without approved catalog entry')));
  });
});
test('new dated process file cannot be approved by registering it',()=>{
  fixture(({root,put,reg})=>{
    const file='docs/project/2026-10-24-新增实施过程.md';
    put(file,'# History\n');
    reg.documents.push({path:file,role:'reference',owner:'project',purpose:'临时实施过程回顾'});
    assert(buildKnowledge(root,reg).errors.some(e=>e.includes('date-stamped document forbidden')));
  });
});
test('unapproved process JSON inside docs is rejected',()=>{
  fixture(({root,put})=>{
    put('docs/project/temporary-result.json','{}');
    assert(buildKnowledge(root).errors.some(e=>e.includes('Unapproved data/process file')));
  });
});
test('a second business requirement table is rejected',()=>{
  fixture(({root,put,acceptance})=>{
    put(acceptance,'# Acceptance\n| REQ-01 | 重复业务定义 |\n| AC-01 | 用例 |\n');
    assert(buildKnowledge(root).errors.some(s=>s.includes('Repeated business definition')));
  });
});
test('unmapped canonical IDs are rejected rather than hidden',()=>{
  fixture(({root,put,business})=>{
    put(business,'# Business\n| REQ-01 | current |\n| MISSING-02 | unmapped |\n');
    assert(buildKnowledge(root).errors.some(s=>s.includes('no domain: MISSING-02')));
  });
});
test('a new domain-mapped requirement without any direct AC fails the gate',()=>{
  fixture(({root,put,business})=>{
    put(business,'# Business\n| REQ-01 | already covered |\n| REQ-02 | new current requirement |\n');
    const graph=buildKnowledge(root);
    assert.deepEqual(graph.uncovered,['REQ-02']);
    assert(graph.errors.some(error=>error.includes('Canonical requirement lacks direct AC: REQ-02')));
  });
});
test('duplicate canonical requirement IDs are rejected',()=>{
  fixture(({root,put,business})=>{
    put(business,'| REQ-01 | a |\n| REQ-01 | b |\n');
    assert(buildKnowledge(root).errors.some(s=>s.includes('Duplicate requirement IDs')));
  });
});
test('a superseded business promise is rejected even when the ID is valid',()=>{
  fixture(({root,put,acceptance})=>{
    put(acceptance,'# AC\n| AC-01 | 新增产品先设为不可供样 |');
    assert(buildKnowledge(root).errors.some(e=>e.includes('Retired active business clause')));
  });
});
test('an AC without explicit requirement IDs fails the gate',()=>{
  fixture(({root,put,acceptance})=>{
    put(acceptance,'| AC-01 | | Scenario | Expected |\n');
    assert(buildKnowledge(root).errors.some(e=>e.includes('missing canonical requirement')));
  });
});
test('an AC pointing to a removed or mistyped requirement fails the gate',()=>{
  fixture(({root,put,acceptance})=>{
    put(acceptance,'| AC-01 | RETIRED-01 | Scenario | Expected |\n');
    assert(buildKnowledge(root).errors.some(e=>e.includes('missing canonical requirement')));
  });
});
test('duplicate AC requirement IDs cannot conceal missing trace coverage',()=>{
  fixture(({root,put,acceptance})=>{
    put(acceptance,'| AC-01 | REQ-01, REQ-01 | Scenario | Expected |\n');
    assert(buildKnowledge(root).errors.some(e=>e.includes('duplicate requirement references')));
  });
});
test('requirement-to-AC edges describe specified scenarios, not test execution',()=>{
  fixture(({root})=>{
    const graph=buildKnowledge(root);
    assert(graph.edges.some(e=>e.from==='req:REQ-01' && e.to==='ac:AC-01' && e.relation==='has-acceptance-scenario'));
    assert(!graph.edges.some(e=>e.relation==='verified-by-acceptance'));
  });
});
test('source path impact returns candidate domain without claiming test execution',()=>{
  fixture(({root})=>{
    const graph=buildKnowledge(root);
    const report=impact(graph,'server/catalog/index.ts');
    assert(report.domainIds.includes('core'));
    assert(report.note.includes('candidates'));
    assert.throws(()=>impact(graph,'../../credentials'),/Expected canonical/);
  });
});

test('exclusive feature bindings override broad folders and include browser tests and preview fixtures',()=>{
 fixture(({root,put,reg})=>{
  const component='src/shared/Selection.tsx',browser='tests/ui/selection.spec.ts',preview='tools/ui-preview/selection.tsx';
  put(component,'export const selection = true;');put(browser,'// AC-01\n');put(preview,'export const preview = true;');
  reg.domains[0].exclusiveSource=[component,browser,preview];
  reg.domains.push({id:'broad',name:'Shared folder',req:['REQ-*'],source:['src/shared'],docs:[reg.acceptanceFile]});
  const graph=buildKnowledge(root,reg);assert.deepEqual(graph.errors,[]);
  assert.deepEqual(impact(graph,component).domainIds,['core']);
  assert(impact(graph,'AC-01').tests.includes(browser));
  assert(impact(graph,'AC-01').sources.includes(preview));
  assert.deepEqual(impact(graph,browser).domainIds,['core']);
  assert.deepEqual(impact(graph,preview).domainIds,['core']);
  assert.deepEqual(impact(graph,component).requirementIds,['REQ-01']);
  assert.deepEqual(impact(graph,'AC-01').directTests,[browser]);
  reg.domains.push({id:'shared',name:'Explicit shared UI',req:['REQ-*'],source:[component],docs:[reg.acceptanceFile]});
  assert.deepEqual(impact(buildKnowledge(root,reg),component).domainIds,['core','shared']);
  assert.throws(()=>impact(graph,'docs/../../outside'),/Expected canonical/);
 });
});

test('browser and preview binding paths cannot escape the project or conflict on ownership',()=>{
 fixture(({root,put,reg})=>{
  reg.domains[0].exclusiveSource=['tests/../outside.ts'];
  assert(buildKnowledge(root,reg).errors.some(e=>e.includes('Unsafe source binding')));
  put('tests/ui/a.spec.ts','// AC-99\n');reg.domains[0].exclusiveSource=['tests/ui/a.spec.ts'];
  assert(buildKnowledge(root,reg).errors.some(e=>e.includes('Unknown acceptance annotation')));
  put('tests/ui/a.spec.ts','// AC-01\n');
  reg.domains.push({id:'other',name:'Other',req:['REQ-*'],source:['server/catalog'],exclusiveSource:['tests/ui/a.spec.ts'],docs:[reg.acceptanceFile]});
  assert(buildKnowledge(root,reg).errors.some(e=>e.includes('Conflicting exclusive source')));
 });
});

test('current sample homepage routes to cards and its annotated Edge cases remain discoverable',()=>{
 const graph=buildKnowledge();assert.deepEqual(graph.errors,[]);
 const component='src/components/product-master-v2/SampleSessionDirectory.tsx',browser='tests/ui/sample-directory.spec.ts';
 assert.deepEqual(impact(graph,component).domainIds,['cards']);
 assert(impact(graph,'V2-09').sources.includes(component));
 assert(impact(graph,'AC-164').directTests.includes(browser));
 assert(impact(graph,'AC-164').tests.includes(browser));
 assert(impact(graph,browser).domainIds.includes('cards'));
 assert(impact(graph,'tools/ui-preview/scanSelectionReview.tsx').domainIds.includes('cards'));
});

test('manifest comparison isolates new task changes without relying on the dirty Git baseline',()=>{
 fixture(({root,put,business})=>{
  const hash=p=>createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
  const paths=['server/catalog/index.ts','server/catalog/index.test.ts','scripts/fabric-knowledge-registry.json'];
  const manifest={workspace:root,requirements:{path:business,sha256:hash(business)},files:paths.map(p=>({path:p,sha256:hash(p)}))};
  put('artifacts/task-start.json',JSON.stringify(manifest));
  assert.deepEqual(changedImpact(buildKnowledge(root),undefined,'artifacts/task-start.json').changedPaths,[]);
  put('server/catalog/index.ts','export const id = "changed";');
  const delta=changedImpact(buildKnowledge(root),undefined,'artifacts/task-start.json');
  assert.deepEqual(delta.changedPaths,['server/catalog/index.ts']);assert.equal(delta.broadRequirementChange,false);
  put('tests/ui/new.spec.ts','// AC-01');
  assert(changedImpact(buildKnowledge(root),undefined,'artifacts/task-start.json').changedPaths.includes('tests/ui/new.spec.ts'));
  manifest.files[0].path='../outside';put('artifacts/task-start.json',JSON.stringify(manifest));
  assert.throws(()=>changedImpact(buildKnowledge(root),undefined,'artifacts/task-start.json'),/Unsafe manifest/);
  assert.throws(()=>changedImpact(buildKnowledge(root),'HEAD','artifacts/task-start.json'),/one comparison/);
 });
});
