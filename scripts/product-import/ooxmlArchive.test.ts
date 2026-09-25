import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createWpsFixture } from './fixtures';
import { OoxmlArchive } from './ooxmlArchive';
import { readSharedStrings, readWorksheetCells } from './xmlReaders';

test('reads only requested OOXML entries and enforces entry limits', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'fabric-wps-fixture-'));
  try {
    const fixture = await createWpsFixture(tempRoot, { includeMissingRelationship: false });
    const archive = await OoxmlArchive.open(fixture);
    assert.equal((await archive.readText('xl/workbook.xml', 1_000_000)).includes('sheet name="新"'), true);
    assert.equal(archive.list().some((entry) => entry.name === 'xl/media/large.bin'), true);
    await assert.rejects(archive.readBuffer('xl/media/large.bin', 8), /entry byte limit/i);
    await assert.rejects(archive.readBuffer('../outside', 100), /unsafe OOXML entry/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('worksheet reader handles shared inline formula numeric and blank cells', async () => {
  const shared = await readSharedStrings('<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>共享值</t></si></sst>');
  const rows = await readWorksheetCells(`<?xml version="1.0"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2">
      <c r="A2" t="s"><v>0</v></c><c r="B2" t="inlineStr"><is><t>内联</t></is></c>
      <c r="C2"><f>DISPIMG("img-1",1)</f><v>cached</v></c><c r="D2"><v>120</v></c><c r="E2"/>
    </row></sheetData></worksheet>`, shared);
  assert.deepEqual(rows.get(2), { A: '共享值', B: '内联', C: '=DISPIMG("img-1",1)', D: '120', E: '' });
});

test('archive rejects unsafe and duplicate ZIP entry names', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'fabric-wps-fixture-'));
  try {
    const traversal = await createWpsFixture(tempRoot, { unsafeEntryName: '../evil.xml' });
    await assert.rejects(OoxmlArchive.open(traversal), /unsafe OOXML entry/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('invalid XML is rejected instead of partially parsed', async () => {
  await assert.rejects(readWorksheetCells('<worksheet><sheetData>', []), /XML/i);
});
