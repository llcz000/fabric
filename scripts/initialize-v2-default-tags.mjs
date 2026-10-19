import {initializeDefaultTags} from './lib/v2-default-tags.mjs';
// Explicit authenticated maintenance: never invoked during server startup.
const origin=process.env.FABRIC_V2_SEED_URL,token=process.env.FABRIC_V2_SEED_TOKEN;
if(!origin||!token)throw Error('Set FABRIC_V2_SEED_URL and FABRIC_V2_SEED_TOKEN for the explicitly authorized target');
const url=new URL(origin);if(url.username||url.password||url.pathname!=='/'||!['http:','https:'].includes(url.protocol))throw Error('Invalid target origin');
const health=await fetch(new URL('/api/health',url));const status=await health.json();
if(!health.ok||status.storage!=='mysql'||status.mode!=='v2')throw Error('Target is not a healthy V2 MySQL service');
console.log(JSON.stringify(await initializeDefaultTags((path,init)=>fetch(new URL(path,url),{...init,headers:{...init?.headers,Authorization:'Bearer '+token}}))));
