// P0 documentation/metadata query gate; Node built-ins only; never connects to DB.
import fs from 'node:fs';
import path from 'node:path';

const base = process.cwd();
const report = 'docs/product-master/product-master-v2-p0-technical-baseline.md';
const plan = 'docs/superpowers/plans/2026-10-12-product-master-v2-implementation.md';
const index = 'docs/product-master/README.md';
const sqlFile = 'scripts/product-master-v2-p0-inspect-readonly.sql';
const failures = [];
const check = (name, fn) => {
  try { fn(); console.log('PASS', name); }
  catch (err) { failures.push(name); console.error('FAIL', name, err.message); }
};
const read = (name) => fs.readFileSync(path.join(base, name), 'utf8');
check('P0 report and current requirements', () => {
  const text = read(report);
  read('docs/product-master/product-master-v2-requirements.md');
  for (const fragment of ['v1.36', 'P0-2', '未完成', 'INFORMATION_SCHEMA', '12列', '订单', '旧', 'P1-A', '403', '409', 'storage=mysql']) {
    if (!text.includes(fragment)) throw Error('Report missing: ' + fragment);
  }
});
check('Stitch seven-page UI approval stays distinct from pending behavior', () => {
  const requirements = read('docs/product-master/product-master-v2-requirements.md');
  const progress = read('docs/product-master/product-master-v2-progress.md');
  const stitch = read('docs/product-master/product-master-v2-stitch-design-review.md');
  const planText = read(plan);
  const architecture = read('docs/superpowers/specs/2026-10-12-product-master-v2-architecture.md');
  if (!requirements.includes('product-master-v2-stitch-design-review.md')) throw Error('Current requirements must link the UI approval register');
  if (!progress.includes('P0-4 | Stitch七页UI') || !progress.includes('全部业务决策已确认')) {
    throw Error('P0-4 subtask status not explicit');
  }
  for (const [name, value] of [['Stitch register', stitch], ['Progress', progress], ['Architecture', architecture], ['P0 plan', planText]]) {
    if (!(value.includes('七页UI') || value.includes('Stitch七页')) || !(/已批准|已确认|批准/.test(value))) throw Error(name + ' missing UI approval');
  }
  const currentRows = stitch.split('\n').filter(line => /^\| .*UI已确认/.test(line));
  if (currentRows.length !== 7) throw Error('Expected exactly seven current approved Stitch rows, got ' + currentRows.length);
  for (const id of ['8a6e9e4e58e5447f8fd5394e7a6de9f5', '138aa243d7f548b18e92789d382482de', 'f2c1ab5adbba4c50bb876fc2f7d75b41', '1ac8dc0f5f65419aaa80bc264a43abde', '4e49bb73b9ad4ea6a3bca3b3031b4805', '18bf13584579427fbbba015239957622', 'bab4de3e72cd44ffa4cdd4d5ff0e311c']) {
    if (!stitch.includes(id)) throw Error('Missing approved Stitch screen ' + id);
  }
  if (!stitch.includes('12列') || !stitch.includes('备注')) throw Error('Product remarks not protected');
  if (!planText.includes('- [x] D-01') || !planText.includes('- [x] D-02') || !planText.includes('- [x] D-03')) throw Error('D-01/D-02/D-03 approval not fully recorded');
  for (const marker of ['永久只读', '.xlsx', '.xls', '门幅', 'D-03 / R-03']) {
    if (!requirements.includes(marker)) throw Error('Approved D-01/D-03 rules missing: '+marker);
  }
  if (!progress.includes('尚未实现.xls')) throw Error('Cannot mistake approval for actual xls implementation');
});
check('metadata SQL only contains read queries', () => {
  const script = read(sqlFile);
  const clean = script.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const queries = clean.split(';').map(x=>x.trim()).filter(Boolean);
  if (queries.length < 4) throw Error('Missing expected inspection queries');
  for (const q of queries) {
    if (!/^SELECT\s/i.test(q)) throw Error('Not read-only SQL: ' + q.slice(0,45));
    if (/\b(INTO\s+(?:OUTFILE|DUMPFILE)|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/i.test(q)) throw Error('Disallowed SELECT side effect');
  }
  if (!/information_schema\.COLUMNS/i.test(clean) || !/information_schema\.KEY_COLUMN_USAGE/i.test(clean)) {
    throw Error('Missing column/FK introspection');
  }
  console.log('  Verified', queries.length, 'read-only SELECT statements (static)');
});
check('P0 plan correctly remains open', () => {
  const text = read(plan);
  if (!text.includes('P0整体Gate **未通过**')) throw Error('P0 prematurely marked passed');
  if (!text.includes('P0-2 已通过远程SSH只读核验')) throw Error('P0-2 remote-audit result not recorded');
  if (!text.includes('P1-A')) throw Error('P1-A slice not referenced');
  const audit = read('docs/product-master/product-master-v2-remote-db-audit.md');
  for (const marker of ['8.0.46', '1,211', '1,008', '944', '118', '148', 'v2_fabrics', 'storage=mysql', '未执行']) {
    if (!audit.includes(marker)) throw Error('Remote audit missing: ' + marker);
  }
});
check('knowledge index and relative Markdown links', () => {
  if (!read(index).includes('product-master-v2-p0-technical-baseline.md')) throw Error('README lacks P0 link');
  for (const name of [report,index,plan]) {
    for (const match of read(name).matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(https?:|codex:|chatgpt-|mailto:)/i.test(target) || target.startsWith('/')) continue;
      const full = path.resolve(base, path.dirname(name), target);
      if (!fs.existsSync(full)) throw Error('Broken link: ' + name + ' -> ' + target);
    }
  }
});
if (failures.length) {
  console.error('P0 static gate:', failures.length, 'failure(s)');
  process.exitCode = 1;
} else console.log('P0 static documentation gate: PASS (NOT real DB or API verification)');
