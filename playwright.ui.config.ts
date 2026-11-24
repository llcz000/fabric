import {defineConfig, devices} from '@playwright/test';

const port=Number(process.env.FABRIC_UI_UX_PORT??52992);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local browser preview port');
const origin='http://127.0.0.1:'+port;
export default defineConfig({
 testDir:'./tests/ui',
 testMatch:'**/*.spec.ts',
 fullyParallel:false,
 workers:1,
 timeout:30_000,
 expect:{timeout:8_000},
 outputDir:'./artifacts/ui-ux-pilot/test-results',
 reporter:[['list']],
 use:{
  ...devices['Desktop Chrome'],
  browserName:'chromium',
  channel:'msedge',
  baseURL:origin,
  viewport:{width:1440,height:900},
  screenshot:'only-on-failure',
  trace:'retain-on-failure',
 },
 webServer:{
  command:'node scripts/serve-ui-ux-pilot.mjs',
  env:{FABRIC_UI_UX_MODE:'test'},
  url:origin+'/tools/ui-preview/entries/ui-ux-pilot.html',
  reuseExistingServer:false,
  timeout:120_000,
 },
});
