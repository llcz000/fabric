/** Focused local browser evidence for the Fabric list's composition/weight geometry. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{chromium}=require('playwright');
async function run(){
 const out=path.join(root,'artifacts','release-tool-validation','fabric-table-review.cjs');
 fs.mkdirSync(path.dirname(out),{recursive:true});
 await build({entryPoints:[path.join(root,'src/components/product-master-v2/FabricLibraryV2.tsx')],
  outfile:out,bundle:true,platform:'node',format:'cjs',packages:'external',target:'node20'});
 const {FabricV2Table}=createRequire(out)(out);
 const row={id:'1',fabricNo:'10151-8',fabricName:'面料',composition:'95%聚酯纤维/5%氨纶，轻薄垂坠'.repeat(10),
  weightValue:125.5,weightUnit:'gsm',widthValue:145,remark:'备注'.repeat(35),isActive:true,productCount:2};
 const markup=renderToStaticMarkup(React.createElement(FabricV2Table,{
  page:{items:[row],total:1,limit:50,offset:0},onPage(){},canManage:true
 }));
 let css='';
 for(const name of fs.readdirSync(path.join(root,'dist/assets')))if(name.endsWith('.css'))
  css+=fs.readFileSync(path.join(root,'dist/assets',name),'utf8');
 const html='<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>'+css+
  'body{margin:0}.review{padding:20px}.v2-library-table{table-layout:fixed}</style></head><body><div class="review">'+markup+'</div></body></html>';
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:700}});
   try{
    await page.setContent(html,{waitUntil:'load'});
    const result=await page.evaluate(()=>{
     const cells=[...document.querySelectorAll('.v2-library-row td')],composition=cells[2],weight=cells[3],remark=cells[5];
     const span=composition.querySelector('span'),c=composition.getBoundingClientRect(),w=weight.getBoundingClientRect();
     return {columns:cells.length,compositionWidth:Math.round(c.width),weightWidth:Math.round(w.width),
      remarkWidth:Math.round(remark.getBoundingClientRect().width),noOverlap:c.right<=w.left+2,
      clipped:span.scrollWidth>span.clientWidth,weightText:weight.textContent.trim(),
      bodyOverflow:document.documentElement.scrollWidth>innerWidth+3};
    });
    if(result.columns!==9||result.compositionWidth!==210||result.weightWidth!==110||
       result.remarkWidth!==112||!result.noOverlap||!result.clipped||
       result.weightText!=='125.5 gsm'||result.bodyOverflow)
     throw Error('Targeted Fabric table UI mismatch '+JSON.stringify({width,...result}));
    console.log(JSON.stringify({width,...result,result:'passed'}));
   }finally{await page.close();}
  }
 }finally{await browser.close();fs.rmSync(out,{force:true});}
}
run().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
