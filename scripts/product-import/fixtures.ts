import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { strToU8, zipSync } from 'fflate';

export interface WpsFixtureOptions {
  includeMissingRelationship?: boolean;
  includeProductRows?: boolean;
  unsafeEntryName?: string;
}

export async function createWpsFixture(outputDir: string, options: WpsFixtureOptions = {}): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const workbook = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="新" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(options.includeProductRows ? productSheetXml(options.includeMissingRelationship) : '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'),
    'xl/media/large.bin': new Uint8Array(32).fill(7),
  };
  if (options.includeProductRows) {
    entries['xl/cellimages.xml'] = strToU8('<?xml version="1.0"?><etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr name="img-pattern"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr name="img-extra"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic></etc:cellImage></etc:cellImages>');
    entries['xl/_rels/cellimages.xml.rels'] = strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="media/image1.png" Type="image"/><Relationship Id="rId2" Target="media/image2.jpg" Type="image"/></Relationships>');
    entries['xl/media/image1.png'] = new Uint8Array([1, 2, 3]);
    entries['xl/media/image2.jpg'] = new Uint8Array([4, 5, 6]);
  }
  if (options.unsafeEntryName) entries[options.unsafeEntryName] = strToU8('unsafe');
  const target = path.join(outputDir, `fixture-${options.unsafeEntryName ? 'unsafe' : 'valid'}.xlsm`);
  await writeFile(target, zipSync(entries));
  return target;
}

function productSheetXml(includeMissing = false): string {
  const cells = (row: number, itemNo: string, formulaF = '', formulaG = '') => `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${itemNo}</t></is></c><c r="B${row}" t="inlineStr"><is><t>花布</t></is></c><c r="C${row}" t="inlineStr"><is><t>棉</t></is></c><c r="D${row}" t="inlineStr"><is><t>120g</t></is></c><c r="E${row}" t="inlineStr"><is><t>150cm</t></is></c>${formulaF ? `<c r="F${row}" t="str"><f>_xlfn.DISPIMG(&quot;${formulaF}&quot;,1)</f></c>` : ''}${formulaG ? `<c r="G${row}" t="str"><f>_xlfn.DISPIMG(&quot;${formulaG}&quot;,1)</f></c>` : ''}</row>`;
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>货号</t></is></c></row>${cells(2, 'G0001', 'img-pattern', 'img-extra')}${cells(3, 'G0002')}${includeMissing ? cells(4, 'G0003', 'img-missing') : ''}</sheetData></worksheet>`;
}
