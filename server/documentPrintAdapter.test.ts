import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBackendDocumentPrintModel } from './documentPrintAdapter';

test('backend bulk adapter produces sales content and uses receiver phone instead of company phone', () => {
  const model = buildBackendDocumentPrintModel(
    { template_type: 'bulk', order_no: 'XS-1', order_date: '2026-09-08', receiving_unit: '客户', total_meters: 3, total_pieces: 1, total_amount: 180, deposit: 20, deduction_meters: 0, sign_person: '', receiver: '', receiver_phone: '' },
    [{ product_no: 'G1', color_no: '红', product_name: '布', meters: 3, unit_price: 60, amount: 180, piece_meters: '[1,2]' }],
    { company_name: '公司', address: '地址', phone: '公司电话', default_terms: '默认', deposit_terms: '定金' },
  );
  assert.equal(model.type, 'sales');
  assert.equal(model.title, '销售发货码单');
  assert.equal(model.signature.phone, '');
  assert.deepEqual(model.rows[0].slice(3, 5), ['1.0', '2.0']);
});
