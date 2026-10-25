import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const expectedEntries=[
  'tools/ui-preview/entries/ui-ux-internal-cards.html',
  'tools/ui-preview/entries/ui-ux-internal-chrome.html',
  'tools/ui-preview/entries/ui-ux-internal-fabrics.html',
  'tools/ui-preview/entries/ui-ux-internal-patterns.html',
  'tools/ui-preview/entries/ui-ux-pilot.html',
  'tools/ui-preview/entries/ui-ux-share-demo.html',
  'tools/ui-preview/entries/ui-ux-wechat-review.html',
  'tools/ui-preview/entries/ui-ux-wechat-route.html',
  'tools/ui-review/entries/business-ui-review.html',
  'tools/ui-review/entries/customer-ui-review.html',
  'tools/ui-review/entries/document-ui-review.html',
  'tools/ui-review/entries/product-master-v2-review.html',
  'tools/v2-sandbox/entries/product-master-v2-sandbox.html',
  'tools/v2-sandbox/entries/product-master-v2-workbench.html',
];
const errors=[];
const rootHtml=readdirSync(root,{withFileTypes:true})
  .filter(entry=>entry.isFile()&&/\.html?$/i.test(entry.name))
  .map(entry=>entry.name).sort();
if(!rootHtml.includes('index.html'))errors.push('Missing formal root entry: index.html');
const unexpectedRoot=rootHtml.filter(name=>name!=='index.html');
if(unexpectedRoot.length)errors.push('Only index.html may remain at repository root; move review/test HTML to tools/*/entries: '+unexpectedRoot.join(', '));
for(const entry of expectedEntries)if(!existsSync(path.join(root,entry)))errors.push('Missing registered non-production HTML entry: '+entry);

function htmlFiles(dir,base=''){
 if(!existsSync(dir))return [];
 return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const absolute=path.join(dir,entry.name),relative=path.posix.join(base,entry.name);
  if(entry.isDirectory())return htmlFiles(absolute,relative);
  return entry.isFile()&&/\.html?$/i.test(entry.name)?[relative]:[];
 });
}
const dist=path.join(root,'dist');
if(existsSync(dist)){
 const productionHtml=htmlFiles(dist).sort();
 if(!productionHtml.includes('index.html'))errors.push('Production dist exists but has no dist/index.html; rebuild before structure verification.');
 const extra=productionHtml.filter(file=>file!=='index.html');
 if(extra.length)errors.push('Production dist must not include review/sandbox HTML entries: '+extra.join(', '));
}
if(errors.length){
 console.error('FAIL project HTML structure');
 for(const error of errors)console.error(' - '+error);
 process.exitCode=1;
}else{
 console.log('PASS project HTML structure');
 console.log('Root HTML: index.html only');
 console.log('Registered isolated/review entries: '+expectedEntries.length);
 if(existsSync(path.join(root,'dist','index.html')))console.log('Production HTML: dist/index.html only');
}
