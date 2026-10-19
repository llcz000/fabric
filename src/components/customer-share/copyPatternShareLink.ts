export async function copyPatternShareLink(
 url:string,
 clipboard:Pick<Clipboard,'writeText'>|undefined,
 selectFallback:()=>void,
):Promise<'copied'|'manual'>{
 try{
  if(typeof clipboard?.writeText!=='function')throw Error('Clipboard unavailable');
  await clipboard.writeText(url);
  return 'copied';
 }catch{
  selectFallback();
  return 'manual';
 }
}
