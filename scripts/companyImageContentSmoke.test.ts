import test from 'node:test';

import { verifyCompanyImageContentRoutes } from './companyImageContentSmoke';

test('real company image auth and content router serves three distinct valid 8x8 PNGs', async () => {
  await verifyCompanyImageContentRoutes();
});
