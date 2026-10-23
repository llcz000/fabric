import assert from 'node:assert/strict';
import test from 'node:test';
import {hashPassword,verifyPassword,hashSessionToken,createSessionToken} from './password';
test('P2 salted versioned scrypt hash and timing-safe wrong-password rejection',async()=>{
 const a=await hashPassword('secure-password-123'),b=await hashPassword('secure-password-123');
 assert.match(a,/^scrypt\$v1\$16384\$8\$1\$/);
 assert.notEqual(a,b);
 assert.equal(await verifyPassword('secure-password-123',a),true);
 assert.equal(await verifyPassword('bad-password',a),false);
 assert.equal(await verifyPassword('',a),false);
});
test('P2 rejects corrupt and legacy password hashes without throwing or guessing',async()=>{
 for(const invalid of ['', 'sha256$legacy','scrypt$v1$broken','scrypt$v1$999999999$8$1$aaaa$bbbb','scrypt$v1$16384$8$1$short$bad']) {
   assert.equal(await verifyPassword('secure-password-123',invalid),false);
 }
});
test('P2 password length and session token safety',async()=>{
 await assert.rejects(hashPassword('short'),/password|length/i);
 const token=createSessionToken();
 assert.match(token,/^[0-9a-f]{64}$/);
 const hashed=hashSessionToken(token);
 assert.match(hashed,/^[0-9a-f]{64}$/);
 assert.notEqual(hashed,token);
 assert.notEqual(hashSessionToken(createSessionToken()),hashed);
});
