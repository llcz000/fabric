import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const current=path.join(projectRoot,'artifacts/product-master-ui/stitch/current');
function argument(name,fallback){const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1];}
const manifestPath=path.resolve(argument('--manifest',path.join(current,'review-delivery.json')));
const snapshotPath=path.resolve(argument('--snapshot',path.join(current,'canvas-snapshot.json')));
const faults=[];
function load(file){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){faults.push(`${file}: ${error.message}`);return {};}}
const manifest=load(manifestPath),snapshot=load(snapshotPath);
if(!manifest.projectId||manifest.projectId!==snapshot.projectId)faults.push('projectId does not match live-read snapshot');
if(snapshot.source!=='stitch.get_project')faults.push('snapshot must originate from Stitch get_project');
if(!snapshot.checkedAt||!manifest.visualCheck?.checkedAt)faults.push('read/visual verification date missing');
const expected=manifest.expectedPages??[],pages=manifest.pages??[],seen=new Set();
if(!expected.length)faults.push('expected page inventory is empty');
for(const key of expected){
  if(seen.has(key))faults.push(`duplicate expected page: ${key}`);seen.add(key);
  const matches=pages.filter(p=>p.key===key);
  if(matches.length!==1){faults.push(`${key}: missing or duplicate delivery entry`);continue;}
  const page=matches[0];
  if(!page.screenId){faults.push(`${key}: missing Stitch screenId; local prototype is not canvas delivery`);continue;}
  if(page.deliveryStatus!=='canvas_verified')faults.push(`${key}: canvas visibility not verified`);
  const live=(snapshot.screens??[]).filter(s=>s.id===page.screenId&&!s.hidden);
  if(live.length!==1)faults.push(`${key}: expected screen not visible in Stitch snapshot`);
  else if(live[0].title!==page.title)faults.push(`${key}: title differs from visible canvas screen`);
  for(const field of ['html','screenshot','reviewRecord']){
    if(!page[field]){faults.push(`${key}: ${field} is missing`);continue;}
    const target=path.resolve(path.dirname(manifestPath),page[field]);
    if(!fs.existsSync(target)||!fs.statSync(target).isFile()||fs.statSync(target).size===0)faults.push(`${key}: ${field} file missing/empty`);
  }
  if(page.requiredColumns?.length&&page.html){
    const htmlPath=path.resolve(path.dirname(manifestPath),page.html);
    if(fs.existsSync(htmlPath)){
      const html=fs.readFileSync(htmlPath,'utf8'),thead=html.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1]??'';
      const columns=[...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>m[1].replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim());
      let previous=-1;
      for(const label of page.requiredColumns){
        const index=columns.findIndex((text,index)=>index>previous&&text.includes(label));
        if(index<0)faults.push(`${key}: required column missing or reordered: ${label}`);
        else previous=index;
      }
      if(page.columnCount&&columns.length!==page.columnCount)faults.push(`${key}: expected ${page.columnCount} columns, found ${columns.length}`);
    }
  }
  if(!['approved','pending'].includes(page.reviewStatus))faults.push(`${key}: review status missing`);
}
const ids=pages.filter(p=>expected.includes(p.key)).map(p=>p.screenId).filter(Boolean);
if(new Set(ids).size!==ids.length)faults.push('different pages share one screenId');
if(!manifest.visualCheck?.screenshot)faults.push('canvas visual evidence missing');
else if(!fs.existsSync(path.resolve(path.dirname(manifestPath),manifest.visualCheck.screenshot)))faults.push('canvas evidence file missing');
const result={status:faults.length?'FAIL':'PASS',expectedPages:expected.length,verifiedPages:expected.filter(k=>!faults.some(x=>x.startsWith(k+':'))).length,errors:faults,scope:'Delivery inventory and supplied live-read snapshot; does not approve UI or independently refresh/visually inspect Stitch.'};
console.log(JSON.stringify(result,null,2));
process.exitCode=faults.length?1:0;
