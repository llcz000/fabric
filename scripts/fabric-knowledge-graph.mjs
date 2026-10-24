// Fabric knowledge topology: metadata and links, never a second copy of business requirements.
// CLI: audit | map [--json|--mermaid] | impact ID_OR_PATH [--json] | changed [--json]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = 'scripts/fabric-knowledge-registry.json';
const requirementRow = /^\|\s*([A-Z][A-Z0-9]*-\d{2,3})\s*\|/gm;
const acceptanceRow = /^\|\s*(AC-\d{2,3})(?:（[^|]*）)?\s*\|/gm;
const safeRead = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const unix = (p) => p.replace(/\\/g, '/');
const isTest = (p) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p);
const idSort = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const uniq = (xs) => [...new Set(xs)].sort(idSort);
const entryRe = /(^|[^A-Z0-9])([A-Z][A-Z0-9]*-\d{2,3})(?![A-Z0-9])/g;
function walk(dir, root) {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return [unix(path.relative(root, dir))];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'tmp', 'artifacts'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full, root));
    else if (entry.isFile()) result.push(unix(path.relative(root, full)));
  }
  return result;
}
function idsFromTable(text, regex) {
  return [...text.matchAll(regex)].map(m => m[1]);
}
function isInScope(spec, file) { return file === spec || file.startsWith(spec + '/'); }
function assigned(rule, id) {
  return rule === id || (rule.endsWith('*') && id.startsWith(rule.slice(0, -1)));
}
function linksFrom(text, source, root) {
  const refs = [];
  for (const m of text.matchAll(/!?\[[^\]]*]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']+["'])?\)/g)) {
    let to = m[1].replace(/^<|>$/g,'').split('#')[0];
    if (!to || /^[a-z][a-z0-9+.-]*:/i.test(to) || to.startsWith('/')) continue;
    try { to = decodeURIComponent(to); } catch { continue; }
    const absolute = path.resolve(root, path.dirname(source), to);
    if (absolute.startsWith(root + path.sep) && fs.existsSync(absolute)) refs.push(unix(path.relative(root, absolute)));
  }
  return uniq(refs);
}
function getChanged(root, base) {
  const result = new Set();
  const operations=base ? [['diff','--name-only',base,'HEAD']] : [['diff', '--name-only'], ['diff', '--cached', '--name-only'], ['ls-files', '--others', '--exclude-standard']];
  for (const flags of operations) {
    const r = spawnSync('git', ['-c','core.quotepath=false',...flags, '-z', '--'], { cwd: root, encoding: 'utf8' });
    if (r.status === 0) r.stdout.split('\0').filter(Boolean).forEach(f => result.add(unix(f)));
  }
  return [...result].sort(idSort);
}
function changedRequirements(root, authority, canonicalIds, base) {
  const matched = new Set();
  let fallback = false;
  const diffs=base ? [['diff','--unified=0',base,'HEAD','--',authority]] : [['diff', '--unified=0', '--', authority], ['diff', '--cached', '--unified=0', '--', authority]];
  for (const args of diffs) {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) continue;
    for (const line of r.stdout.split(/\r?\n/)) {
      if (!/^[+-](?![+-])/.test(line)) continue;
      const found = [...line.slice(1).matchAll(entryRe)].map(m => m[2]).filter(id => canonicalIds.has(id));
      if (found.length) found.forEach(id => matched.add(id));
      else if (line.trim().length > 2) fallback = true;
    }
  }
  // Non-table changes can affect adjacent or multiple requirements. Fail open to all, not silently miss one.
  return { ids: fallback ? [...canonicalIds].sort(idSort) : [...matched].sort(idSort), broad: fallback };
}
function changedAcceptanceIds(root, authority, acLinks, base) {
  const diffs=base ? [['diff','--unified=0',base,'HEAD','--',authority]] : [['diff','--unified=0','--',authority],['diff','--cached','--unified=0','--',authority]];
  const found=new Set();
  let broad=false;
  for (const args of diffs) {
    const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
    if (result.status!==0) { broad=true;continue; }
    for (const line of result.stdout.split(/\r?\n/)) {
      if (!/^[+-](?![+-])/.test(line)) continue;
      const match=/^[-+]\|\s*(AC-\d{2,3})\s*\|/.exec(line);
      if (match && acLinks.has(match[1])) found.add(match[1]);
      else if (line.trim().length>2) broad=true;
    }
  }
  if (broad || !found.size) return { ids:uniq([...acLinks.values()].flat()),broad:true };
  return { ids:uniq([...found].flatMap(ac=>acLinks.get(ac))),broad:false };
}
export function buildKnowledge(root = ROOT, override = undefined) {
  const reg = override ?? JSON.parse(safeRead(root, REGISTRY_PATH));
  const errors = [], warnings = [];
  const fail = (s) => errors.push(s);
  if (reg.format !== 'fabric-knowledge-registry-v1') fail('Invalid registry version');
  const docDefs = reg.documents || [], domainDefs = reg.domains || [];
  const docPaths = docDefs.map(x => x.path);
  const listed = new Set(docPaths);
  const actual = walk(path.join(root, 'docs'), root).filter(p => p.endsWith('.md'));
  if (docPaths.length !== listed.size) fail('Duplicate document registry path');
  for (const doc of docDefs) {
    if (typeof doc.path !== 'string' || !doc.path.startsWith('docs/') || doc.path.includes('..')) {
      fail('Invalid document path ' + doc.path); continue;
    }
    if (!['business','acceptance','navigation','architecture','status','reference','procedure','policy','template'].includes(doc.role)) fail('Unclassified document: ' + doc.path);
    if (!doc.owner || !doc.purpose || doc.purpose.length < 6) fail('Document missing owner/purpose: ' + doc.path);
    if (/\d{4}-\d{2}-\d{2}/.test(doc.path) &&
      !['docs/ui-design/ui-page-visual-review.md','docs/ui-design/product-positioning.md','docs/ui-design/wechat-card-share.md'].includes(doc.path)) {
      fail('New date-stamped document forbidden: ' + doc.path);
    }
    if (!fs.existsSync(path.join(root, doc.path))) fail('Catalog references missing document: ' + doc.path);
  }
  for (const file of actual) if (!listed.has(file)) fail('New Markdown file without approved catalog entry: ' + file);
  for (const file of listed) if (!actual.includes(file)) fail('Stale document registration: ' + file);
  const approvedData=['docs/project/fabric-v2-active-workspace.json','docs/project/fabric-v2-agent-queue.json'];
  for (const file of walk(path.join(root,'docs'),root).filter(p=>/\.(?:json|ya?ml|txt)$/i.test(p))) {
    if (!approvedData.includes(file)) fail('Unapproved data/process file under docs: ' + file);
  }
  if (docDefs.filter(x=>x.role==='business').map(x=>x.path).join(',') !== reg.canonicalRequirementFile) fail('Exactly one business authority required');
  if (docDefs.filter(x=>x.role==='acceptance').map(x=>x.path).join(',') !== reg.acceptanceFile) fail('Exactly one supplementary acceptance file required');
  const canonicalText = safeRead(root, reg.canonicalRequirementFile);
  const reqIds = idsFromTable(canonicalText, requirementRow);
  const canonical = new Set(reqIds);
  if (canonical.size !== reqIds.length) fail('Duplicate requirement IDs in canonical specification');
  if (!canonical.size) fail('Canonical requirement table is empty');
  const acceptanceText=safeRead(root,reg.acceptanceFile);
  const acceptance=idsFromTable(acceptanceText,acceptanceRow);
  const acLinks=new Map();
  for (const line of acceptanceText.split(/\r?\n/).filter(line=>/^\|\s*AC-\d{2,3}\s*\|/.test(line))) {
    const cells=line.split('|').slice(1,-1).map(c=>c.trim());
    const ac=cells[0];
    if (cells.length!==4 || !cells[2] || !cells[3]) { fail('AC must have four cells (ID, requirement ID, scenario, criterion): '+ac); continue; }
    const targets=cells[1].split(',').map(x=>x.trim());
    if (!targets.length || targets.some(id=>!canonical.has(id))) fail('AC references missing canonical requirement: '+ac+' -> '+cells[1]);
    if (new Set(targets).size!==targets.length) fail('AC has duplicate requirement references: '+ac);
    acLinks.set(ac,targets);
  }
  if (new Set(acceptance).size !== acceptance.length) fail('Duplicate AC identifiers');
  for (const ac of acceptance) if (!acLinks.has(ac)) fail('AC has no requirement mapping: '+ac);

  const domainIds = new Set(), perRequirement = new Map();
  const domainSources = new Map();
  for (const domain of domainDefs) {
    if (!domain.id || domainIds.has(domain.id)) fail('Duplicate/invalid domain ' + domain.id);
    domainIds.add(domain.id);
    if (!domain.name || !domain.docs?.length || !domain.req?.length) fail('Domain missing name, documents, or requirements: ' + domain.id);
    const owned = new Set();
    for (const r of domain.req || []) {
      const found = reqIds.filter(id => assigned(r, id));
      if (!found.length) fail('Domain references no valid canonical requirement: ' + domain.id + ':' + r);
      found.forEach(id => { owned.add(id); perRequirement.set(id, new Set([...(perRequirement.get(id) || []), domain.id])); });
    }
    for (const doc of domain.docs || []) if (!listed.has(doc)) fail('Domain refers to undocumented resource: ' + domain.id + ':' + doc);
    const sourcePaths = [];
    for (const entry of domain.source || []) {
      if (!/^(server|src|scripts)\//.test(entry) || entry.includes('..')) { fail('Unsafe source binding: ' + entry); continue; }
      const absolute = path.join(root, entry);
      if (!fs.existsSync(absolute)) { fail('Missing source binding: ' + domain.id + ':' + entry); continue; }
      sourcePaths.push(...walk(absolute, root).filter(x => /\.[cm]?[jt]sx?$/.test(x)));
    }
    domainSources.set(domain.id, uniq(sourcePaths));
    if (!domain.planned && !sourcePaths.length) fail('Active domain has no code binding: ' + domain.id);
    if (!domain.planned && !sourcePaths.some(isTest)) warnings.push('No automatically discoverable unit test in ' + domain.id + ' (trace candidate only)');
  }
  for (const id of reqIds) if (!perRequirement.has(id)) fail('Canonical requirement has no domain: ' + id);
  for (const file of actual) {
    if (file === reg.canonicalRequirementFile) continue;
    const content = safeRead(root, file);
    const duplicate = idsFromTable(content, requirementRow).filter(id => canonical.has(id));
    if (duplicate.length) fail('Repeated business definition in ' + file + ': ' + uniq(duplicate).join(', '));
  }

  // Retired business promises must not re-enter the canonical requirement or AC table.
  // Deliberately narrow patterns: a passing content gate cannot replace human semantic review.
  const retiredClauses = [
    /新增产品先设为不可供样/,
    /补图并确认后再开放供样/,
    /按两个维度组合查询/,
    /客户归属与协作权限/,
    /分批寄样记录/,
    /应送\/已送\/待送/,
    /价格按面料类别\/币种\/单位\/含税口径/,
    /新增.*启用状态.*操作/,
  ];
  for (const rel of [reg.canonicalRequirementFile,reg.acceptanceFile]) {
    for (const pattern of retiredClauses) if (pattern.test(safeRead(root,rel))) fail('Retired active business clause in '+rel+': '+pattern.source);
  }
  const nodes = new Map(), edges = [], edgeKeys = new Set();
  const node = (id, kind, name = id) => { if (!nodes.has(id)) nodes.set(id, { id, kind, name }); };
  const edge = (from, to, relation, confidence='explicit') => {
    const key = from + '|' + to + '|' + relation;
    if (!edgeKeys.has(key)) { edges.push({ from, to, relation, confidence }); edgeKeys.add(key); }
  };
  for (const doc of docDefs) node('doc:'+doc.path, 'document', doc.path);
  for (const id of reqIds) { node('req:'+id, 'requirement', id); edge('doc:'+reg.canonicalRequirementFile,'req:'+id,'defines'); }
  for (const ac of acceptance) {
    node('ac:'+ac,'acceptance', ac);
    edge('doc:'+reg.acceptanceFile,'ac:'+ac,'defines');
    for (const id of acLinks.get(ac)||[]) if (canonical.has(id)) edge('req:'+id,'ac:'+ac,'verified-by-acceptance','explicit');
  }
  for (const domain of domainDefs) {
    node('domain:'+domain.id,'domain',domain.name);
    for (const id of reqIds.filter(i => domain.req.some(p=>assigned(p,i)))) edge('req:'+id,'domain:'+domain.id,'affects');
    for (const doc of domain.docs) edge('domain:'+domain.id,'doc:'+doc,'documented-in');
    for (const file of domainSources.get(domain.id) || []) {
      const kind = isTest(file) ? 'test' : 'source';
      node(kind+':'+file, kind, file);
      edge('domain:'+domain.id,kind+':'+file,kind==='test'?'test-candidate':'implementation-candidate','domain-inferred');
    }
  }
  for (const file of actual) {
    const contents = safeRead(root,file);
    for (const target of linksFrom(contents,file,root)) {
      const kind = target.startsWith('docs/') ? 'doc' : 'file';
      if (kind==='doc' && !listed.has(target)) continue;
      node(kind+':'+target,kind==='doc'?'document':'file',target);
      edge('doc:'+file,kind+':'+target,'links-to');
    }
    for (const m of contents.matchAll(entryRe)) {
      if (canonical.has(m[2]) && file !== reg.canonicalRequirementFile) edge('req:'+m[2],'doc:'+file,'mentioned-in','text-reference');
    }
  }
  // Source references explicitly named by docs are separate from domain-based candidates.
  for (const [key,data] of nodes) if ((data.kind==='source' || data.kind==='test') && fs.existsSync(path.join(root,data.name))) {
    for (const file of actual) {
      const content=safeRead(root,file);
      if (content.includes(data.name)) edge('doc:'+file,key,'mentions-path','text-reference');
    }
  }
  const uncovered=reqIds.filter(id=>![...acLinks.values()].some(ids=>ids.includes(id)));
  return { root, registry:reg, canonical, acceptance, acLinks, uncovered, documents:docDefs, reqIds, domainSources, perRequirement, nodes:[...nodes.values()], edges, errors, warnings };
}
function affected(graph, reqIds, paths) {
  const domains = new Set();
  reqIds.forEach(id => (graph.perRequirement.get(id)||[]).forEach(d=>domains.add(d)));
  for (const file of paths) for (const domain of graph.registry.domains) {
    if (domain.source.some(spec=>isInScope(spec,file)) || domain.docs.includes(file)) domains.add(domain.id);
  }
  const docPaths = new Set(paths.filter(p=>p.startsWith('docs/') && fs.existsSync(path.join(graph.root,p))));
  const codePaths = new Set(), testPaths = new Set();
  for (const domain of graph.registry.domains.filter(d=>domains.has(d.id))) {
    domain.docs.forEach(d=>docPaths.add(d));
    for (const file of graph.domainSources.get(domain.id)||[]) (isTest(file)?testPaths:codePaths).add(file);
  }
  for (const edge of graph.edges) {
    if (edge.relation==='mentioned-in' && reqIds.includes(edge.from.slice(4))) docPaths.add(edge.to.slice(4));
    if (edge.relation==='links-to' && paths.includes(edge.to.replace(/^(doc|file):/,''))) docPaths.add(edge.from.slice(4));
  }
  const acceptanceIds=uniq([...graph.acLinks.entries()].filter(([ac,ids])=>ids.some(id=>reqIds.includes(id))).map(([ac])=>ac));
  return { requirementIds:uniq(reqIds), acceptanceIds, domainIds:uniq([...domains]), documents:uniq([...docPaths]), sources:uniq([...codePaths]), tests:uniq([...testPaths]), note:'AC links are explicit; source/test associations are domain-level impact candidates, not verified code coverage.' };
}
export function impact(graph, selector) {
  if (graph.canonical.has(selector)) return affected(graph,[selector],[]);
  if (graph.acLinks.has(selector)) return affected(graph,graph.acLinks.get(selector),[]);
  const file=unix(selector).replace(/^\.\//,'');
  if (file===graph.registry.canonicalRequirementFile) return affected(graph,graph.reqIds,[file]);
  if (file===graph.registry.acceptanceFile) return affected(graph,uniq([...graph.acLinks.values()].flat()),[file]);
  if (!file.startsWith('docs/') && !file.startsWith('src/') && !file.startsWith('server/') && !file.startsWith('scripts/')) {
    throw Error('Expected canonical requirement ID or project-relative file path: '+selector);
  }
  if (!fs.existsSync(path.join(graph.root,file))) throw Error('Not found: '+file);
  return affected(graph,[],[file]);
}
export function changedImpact(graph, base) {
  const paths=getChanged(graph.root,base);
  let ids=[],broad=false;
  if (paths.includes(graph.registry.canonicalRequirementFile)) {
    const result=changedRequirements(graph.root,graph.registry.canonicalRequirementFile,graph.canonical,base);
    ids=result.ids; broad=result.broad;
  }
  if (paths.includes(graph.registry.acceptanceFile)) {
    const result=changedAcceptanceIds(graph.root,graph.registry.acceptanceFile,graph.acLinks,base);
    ids=uniq([...ids,...result.ids]);
    broad=broad||result.broad;
  }
  // If a file under a domain is modified, review its domain. No implicit "all code is up to date" claim.
  const report=affected(graph, ids, paths);
  return { ...report, changedPaths:paths, broadRequirementChange:broad };
}
const cut = (arr, size=20) => arr.slice(0,size).join(', ') + (arr.length>size?' … (+'+(arr.length-size)+')':'');
function printImpact(report, asJson=false) {
  if (asJson) { console.log(JSON.stringify(report,null,2));return; }
  console.log('需求:',cut(report.requirementIds));
  console.log('直接关联AC:',report.acceptanceIds.length,cut(report.acceptanceIds));
  console.log('影响域:',cut(report.domainIds));
  console.log('文档:',cut(report.documents,14));
  console.log('代码候选:',report.sources.length, cut(report.sources,12));
  console.log('测试候选:',report.tests.length, cut(report.tests,12));
  if (report.changedPaths) console.log('变更文件:',cut(report.changedPaths,14));
  if (report.broadRequirementChange) console.log('注意：存在无法精确归入需求编号的变更，采用全部需求作为保守影响范围');
  console.log(report.note);
}
function printMap(graph, format) {
  const {nodes,edges,reqIds,documents,registry}=graph;
  if (format==='json') return console.log(JSON.stringify({ nodes,edges,domains:registry.domains },null,2));
  if (format==='mermaid') {
    console.log('flowchart LR');
    console.log('  canon["项目需求总览：唯一业务规则"]');
    console.log('  detail["产品主数据：补充验收"]');
    for (const d of registry.domains) {
      console.log('  '+d.id+'["'+d.name+'"]');
      console.log('  canon --> '+d.id);
      if (d.docs.includes(registry.acceptanceFile)) console.log('  '+d.id+' --> detail');
      if ((graph.domainSources.get(d.id)||[]).length) console.log('  '+d.id+' --> '+d.id+'_code["代码/测试候选"]');
    }
    return;
  }
  console.log('文档:',documents.length,'需求:',reqIds.length,'验收:',graph.acceptance.length,'已关联需求:',reqIds.length-graph.uncovered.length,'无直接AC:',graph.uncovered.length,'节点:',nodes.length,'关联:',edges.length,'影响域:',registry.domains.length);
  if (graph.uncovered.length) console.log('无直接AC的需求（可能为跨域、后续范围或待补验证）:',cut(graph.uncovered,25));
  for (const d of registry.domains) {
    const owned=reqIds.filter(id=>d.req.some(x=>assigned(x,id)));
    const files=graph.domainSources.get(d.id)||[];
    console.log(d.id.padEnd(12),d.name,'需求',owned.length,'源码',files.filter(f=>!isTest(f)).length,'测试',files.filter(isTest).length,d.planned?'待实施':'');
  }
  console.log('使用 impact REQ-ID / changed 查看逆向影响；map --json 为全节点关系图；map --mermaid 为全域概览。');
}
function main() {
  const [command='audit',...argv] = process.argv.slice(2);
  const graph=buildKnowledge();
  if (graph.errors.length) { graph.errors.forEach(e=>console.error('FAIL',e));process.exitCode=1;return; }
  if (command==='audit') {
    console.log('PASS docs admission, sole requirement authority, unique IDs and domain coverage');
    console.log('Docs',graph.documents.length,'requirements',graph.reqIds.length,'mapped AC',graph.acLinks.size,'requirements with direct AC',graph.reqIds.length-graph.uncovered.length,'without direct AC',graph.uncovered.length,'domains',graph.registry.domains.length,'nodes',graph.nodes.length,'edges',graph.edges.length);
    graph.warnings.forEach(w=>console.log('WARN',w));
    return;
  }
  if (command==='map') return printMap(graph,argv.includes('--json')?'json':argv.includes('--mermaid')?'mermaid':'text');
  if (command==='impact') {
    if (!argv[0]) throw Error('Usage: impact REQUIREMENT-ID_OR_PROJECT_PATH [--json]');
    return printImpact(impact(graph,argv[0]),argv.includes('--json'));
  }
  if (command==='changed') {
    const index=argv.indexOf('--base');
    const base=index>=0 ? argv[index+1] : undefined;
    if (index>=0 && (!base || base.startsWith('--'))) throw Error('Missing --base Git ref');
    return printImpact(changedImpact(graph,base),argv.includes('--json'));
  }
  throw Error('Usage: audit | map [--json|--mermaid] | impact ID_OR_PATH [--json] | changed [--json]');
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { main(); } catch(e) { console.error('FAIL',e.message);process.exitCode=1; }
}
