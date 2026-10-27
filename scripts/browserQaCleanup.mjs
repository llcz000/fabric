import fs from 'node:fs';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';

/** Only the profile created by the calling QA script, after its browser has exited. */
export async function cleanupQaBrowser({root,profile,browser=undefined}){
 if(profile){
  const target=path.resolve(profile),parent=path.resolve(root,'tmp');
  if(path.dirname(target)!==parent||!/^(?:card-selection|document-types|query-ui)-edge-[^/\\]+$/.test(path.basename(target))||fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('Unsafe QA profile');
  if(fs.existsSync(parent)&&fs.realpathSync(parent)!==path.join(fs.realpathSync(root),'tmp'))throw Error('Unsafe QA profile parent');
 }
 if(browser?.pid&&browser.exitCode===null&&browser.signalCode===null){
  const closed=once(browser,'close');browser.kill();await closed;
 }
 if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
