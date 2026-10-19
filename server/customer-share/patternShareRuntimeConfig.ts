import {isAbsolute} from 'node:path';
import {lstat,readFile} from 'node:fs/promises';
import {deriveStablePatternLinkToken,formatPatternShareUrl} from './patternLinkIssuer';
export interface PatternShareRuntimeConfig{publicOrigin:string;keyFile:string}
export function resolvePatternShareRuntimeConfig(env:NodeJS.ProcessEnv):PatternShareRuntimeConfig|null{
 const mode=env.FABRIC_V2_PATTERN_SHARING;if(mode===undefined||mode==='disabled')return null;
 if(mode!=='enabled'||!env.FABRIC_V2_PUBLIC_ORIGIN||!env.FABRIC_V2_PATTERN_SHARE_KEY_FILE||!isAbsolute(env.FABRIC_V2_PATTERN_SHARE_KEY_FILE))throw Error('B1 explicit origin and private key file required');
 formatPatternShareUrl(env.FABRIC_V2_PUBLIC_ORIGIN,deriveStablePatternLinkToken('1',Buffer.alloc(32,1)));
 return {publicOrigin:env.FABRIC_V2_PUBLIC_ORIGIN,keyFile:env.FABRIC_V2_PATTERN_SHARE_KEY_FILE};
}
export async function readPatternShareKey(config:PatternShareRuntimeConfig):Promise<Buffer>{
 const stat=await lstat(config.keyFile);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==32||process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error('B1 private key custody invalid');
 const bytes=await readFile(config.keyFile);deriveStablePatternLinkToken('1',bytes);return bytes;
}
