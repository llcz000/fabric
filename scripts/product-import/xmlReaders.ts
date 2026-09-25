import path from 'node:path';

import { SaxesParser, type SaxesTag } from 'saxes';

export interface WorksheetCell { ref: string; value: string; formula?: string; }

export async function readSharedStrings(xml: string): Promise<string[]> {
  const values: string[] = [];
  let insideItem = false;
  let insideText = false;
  let current = '';
  parseXml(xml, {
    open(tag) {
      const name = localName(tag);
      if (name === 'si') { insideItem = true; current = ''; }
      if (insideItem && name === 't') insideText = true;
    },
    text(value) { if (insideText) current += value; },
    close(name) {
      if (name === 't') insideText = false;
      if (name === 'si') { values.push(current); insideItem = false; }
    },
  });
  return values;
}

export async function readWorksheetCells(xml: string, sharedStrings: string[]): Promise<Map<number, Record<string, string>>> {
  const rows = new Map<number, Record<string, string>>();
  let rowNumber = 0;
  let cell: { ref: string; type: string; value: string; formula: string; inline: string } | undefined;
  let capture: 'v' | 'f' | 't' | undefined;
  parseXml(xml, {
    open(tag) {
      const name = localName(tag);
      if (name === 'row') rowNumber = integerAttribute(tag, 'r');
      if (name === 'c') cell = { ref: attribute(tag, 'r'), type: attribute(tag, 't'), value: '', formula: '', inline: '' };
      if (cell && (name === 'v' || name === 'f' || name === 't')) capture = name;
    },
    text(value) {
      if (!cell || !capture) return;
      if (capture === 'v') cell.value += value;
      else if (capture === 'f') cell.formula += value;
      else cell.inline += value;
    },
    close(name) {
      if (name === capture) capture = undefined;
      if (name !== 'c' || !cell) return;
      const match = /^([A-Z]+)(\d+)$/.exec(cell.ref);
      if (!match) throw new Error(`Invalid worksheet cell reference: ${cell.ref}`);
      const targetRow = rowNumber || Number(match[2]);
      const column = match[1];
      const value = cell.formula
        ? `=${cell.formula}`
        : cell.type === 's'
          ? sharedStrings[Number(cell.value)] ?? ''
          : cell.type === 'inlineStr'
            ? cell.inline
            : cell.value;
      const row = rows.get(targetRow) ?? {};
      row[column] = value;
      rows.set(targetRow, row);
      cell = undefined;
    },
  });
  return rows;
}

export function readRelationships(xml: string): Map<string, string> {
  const relationships = new Map<string, string>();
  parseXml(xml, {
    open(tag) {
      if (localName(tag) !== 'Relationship') return;
      const id = attribute(tag, 'Id');
      const target = attribute(tag, 'Target');
      if (!id || !target) throw new Error('Invalid OOXML relationship');
      relationships.set(id, target);
    },
  });
  return relationships;
}

export function readWorkbookMap(workbookXml: string, relationshipXml: string): Map<string, string> {
  const relationships = readRelationships(relationshipXml);
  const sheets = new Map<string, string>();
  parseXml(workbookXml, {
    open(tag) {
      if (localName(tag) !== 'sheet') return;
      const name = attribute(tag, 'name');
      const relationId = attribute(tag, 'r:id') || attribute(tag, 'id');
      const target = relationships.get(relationId);
      if (!name || !target) throw new Error(`Worksheet relationship is missing: ${name || relationId}`);
      const normalized = path.posix.normalize(path.posix.join('xl', target.replace(/\\/g, '/')));
      if (!normalized.startsWith('xl/') || normalized.includes('/../')) throw new Error(`Unsafe worksheet relationship: ${target}`);
      sheets.set(name, normalized);
    },
  });
  return sheets;
}

function parseXml(xml: string, handlers: { open?(tag: SaxesTag): void; text?(value: string): void; close?(name: string): void }): void {
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag) => handlers.open?.(tag));
  parser.on('text', (value) => handlers.text?.(value));
  parser.on('closetag', (tag) => handlers.close?.(localName(tag)));
  try { parser.write(xml).close(); }
  catch (error) { throw new Error(`Invalid XML: ${error instanceof Error ? error.message : 'parse failure'}`); }
}

function localName(tag: SaxesTag | string): string {
  const name = typeof tag === 'string' ? tag : tag.name;
  return name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
}

function attribute(tag: SaxesTag, name: string): string {
  const value = tag.attributes[name];
  return typeof value === 'string' ? value : value?.value ?? '';
}

function integerAttribute(tag: SaxesTag, name: string): number {
  const value = Number(attribute(tag, name));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid XML integer attribute: ${name}`);
  return value;
}

