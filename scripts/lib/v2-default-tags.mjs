/** Approved requirements v1.50 sections 2.2 / 2.3. Explicit maintenance only. */
export const DEFAULT_TAGS=Object.freeze({
 topic:Object.freeze(['花卉','植物','条纹','格纹','几何','动物','佩斯利','波点','字母图文','肌理','其他']),
 color:Object.freeze(['红色','橙色','黄色','绿色','蓝色','藏蓝','紫色','粉色','棕色','黑色','白色','灰色','米色','米白','多色'])
});
const normalized=name=>name.normalize('NFKC').trim().toLowerCase();
export async function initializeDefaultTags(apiFetch){
 let created=0;
 for(const [dimension,names] of Object.entries(DEFAULT_TAGS)){
  const read=async()=>{
   const response=await apiFetch('/api/v2/tags?dimension='+dimension+'&includeArchived=true');
   if(!response.ok)throw Error('Default tag read failed: '+response.status);
   const body=await response.json();if(!Array.isArray(body.items)||body.items.some(x=>typeof x.name!=='string'))throw Error('Invalid tag catalog');return new Set(body.items.map(x=>normalized(x.name)));
  };
  const known=await read();
  for(const name of names){
   if(known.has(normalized(name)))continue;
   const response=await apiFetch('/api/v2/tags',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dimension,name})});
   if(!response.ok){if(response.status!==409||!(await read()).has(normalized(name)))throw Error('Default tag initialization failed: '+response.status);}
   else created++;
   known.add(normalized(name));
  }
 }
 return {created};
}
