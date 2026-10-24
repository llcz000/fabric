/**
 * Fabric V2: small, deterministic task-brief router.
 * Intentionally emits file paths, not the contents of huge requirement files.
 * This is NOT an access-control sandbox or authorization to deploy/write DB.
 */
import { pathToFileURL } from 'node:url';

const shared = Object.freeze([
  'AGENTS.md',
  'docs/product-master/README.md',
  'docs/product-master/product-master-v2-requirements.md',
]);
const profiles = Object.freeze({
  A: {
    goal: 'P1/B2-5 MySQL schema and isolated verification readiness',
    acceptance: ['AC-71', 'AC-96', 'AC-98', 'AC-99'],
    contextFiles: ['server/product-master/schema.ts', 'server/customer-samples/schema.ts', 'server/product-master/schemaContract.ts'],
    ownedPaths: ['scripts/test-v2-b25-mysql.ts', 'server/product-master/schema.ts',
      'server/product-master/colorwayMigrationPreflight.ts',
      'server/product-master/colorwayMigrationPreflight.test.ts',
      'server/product-master/migrationLockRollbackPlan.ts',
      'server/product-master/migrationLockRollbackPlan.test.ts'],
    boundaries: ['禁止在远程MySQL运行DDL/DML；写测需另行明确授权', '不能修改其他Agent拥有的扫码或媒体目录'],
  },
  B: {
    goal: 'P3 master, colorway and shared image assets correctness',
    acceptance: ['AC-05', 'AC-06', 'AC-07', 'AC-12'],
    contextFiles: ['server/product-master/patternMasters.ts', 'server/image-assets/schema.ts'],
    ownedPaths: ['server/product-master/patternMasters.ts', 'server/image-assets/'],
    boundaries: ['不得修改A拥有的schema或C拥有的XLSX导入', '不得真实删除COS对象'],
  },
  C: {
    goal: 'P4/P5 already-approved Stitch screens and XLSX business semantics',
    acceptance: ['AC-65', 'AC-66', 'AC-72'],
    contextFiles: ['server/product-master/fabricExcelImport.ts',
      'src/components/product-master-v2/ProductCatalogWorkspaceV2.tsx',
      'src/components/product-master-v2/FabricImportV2.tsx'],
    ownedPaths: ['server/product-master/fabricExcelImport.ts', 'server/product-master/fabricExcelImport.test.ts',
      'src/components/product-master-v2/PatternLibraryV2.tsx', 'src/components/product-master-v2/PatternLibraryV2.test.ts',
      'src/components/product-master-v2/FabricLibraryV2.tsx', 'src/components/product-master-v2/FabricLibraryV2.test.ts',
      'src/components/product-master-v2/ProductEditorV2.tsx', 'src/components/product-master-v2/ProductEditorV2.test.ts',
      'src/components/product-master-v2/ProductCatalogWorkspaceV2.tsx', 'src/components/product-master-v2/ProductCatalogWorkspaceV2.test.ts',
      'src/components/product-master-v2/FabricImportV2.tsx', 'src/components/product-master-v2/FabricImportV2.test.ts'],
    boundaries: ['仅支持xlsx，不恢复xls', '新UI默认React；仅实际操作Stitch时才核对现存用户改稿，不改正式App.tsx'],
  },
  D: {
    goal: 'P6 order-document selection, snapshot and reference protection',
    acceptance: ['AC-67', 'AC-68', 'AC-64'],
    contextFiles: ['server/order-v2/lines.ts', 'docs/retrospectives/README.md'],
    ownedPaths: ['server/order-v2/'],
    boundaries: ['已保存历史单据不能依赖客户端标记决定数据真伪', '单据后端与全局装配入口分权'],
  },
  E: {
    goal: 'B1 secure customer-facing pattern sharing and B3 selection handoff',
    acceptance: ['AC-73', 'AC-74', 'AC-75', 'AC-84'],
    contextFiles: ['server/customer-share/publicPatternProjection.ts', 'server/customer-share/patternLinkStore.ts',
      'docs/ui-design/component-rules.md'],
    ownedPaths: ['server/customer-share/',
      'server/customer-samples/sessionManual.ts', 'server/customer-samples/sessionManual.test.ts',
      'server/customer-samples/sessionManualRoutes.ts',
      'src/components/product-master-v2/SampleSelectionPanel.tsx',
      'src/components/product-master-v2/SampleSelectionPanel.test.ts',
      'src/components/product-master-v2/SampleSelectionWorkspaceV2.tsx',
      'src/components/product-master-v2/sampleSelectionClient.ts',
      'src/components/product-master-v2/sampleSelectionClient.test.ts'],
    boundaries: ['公开分享链接与业务员实体色卡扫码严格隔离，不暴露选样/寄样/客户信息',
      '人工补选按当前要求，不重复设计；正式接线/实库/公开分享按本次证据判断，勿把纯投影或映射合同当公网上线'],
  },
});

const gates = Object.freeze([
  'TDD RED -> GREEN',
  '专项测试 + 检查变更路径',
  '按变更影响串行验证；全量测试/lint/build仅在范围或交付门禁要求时执行',
  'spec核对 + 代码复核 + 待审事项保留',
]);

export function profileIds() { return Object.keys(profiles); }

export function buildBrief(agent) {
  if (typeof agent !== 'string' || !Object.hasOwn(profiles, agent)) {
    throw new Error('Unknown Fabric agent profile');
  }
  const p = profiles[agent];
  return {
    agent,
    goal: p.goal,
    acceptance: [...p.acceptance],
    contextFiles: [...shared, ...p.contextFiles],
    ownedPaths: [...p.ownedPaths],
    boundaries: [...p.boundaries],
    gates: [...gates],
    handoff: ['文件变更(精确路径)', 'RED/GREEN/回归测试证据', '新风险与待审项', '历史文档: 保留/归档候选/不适用（列未完成Gate）', '是否修改数据库/正式App/部署（默认否）'],
  };
}

export function formatBrief(b) {
  const list = a => a.map(x => `- ${x}`).join('\n');
  return [
    `# Fabric V2 Agent ${b.agent} 单任务简报`,
    `目标: ${b.goal}`,
    `验收ID: ${b.acceptance.join(', ')}`,
    '优先只读文件（根据当前任务挑所需片段，禁止无差别整库全文读取）:', list(b.contextFiles),
    '允许修改路径（仅此范围，路径约束不等于OS级沙箱）:', list(b.ownedPaths),
    '业务/安全边界:', list(b.boundaries),
    '验证门:', list(b.gates),
    '交接格式:', list(b.handoff),
    '统一禁止: Git clean/reset/commit/push、远程MySQL写入、生产部署与删除数据；共享server.ts/App.tsx由总控负责。',
    '有缺口先报告 NEEDS_CONTEXT，仅追加缺失片段；不要自行扩大阅读/修改范围。',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const id = process.argv[2];
    const brief = buildBrief(id);
    process.stdout.write(process.argv[3] === '--json'
      ? JSON.stringify(brief, null, 2) + '\n'
      : formatBrief(brief) + '\n');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
