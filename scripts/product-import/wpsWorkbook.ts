import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';

import { OoxmlArchive } from './ooxmlArchive';
import { readCellImageRelationships, readSharedStrings, readWorkbookMap, readWorksheetCells } from './xmlReaders';

export type ProductSourceColumn = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';
export interface ImportImageReference { cell: string; dispImgId: string; mediaEntry?: string; }
export interface ImportSourceRow {
  sheet: string;
  rowNumber: number;
  cells: Record<ProductSourceColumn, string>;
  imageRefs: ImportImageReference[];
}
export interface WpsProductWorkbook {
  filePath: string;
  fileSha256: string;
  sheet: string;
  rows: ImportSourceRow[];
}

const COLUMNS: ProductSourceColumn[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const DISPIMG = /(?:_xlfn\.)?DISPIMG\(\s*"([^"]+)"/i;

export async function readWpsProductWorkbook(filePath: string, sheet: string): Promise<WpsProductWorkbook> {
  if (!sheet) throw new Error('Worksheet name is required');
  const [archive, fileSha256] = await Promise.all([OoxmlArchive.open(filePath), hashFile(filePath)]);
  const workbookXml = await archive.readText('xl/workbook.xml', 4 * 1024 * 1024);
  const workbookRelationships = await archive.readText('xl/_rels/workbook.xml.rels', 4 * 1024 * 1024);
  const worksheetEntry = readWorkbookMap(workbookXml, workbookRelationships).get(sheet);
  if (!worksheetEntry) throw new Error(`Worksheet was not found: ${sheet}`);
  const entryNames = new Set(archive.list().map((entry) => entry.name));
  const sharedStrings = entryNames.has('xl/sharedStrings.xml')
    ? await readSharedStrings(await archive.readText('xl/sharedStrings.xml', 64 * 1024 * 1024))
    : [];
  const worksheetRows = await readWorksheetCells(await archive.readText(worksheetEntry, 128 * 1024 * 1024), sharedStrings);
  const imageMap = await readImageMap(archive, entryNames);
  const rows: ImportSourceRow[] = [];
  for (const [rowNumber, raw] of worksheetRows) {
    if (rowNumber === 1) continue;
    const cells = Object.fromEntries(COLUMNS.map((column) => [column, raw[column] ?? ''])) as Record<ProductSourceColumn, string>;
    if (COLUMNS.every((column) => cells[column] === '')) continue;
    const imageRefs: ImportImageReference[] = [];
    for (const column of COLUMNS.slice(5)) {
      const match = DISPIMG.exec(cells[column]);
      if (!match) continue;
      const target = imageMap.get(match[1]);
      imageRefs.push({ cell: `${column}${rowNumber}`, dispImgId: match[1], ...(target && entryNames.has(target) ? { mediaEntry: target } : {}) });
    }
    rows.push({ sheet, rowNumber, cells, imageRefs });
  }
  return { filePath, fileSha256, sheet, rows };
}

async function readImageMap(archive: OoxmlArchive, entryNames: Set<string>): Promise<Map<string, string>> {
  if (!entryNames.has('xl/cellimages.xml') || !entryNames.has('xl/_rels/cellimages.xml.rels')) return new Map();
  const raw = readCellImageRelationships(
    await archive.readText('xl/cellimages.xml', 32 * 1024 * 1024),
    await archive.readText('xl/_rels/cellimages.xml.rels', 16 * 1024 * 1024),
  );
  const safe = new Map<string, string>();
  for (const [id, target] of raw) {
    const normalized = path.posix.normalize(path.posix.join('xl', target.replace(/\\/g, '/')));
    if (!normalized.startsWith('xl/media/') || normalized.includes('/../')) throw new Error(`Unsafe cell image relationship: ${target}`);
    safe.set(id, normalized);
  }
  return safe;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

