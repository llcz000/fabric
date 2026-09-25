import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { strToU8, zipSync } from 'fflate';

export interface WpsFixtureOptions {
  includeMissingRelationship?: boolean;
  unsafeEntryName?: string;
}

export async function createWpsFixture(outputDir: string, options: WpsFixtureOptions = {}): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const workbook = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="新" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'),
    'xl/media/large.bin': new Uint8Array(32).fill(7),
  };
  if (options.includeMissingRelationship) {
    entries['xl/cellimages.xml'] = strToU8('<?xml version="1.0"?><cellImages><cellImage name="missing"/></cellImages>');
  }
  if (options.unsafeEntryName) entries[options.unsafeEntryName] = strToU8('unsafe');
  const target = path.join(outputDir, `fixture-${options.unsafeEntryName ? 'unsafe' : 'valid'}.xlsm`);
  await writeFile(target, zipSync(entries));
  return target;
}
