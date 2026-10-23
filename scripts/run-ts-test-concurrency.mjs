/** Limit Node's per-test-file child processes on Windows to avoid spawn ENOMEM.
 * Override with FABRIC_TEST_CONCURRENCY=1..4; unrelated test args are unchanged.
 */
export function safeTestConcurrency(input=process.env.FABRIC_TEST_CONCURRENCY){
 if(input===undefined||input==='')return 2;
 if(typeof input!=='string'||!/^[1-4]$/.test(input))
  throw new Error('FABRIC_TEST_CONCURRENCY must be an integer from 1 to 4');
 return Number(input);
}
