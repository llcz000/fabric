import assert from 'node:assert/strict';
import test from 'node:test';

import ExcelJS from 'exceljs';

import { buildDocumentWorkbook } from './documentExcel';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('builds a crisp fixed-scale sample workbook with safe side margins and all company images', async () => {
  const workbook = buildDocumentWorkbook({
    order: {
      order_no: 'YB-20260828-002', template_type: 'sample', order_date: '2026-08-28',
      receiving_unit: '深圳花花服饰有限公司', total_meters: 3, total_pieces: 1,
      total_amount: 180, receivable_amount: 180, sign_person: '', receiver: '',
    },
    items: [{
      product_no: 'G0531', color_no: '米黄底咖', product_name: '剪花人丝顺纤绉',
      composition: '98%人丝2%聚酯薄膜纤维', weight: '65.00', width: '128.00',
      meters: 3, unit_price: 60, amount: 180, remark: '雪晴 1328 8902 262',
    }],
    company: {
      company_name: '杭州歌朗纺织服饰有限公司', address: '杭州萧山区北干街道兴五路68号',
      phone: '18658899589', default_terms: '货物出门，如有质量问题，应在七天内书面通知。',
    },
    images: {
      brand_logo: { body: PNG, mime: 'image/png' },
      wechat_qr: { body: PNG, mime: 'image/png' },
      alipay_qr: { body: PNG, mime: 'image/png' },
    },
  });

  const bytes = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  const sheet = reopened.worksheets[0];

  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.fitToPage, false);
  assert.equal(sheet.pageSetup.scale, 100, 'printing must preserve the configured font sizes');
  assert.equal(sheet.pageSetup.paperSize, undefined, 'custom 240x140mm form must come from the AK-820 driver');
  assert.ok((sheet.pageSetup.margins?.left ?? 0) >= 0.39);
  assert.ok((sheet.pageSetup.margins?.right ?? 0) >= 0.39);
  assert.equal(sheet.headerFooter?.oddHeader ?? '', '');
  assert.equal(sheet.headerFooter?.oddFooter ?? '', '');
  assert.match(String(sheet.pageSetup.printArea), /^A1:J\d+$/);
  assert.ok(Array.from({ length: 10 }, (_, index) => sheet.getColumn(index + 1).width ?? 0).reduce((a, b) => a + b, 0) <= 105);
  assert.equal(sheet.getImages().length, 3);
  assert.match(String(sheet.getCell('C1').value), /杭州歌朗纺织服饰有限公司/);
  assert.equal(sheet.getCell('A6').value, '货号');
  assert.equal(sheet.getCell('A7').font.size, 9);
  assert.equal(sheet.getCell('J7').value, '雪晴 1328 8902 262');
});
