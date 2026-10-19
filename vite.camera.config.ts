import path from 'node:path';import {defineConfig} from 'vite';
export default defineConfig({root:path.resolve(__dirname,'src/camera'),base:'/v2-camera/',build:{outDir:path.resolve(__dirname,'dist-camera'),emptyOutDir:true}});
