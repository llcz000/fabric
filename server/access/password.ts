import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';

async function derive(password:string,salt:Buffer,length:number):Promise<Buffer>{
  return await new Promise<Buffer>((resolve,reject)=>{
    scryptCallback(password,salt,length,{N:16384,r:8,p:1,maxmem:32*1024*1024},(error,value)=>{
      if(error)reject(error);else resolve(value as Buffer);
    });
  });
}
const N=16384,r=8,p=1,keyLength=64;
/** Versioned salted scrypt; never store or log plaintext passwords. */
export async function hashPassword(password:string):Promise<string> {
  if (typeof password!=='string'||password.length<8||Buffer.byteLength(password,'utf8')>1024) {
    throw new Error('Password length must be 8–1024 bytes');
  }
  const salt=randomBytes(16);
  const derived=await derive(password,salt,keyLength);
  return ['scrypt','v1',N,r,p,salt.toString('hex'),derived.toString('hex')].join('$');
}
export async function verifyPassword(password:unknown,encoded:unknown):Promise<boolean> {
  if(typeof password!=='string'||!password||Buffer.byteLength(password,'utf8')>1024||typeof encoded!=='string') return false;
  const parts=encoded.split('$');
  if(parts.length!==7||parts[0]!=='scrypt'||parts[1]!=='v1'||parts[2]!==String(N)||parts[3]!==String(r)||parts[4]!==String(p))return false;
  if(!/^[0-9a-f]{32}$/i.test(parts[5])||!/^[0-9a-f]{128}$/i.test(parts[6]))return false;
  const expected=Buffer.from(parts[6],'hex');
  try {
    const derived=await derive(password,Buffer.from(parts[5],'hex'),expected.length);
    return timingSafeEqual(derived,expected);
  }catch{return false;}
}
export function createSessionToken():string {return randomBytes(32).toString('hex');}
export function hashSessionToken(token:string):string {return createHash('sha256').update(token).digest('hex');}
