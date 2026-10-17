/** Standalone local-only V2 writable 7-screen workbench. Not production Vite.
 * Backend has independent UUID pinned fabric_v2_test_* MySQL preflight.
 */
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
const ACK='I_ACKNOWLEDGE_V2_WRITE_SANDBOX';
export default defineConfig(({command})=>{
 if(process.env.FABRIC_V2_WRITE_FRONTEND!==ACK||
   (command==='serve'&&process.env.NODE_ENV==='production'))
  throw Error('V2 writable frontend requires explicit local-only approval');
 return {
  root:path.resolve(process.cwd()),
  plugins:[react(),tailwindcss()],
  server:{host:'127.0.0.1',port:4466,strictPort:true,
   proxy:{'/api/v2':{target:'http://127.0.0.1:3456',changeOrigin:false}}},
  build:{outDir:'tmp/v2-workbench-frontend-dist',emptyOutDir:true,
   rollupOptions:{input:{workbench:path.resolve(process.cwd(),'product-master-v2-workbench.html')}}}
 };
});
