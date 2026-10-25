/** Explicitly opt-in V2 FRONTEND localhost sandbox only.
 * Not imported by normal npm run dev/build or deployed legacy server.
 * APIs proxy exclusively to the separately-authorized sandbox backend.
 */
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
const ACK='I_ACKNOWLEDGE_SANDBOX';
export default defineConfig(({command})=>{
 if(process.env.FABRIC_V2_SANDBOX_FRONTEND!==ACK||
   command==='serve'&&process.env.NODE_ENV==='production')
  throw Error('V2 sandbox frontend requires explicit local-only acknowledgement');
 return {
  root:path.resolve(process.cwd()),
  plugins:[react(),tailwindcss()],
  server:{
   host:'127.0.0.1',port:4455,strictPort:true,
   proxy:{'/api/v2':{target:'http://127.0.0.1:3456',changeOrigin:false}}
  },
  build:{
   outDir:'tmp/v2-sandbox-frontend-dist',emptyOutDir:true,
   rollupOptions:{input:{sandbox:path.resolve(process.cwd(),'tools/v2-sandbox/entries/product-master-v2-sandbox.html')}}
  }
 };
});
