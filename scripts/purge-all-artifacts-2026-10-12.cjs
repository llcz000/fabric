// User-approved full cleanup on 2026-10-12. Only D:\fabric\artifacts descendants.
const fs=require('node:fs'),path=require('node:path');
const target='D:\\fabric\\artifacts';
const externalFinals='D:\\歌朗\\主题-视频';
const audit='D:\\fabric\\docs\\maintenance\\artifacts-full-purge-2026-10-12.json';
const expected=path.win32.normalize(target);
function safe(p){const real=path.win32.normalize(p);if(real===expected||!real.toLowerCase().startsWith(expected.toLowerCase()+'\\'))throw Error('DELETE PATH NOT CHILD '+p);return real;}
function save(o){fs.writeFileSync(audit,JSON.stringify(o,null,2),'utf8');}
function walk(p,res){let entries;try{entries=fs.readdirSync(p,{withFileTypes:true});}catch(e){res.scanningErrors.push({path:p,error:String(e)});return;}
 for(const e of entries){const f=path.join(p,e.name);let st;try{st=fs.lstatSync(f)}catch(err){res.scanningErrors.push({path:f,error:String(err)});continue}
  if(st.isSymbolicLink()){res.symlinks.push(f);continue}
  if(st.isDirectory()){walk(f,res);continue}
  if(st.isFile()){res.files++;res.bytes+=st.size;continue}
  res.otherEntries++;
 }
}
(async()=>{
 const start=new Date().toISOString();
 if(process.platform!=='win32')throw Error('Refuse wrong platform');
 const st=fs.lstatSync(target);
 if(!st.isDirectory()||st.isSymbolicLink())throw Error('Root not safe');
 if(fs.existsSync(audit))throw Error('Refuse overwrite prior cleanup audit');
 if(!fs.existsSync(externalFinals)||fs.readdirSync(externalFinals).filter(n=>n.toLowerCase().endsWith('.mp4')).length<13)throw Error('External video backup folder missing/unexpectedly sparse');
 const names=fs.readdirSync(target),report={userApproved:true,scope:target,rootPreserved:true,externalVideoFolderNotModified:externalFinals,startedAt:start,initialChildren:names,stats:{},deletions:[],errors:[]};
 for(const name of names){
  const full=safe(path.join(target,name));
  const stat={files:0,bytes:0,symlinks:[],scanningErrors:[],otherEntries:0};
  const entry=fs.lstatSync(full);
  if(entry.isDirectory())walk(full,stat);
  else if(entry.isFile()){stat.files++;stat.bytes+=entry.size}
  else if(entry.isSymbolicLink())stat.symlinks.push(full);
  report.stats[name]=stat;
 }
 report.plannedTotalBytes=Object.values(report.stats).reduce((a,b)=>a+b.bytes,0);
 report.plannedFileCount=Object.values(report.stats).reduce((a,b)=>a+b.files,0);
 report.symlinkCount=Object.values(report.stats).reduce((a,b)=>a+b.symlinks.length,0);
 if(Object.values(report.stats).some(v=>v.scanningErrors.length))throw Error('Scan errors; aborting without deletion '+JSON.stringify(Object.values(report.stats).flatMap(v=>v.scanningErrors).slice(0,5)));
 report.scanCompletedAt=new Date().toISOString();save(report);
 console.log('ARTIFACTS_FULL_PURGE_INVENTORY '+JSON.stringify({topLevel:names.length,files:report.plannedFileCount,gib:+(report.plannedTotalBytes/1073741824).toFixed(2),nestedLinks:report.symlinkCount}));
 for(let i=0;i<names.length;i++){
  const name=names[i],full=safe(path.join(target,name)),startDel=Date.now();
  try{
   fs.rmSync(full,{force:false,recursive:true,maxRetries:5,retryDelay:400});
   const item={name,bytes:report.stats[name].bytes,files:report.stats[name].files,status:'REMOVED',seconds:+((Date.now()-startDel)/1000).toFixed(2)};
   report.deletions.push(item);
   report.removedBytes=report.deletions.filter(x=>x.status==='REMOVED').reduce((v,x)=>v+x.bytes,0);
   report.removedFiles=report.deletions.filter(x=>x.status==='REMOVED').reduce((v,x)=>v+x.files,0);
   console.log('REMOVED '+(i+1)+'/'+names.length+' '+name+' '+(item.bytes/1073741824).toFixed(2)+' GiB');
  }catch(err){const e={name,status:'FAILED',error:String(err)};report.deletions.push(e);report.errors.push(e);console.error('FAILED '+name+' '+err);}
  save(report);
 }
 report.remaining=fs.readdirSync(target);
 report.finalEmpty=report.remaining.length===0;
 report.finishedAt=new Date().toISOString();
 report.status=report.finalEmpty&&report.errors.length===0?'PASS':'PARTIAL';
 save(report);
 console.log('ARTIFACTS_PURGE_FINAL '+JSON.stringify({status:report.status,removedTopDirs:report.deletions.filter(x=>x.status==='REMOVED').length,files:report.removedFiles,giB:+(report.removedBytes/1073741824).toFixed(3),remaining:report.remaining,audit}));
 if(!report.finalEmpty)process.exitCode=2;
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
