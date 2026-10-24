import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const gate = fs.readFileSync(path.join(root, 'scripts/check-product-master-v2-p0.mjs'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const requirements = 'docs/product-master/product-master-v2-requirements.md';
const register = 'docs/product-master/product-master-v2-stitch-design-review.md';
const progress = 'docs/product-master/product-master-v2-progress.md';
const current = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function run(overrides = {}, source=gate) {
  const messages = [];
  const taskProcess = { cwd: () => root, exitCode: 0 };
  vm.runInNewContext(source, {
    path,
    fs: {
      ...fs,
      readFileSync(file, encoding) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        return Object.hasOwn(overrides, relative) ? overrides[relative] : fs.readFileSync(file, encoding);
      },
    },
    process: taskProcess,
    console: { log: (...args) => messages.push(args.join(' ')), error: (...args) => messages.push(args.join(' ')) },
  });
  return { status: taskProcess.exitCode, output: messages.join('\n') };
}

test('current specifications need no historical revision prose when linked approval evidence is intact', () => {
  const result = run({ [requirements]: current(requirements).replaceAll('v1.38', '') });
  assert.equal(result.status, 0, result.output);
});

test('a historical version string cannot replace the link to current UI evidence', () => {
  const withoutLink = current(requirements).replaceAll('product-master-v2-stitch-design-review.md', 'unrelated-ui.md');
  const result = run({ [requirements]: withoutLink + '\nv1.38\n' });
  assert.equal(result.status, 1, result.output);
});

test('pending or missing approved screen still rejects the gate', () => {
  const result = run({ [register]: current(register).replace(/UI已确认/, 'UI待确认') });
  assert.equal(result.status, 1, result.output);
});

test('current xlsx-only scope cannot be replaced by the old dual-format approval', () => {
  const result = run({ [requirements]: current(requirements).replace('仅支持 `.xlsx`', '同时支持 `.xlsx` 和 `.xls`') });
  assert.match(result.output, /FAIL current format and acceptance boundaries/);
});

test('current state must keep real-environment acceptance distinct from source presence', () => {
  const file='docs/project/项目现状.md';
  const result=run({[file]:current(file).replace('当前源码存在不代表','当前源码存在证明')});
  assert.match(result.output,/FAIL current format and acceptance boundaries/);
});

function runSkill(overrides={}) {
  const messages=[],taskProcess={cwd:()=>root,exitCode:0};
  vm.runInNewContext(current('scripts/check-fabric-v2-skill.mjs').replace(/^import .*;\r?\n/gm,''),{
    path,spawnSync,fs:{...fs,readFileSync(file,encoding){const rel=path.relative(root,file).split(path.sep).join('/');return Object.hasOwn(overrides,rel)?overrides[rel]:fs.readFileSync(file,encoding);}},
    process:taskProcess,console:{log:(...a)=>messages.push(a.join(' ')),error:(...a)=>messages.push(a.join(' '))},
  });
  return {status:taskProcess.exitCode,output:messages.join('\n')};
}

test('skill routes product columns to current requirements without a frozen count',()=>{
  const result=runSkill();assert.equal(result.status,0,result.output);
});

test('skill rejects restoring a frozen legacy column rule',()=>{
  const file='.agents/skills/fabric-product-master-v2/SKILL.md';
  const result=runSkill({[file]:current(file).replace('产品列数和顺序以最新需求及正式组件为准','产品列表固定为12列')});
  assert.match(result.output,/FAIL product and review gates: missing current column authority/);
});

test('skill still rejects missing server authorization safeguards',()=>{
  const file='.agents/skills/fabric-product-master-v2/SKILL.md';
  const result=runSkill({[file]:current(file).replaceAll('权限','规则')});
  assert.match(result.output,/missing server auth/);
});

test('navigation follows current requirement links without requiring an old version label',()=>{
  const source=current('scripts/check-fabric-v2-doc-navigation.mjs').replace(/^import .*;\r?\n/gm,'');
  const result=run({},source);assert.equal(result.status,0,result.output);
});

test('navigation rejects an obsolete specification presented as current',()=>{
  const source=current('scripts/check-fabric-v2-doc-navigation.mjs').replace(/^import .*;\r?\n/gm,'');
  const file='docs/product-master/product-master-v2-agent-context-handbook.md';
  const result=run({[file]:current(file).replace('不替代现行业务需求','不替代现行v1.50业务需求')},source);
  assert.match(result.output,/FAIL current agent source of truth: Outdated current requirement/);
});
