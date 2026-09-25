import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWpsFixture } from './fixtures';
import { readWpsProductWorkbook } from './wpsWorkbook';

test('maps DISPIMG through cellimages relationships to media entries', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'fabric-wps-map-'));
  try {
    const fixture = await createWpsFixture(tempRoot, { includeProductRows: true });
    const workbook = await readWpsProductWorkbook(fixture, '新');
    assert.deepEqual(workbook.rows[0].imageRefs, [
      { cell: 'F2', dispImgId: 'img-pattern', mediaEntry: 'xl/media/image1.png' },
      { cell: 'G2', dispImgId: 'img-extra', mediaEntry: 'xl/media/image2.jpg' },
    ]);
    assert.equal(workbook.rows[0].cells.A, 'G0001');
    assert.match(workbook.fileSha256, /^[a-f0-9]{64}$/);
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
});

test('missing WPS media retains the row and unresolved image reference', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'fabric-wps-map-'));
  try {
    const fixture = await createWpsFixture(tempRoot, { includeProductRows: true, includeMissingRelationship: true });
    const workbook = await readWpsProductWorkbook(fixture, '新');
    const missing = workbook.rows.flatMap((row) => row.imageRefs).find((image) => image.dispImgId === 'img-missing');
    assert.deepEqual(missing, { cell: 'F4', dispImgId: 'img-missing' });
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
});

test('reader requires the explicitly requested worksheet', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'fabric-wps-map-'));
  try {
    const fixture = await createWpsFixture(tempRoot, { includeProductRows: true });
    await assert.rejects(readWpsProductWorkbook(fixture, '不存在'), /worksheet.*不存在/i);
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
});

