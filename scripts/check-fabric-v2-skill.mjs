// Static discovery and contract check for the Fabric V2 project skill.
// Does NOT prove agent behavior, production tests, remote Stitch state or DB readiness.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const skillRel = '.agents/skills/fabric-product-master-v2/SKILL.md';
const read = (rel) => {
  const absolute = path.join(root, rel);
  if (!fs.existsSync(absolute)) throw new Error('Missing: ' + rel);
  return fs.readFileSync(absolute, 'utf8');
};
const failures = [];
const check = (label, fn) => {
  try { fn(); console.log('PASS ' + label); }
  catch (err) { failures.push(label + ': ' + err.message); console.error('FAIL ' + label + ': ' + err.message); }
};
const contains = (source, pattern, message) => {
  if (!pattern.test(source)) throw new Error(message);
};

check('project skill frontmatter', () => {
  const skill = read(skillRel);
  contains(skill, /^---\r?\nname: fabric-product-master-v2\r?\ndescription: Use when /, 'invalid discoverable frontmatter');
  contains(skill, /\r?\n---\r?\n\r?\n# /, 'missing frontmatter boundary/title');
});
check('current documentation links', () => {
  const skill = read(skillRel);
  const expected = [
    'docs/product-master/README.md',
    'docs/product-master/product-master-v2-requirements.md',
    'docs/superpowers/specs/2026-10-12-product-master-v2-architecture.md',
    'docs/superpowers/plans/2026-10-12-product-master-v2-implementation.md',
    'docs/development/开发与验证规范.md',
    'docs/retrospectives/README.md',
  ];
  for (const rel of expected) {
    read(rel);
    if (!skill.includes(rel)) throw new Error('Unreferenced document: ' + rel);
  }
});
check('product and review gates', () => {
  const skill = read(skillRel);
  for (const [pattern, label] of [
    [/产品列数和顺序以最新需求及正式组件为准/, 'current column authority'],
    [/备注/, 'product remark'],
    [/Stitch/, 'live UI'],
    [/MySQL/, 'MySQL'],
    [/storage=mysql/, 'real database health'],
    [/三种单据/, 'three saved documents'],
    [/旧.*手工|历史.*明细/, 'legacy lines'],
    [/权限/, 'server auth'],
    [/P0.*P7/s, 'phase gates'],
    [/待审|未批准/, 'unapproved items'],
    [/测试.*证据|验证.*证据/, 'test evidence'],
    [/未.*部署|不得.*部署/, 'no implied deploy'],
  ]) contains(skill, pattern, 'missing ' + label);
});
check('AGENTS entrypoint', () => {
  const agents = read('AGENTS.md');
  contains(agents, /\.agents\/skills\/fabric-product-master-v2\/SKILL\.md/, 'no agent entrypoint');
});
check('knowledge base entrypoint', () => {
  const index = read('docs/product-master/README.md');
  contains(index, /fabric-product-master-v2\/SKILL\.md/, 'no project skill index');
});
check('core skills and Git sharing', () => {
  const official = ['writing-plans', 'executing-plans', 'test-driven-development', 'systematic-debugging', 'requesting-code-review', 'verification-before-completion'];
  const sharedFiles = [
    skillRel,
    ...official.map((name) => `.agents/skills/${name}/SKILL.md`),
    '.agents/skills/test-driven-development/writing-good-tests.md',
    '.agents/skills/systematic-debugging/root-cause-tracing.md',
    '.agents/skills/systematic-debugging/defense-in-depth.md',
    '.agents/skills/systematic-debugging/condition-based-waiting.md',
    '.agents/skills/requesting-code-review/code-reviewer.md',
    '.agents/skills/SUPERPOWERS-UPSTREAM.md',
    '.agents/skills/SUPERPOWERS-UPSTREAM-LICENSE',
  ];
  for (const name of official) {
    contains(read(`.agents/skills/${name}/SKILL.md`), new RegExp('^---\\r?\\nname: ' + name), 'invalid upstream skill: ' + name);
  }
  contains(read('.agents/skills/SUPERPOWERS-UPSTREAM-LICENSE'), /MIT License/, 'missing upstream license');
  for (const rel of sharedFiles) {
    read(rel);
    const ignored = spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: root });
    if (ignored.status === 0) throw new Error('Project skill excluded from Git: ' + rel);
    if (ignored.status !== 1) throw new Error('git check-ignore failed: ' + rel);
  }
});
check('pressure scenario coverage', () => {
  const cases = read('docs/product-master/fabric-v2-skill-pressure-scenarios.md');
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5']) {
    contains(cases, new RegExp('^### ' + id + '\\b', 'm'), 'missing ' + id);
  }
});
if (failures.length) {
  console.error('\nFabric V2 skill contract: ' + failures.length + ' failure(s)');
  process.exitCode = 1;
} else console.log('\nFabric V2 skill contract: PASS (static only)');
