// Current P0 documentation routing and retained approval evidence; never connects to DB.
import fs from 'node:fs';
import path from 'node:path';

const base=process.cwd();
const index='docs/product-master/README.md';
const requirements='docs/product-master/product-master-v2-requirements.md';
const report='docs/product-master/product-master-v2-p0-technical-baseline.md';
const register='docs/product-master/product-master-v2-stitch-design-review.md';
const state='docs/project/项目现状.md';
const failures=[];
const read=name=>fs.readFileSync(path.join(base,name),'utf8');
const check=(name,fn)=>{
 try{fn();console.log('PASS',name);}
 catch(error){failures.push(name);console.error('FAIL',name,error.message);}
};
check('current requirements and historical baseline routing',()=>{
 const current=read(requirements);
 if(!current.includes('product-master-v2-stitch-design-review.md'))throw Error('Current requirements must link the UI approval register');
 if(!read(report).includes('历史参考'))throw Error('P0 snapshot must be explicitly historical');
 for(const target of ['项目需求总览.md','项目现状.md']){
  if(!read(index).includes(target))throw Error('Missing current authority: '+target);
 }
});
check('retained historical seven-page UI approval',()=>{
 const text=read(register);
 if(!text.includes('历史参考'))throw Error('Historical UI register must not override current requirements');
 const rows=text.split('\n').filter(line=>/^\| .*UI已确认/.test(line));
 if(rows.length!==7)throw Error('Expected seven historical approved screens');
 for(const id of ['8a6e9e4e58e5447f8fd5394e7a6de9f5','138aa243d7f548b18e92789d382482de','f2c1ab5adbba4c50bb876fc2f7d75b41','1ac8dc0f5f65419aaa80bc264a43abde','4e49bb73b9ad4ea6a3bca3b3031b4805','18bf13584579427fbbba015239957622','bab4de3e72cd44ffa4cdd4d5ff0e311c']){
  if(!text.includes(id))throw Error('Missing retained approval '+id);
 }
});
check('current format and acceptance boundaries',()=>{
 const current=read(requirements),status=read(state);
 if(!current.includes('仅支持 `.xlsx`')||!current.includes('不支持 `.xls`'))throw Error('Current fabric import is xlsx only');
 if(!status.includes('当前源码存在不代表')||!status.includes('真实多用户跨权限')||!status.includes('微信真机'))throw Error('Real-environment acceptance must remain separate');
 const gate=read('docs/product-master/product-master-v2-phase1-delivery-readiness.md');
 if(!gate.includes('releaseAuthorized')||!gate.includes('--status')||!gate.includes('SHA-256'))throw Error('Explicit authorization and evidence-integrity gates missing');
});
check('current navigation and historical evidence links',()=>{
 for(const name of [index,requirements,report,register,state]){
  for(const match of read(name).matchAll(/\]\(([^)]+)\)/g)){
   const target=match[1].split('#')[0];
   if(!target||/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target))continue;
   if(!fs.existsSync(path.resolve(base,path.dirname(name),decodeURI(target))))throw Error('Broken link: '+name+' -> '+target);
  }
 }
});
if(failures.length){console.error('P0 static gate:',failures.length,'failure(s)');process.exitCode=1;}
else console.log('P0 static documentation gate: PASS (NOT real DB or API verification)');
