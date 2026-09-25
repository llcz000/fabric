import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ImportPlan } from './normalize';
import { writeDryRunReport } from './report';

test('dry-run report excludes bytes paths credentials and full source payloads', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'fabric-import-report-'));
  try {
    const plan: ImportPlan = {
      sourceFile: '歌朗花型.xlsm', fileSha256: 'a'.repeat(64), sheet: '新',
      products: [{
        planKey: 'plan-1', fields: { itemNo: 'G1', productName: '花布', composition: '棉', weight: '120g', width: '150cm' }, patternTagIds: [],
        sources: [{ sheet: '新', rowNumber: 2, cells: { A: 'G1', B: '花布', C: '棉', D: '120g', E: '150cm', F: '=DISPIMG("secret")', G: '', H: '', I: '', J: 'private raw note' }, imageRefs: [], fingerprint: 'fp' }],
        images: [{ cell: 'F2', dispImgId: 'img-1', mediaEntry: 'xl/media/image1.png', role: 'pattern_original', sortOrder: 0 }],
        issues: [{ code: 'UNMAPPED_SOURCE_DATA', fieldName: 'J', message: '存在未映射的源数据', sourceRef: '新!J2', severity: 'info' }],
      }],
    };
    const report = await writeDryRunReport(plan, outputDir);
    const json = await readFile(report.jsonPath, 'utf8');
    assert.doesNotMatch(json, /cos_key|base64|D:\\\\download|private raw note|DISPIMG/i);
    assert.match(json, /歌朗花型\.xlsm/);
    assert.match(json, /UNMAPPED_SOURCE_DATA/);
    assert.equal((await readFile(report.csvPath, 'utf8')).includes('plan-1'), true);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});
