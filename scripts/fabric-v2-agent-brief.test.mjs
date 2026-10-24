import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrief, formatBrief, profileIds } from './fabric-v2-agent-brief.mjs';

test('five bounded Fabric V2 task routes are available', () => {
  assert.deepEqual(profileIds(), ['A', 'B', 'C', 'D', 'E']);
  for (const id of profileIds()) {
    const brief = buildBrief(id);
    assert.equal(brief.agent, id);
    assert.ok(brief.goal.length > 10);
    assert.ok(brief.acceptance.length > 0);
    assert.ok(brief.contextFiles.every(f => !/\.env|key|secret|credential/i.test(f)));
    assert.ok(brief.contextFiles.length <= 6);
    assert.ok(brief.ownedPaths.length > 0);
    assert.ok(brief.gates.includes('TDD RED -> GREEN'));
    assert.ok(brief.handoff.some(x=>x.includes('文档')&&x.includes('归档候选')), 'each agent must report a document archival decision');
    assert.ok(formatBrief(brief).length < 3200, 'brief must stay small enough to avoid context bloat');
  }
});

test('specific B1 share route never widens into internal physical-card QR', () => {
  const e = buildBrief('E');
  assert.ok(e.contextFiles.includes('server/customer-share/publicPatternProjection.ts'));
  assert.ok(e.boundaries.some(x => /色卡|扫码/.test(x)));
  assert.ok(!e.ownedPaths.includes('server/customer-samples/scanRepository.ts'));
});

test('context handoff avoids copying entire requirements or private project files', () => {
  const brief = formatBrief(buildBrief('D'));
  assert.match(brief, /docs\/product-master\/product-master-v2-requirements\.md/);
  assert.match(brief, /只读|read-only/);
  assert.doesNotMatch(brief, /mysql:\/\/|PASSWORD=|API_KEY=|BEGIN RSA PRIVATE KEY/);
  assert.match(brief, /文件变更|测试证据|待审/);
});

test('unknown profiles fail closed', () => {
  for (const id of ['', 'Z', '../secrets', 'a', undefined]) {
    assert.throws(() => buildBrief(id), /Unknown Fabric agent profile/);
  }
});

test('each scoped owner has unique edit paths for independent workstreams', () => {
  const owners = new Map();
  for (const id of profileIds()) {
    for (const path of buildBrief(id).ownedPaths) {
      assert.ok(!owners.has(path), `shared ownership: ${path}`);
      owners.set(path, id);
    }
  }
});

test('role contexts use current contracts and no superseded process report',()=>{
  for(const id of profileIds()){
    const brief=buildBrief(id);
    assert.ok(brief.contextFiles.every(file=>!/(?:b2-5h-scan-lock-order|b3-history-ui-review)\.md$/.test(file)),id);
    assert.ok(!brief.gates.some(gate=>gate.includes('总控串行全量测试')),id);
  }
});
