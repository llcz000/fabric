import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import { createInvoicePdfBytes } from './invoicePdf';

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('creates one landscape PDF page with an exact 240mm by 140mm media box', async () => {
  const bytes = await createInvoicePdfBytes(ONE_PIXEL_PNG);
  const pdf = await PDFDocument.load(bytes);

  assert.equal(pdf.getPageCount(), 1);
  const page = pdf.getPage(0);
  assert.ok(Math.abs(page.getWidth() - 680.3149606299213) < 0.01);
  assert.ok(Math.abs(page.getHeight() - 396.85039370078744) < 0.01);
  assert.equal(page.getRotation().angle, 0);
});
