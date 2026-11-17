export type ContactFields={name:string;phone:string;address:string};

const labels={
 '收件人姓名':'name','收货人姓名':'name','联系人姓名':'name','联系人':'name','收货人':'name','收件人':'name','姓名':'name',
 '收件人电话':'phone','收货人电话':'phone','联系人电话':'phone','联系号码':'phone','手机号码':'phone','联系电话':'phone','手机号':'phone','手机':'phone','电话':'phone',
 '详细收货地址':'address','收货地址':'address','收件地址':'address','详细地址':'address','地址':'address',
 '邮政编码':'ignore','邮编':'ignore','备注':'ignore',
} as const;
const labelPattern=new RegExp('('+Object.keys(labels).join('|')+')[ \\t]*[:：][ \\t]*','g');
const phonePattern=/(?<!\d)(?:(?:\+?86[ -]?)?1[3-9]\d(?:[ -]?\d){8}|0\d{2,3}[ -]?\d{7,8}(?:[-转]\d{1,6})?)(?!\d)/g;
const addressMarker=/[省市区县镇乡路巷弄]|街道|大道|\d[号栋幢楼室]/;
const cjkName=/^[\p{Script=Han}·]{2,8}$/u;
const latinName=/^\p{Script=Latin}[\p{Script=Latin}\p{M} .'’-]{0,39}$/u;
const looksLikeChineseName=(value:string)=>cjkName.test(value)&&!addressMarker.test(value)&&!/公司|收货|物流|快递|电话|地址/.test(value);
const clean=(s:string)=>s.replace(/[\s\p{Cc}\p{Cf}]+/gu,' ').replace(/^[，,；;、 ]+|[，,；;、 ]+$/g,'');
const phoneKey=(s:string)=>s.replace(/[ -]/g,'').replace(/^\+?86(?=1[3-9]\d{9}$)/,'');

export function recognizeContactText(text:string):ContactFields&{ambiguous:(keyof ContactFields)[]}{
 const found={name:[] as string[],phone:[] as string[],address:[] as string[]};
 const entries=[...text.matchAll(labelPattern)];
 if(entries.length){
  entries.forEach((entry,index)=>{
   const field=labels[entry[1] as keyof typeof labels];
   const value=text.slice(entry.index+entry[0].length,entries[index+1]?.index);
   if(field==='phone')found.phone.push(...(value.match(phonePattern)??[]));
   else if(field!=='ignore')found[field].push(clean(value));
  });
 }else{
  found.phone=text.match(phonePattern)??[];
  const fields=text.split(/[\r\n\t，,；;、]+/).map(clean);
  const [first,middle,last]=fields;
  if(fields.length===3&&found.phone.length===1&&middle===clean(found.phone[0])&&last&&
    (looksLikeChineseName(first)||latinName.test(first))){
   found.name=[first];
   found.address=[last];
  }else{
   const fragments=text.replace(phonePattern,'\n').split(/[\r\n，,；;、]+/).map(clean).filter(Boolean);
   found.name=fragments.filter(looksLikeChineseName);
   found.address=fragments.filter(part=>part.length>=6&&addressMarker.test(part));
  }
 }
 const ambiguous:(keyof ContactFields)[]=[];
 const choose=(field:keyof ContactFields)=>{
  const unique=new Map<string,string>();
  for(const value of found[field]){
   if(!value)continue;
   const key=field==='phone'?phoneKey(value):value;
   if(!unique.has(key))unique.set(key,value);
  }
  if(unique.size>1){ambiguous.push(field);return '';}
  const value=unique.values().next().value??'';
  return value.length<=100?value:'';
 };
 return {name:choose('name'),phone:choose('phone'),address:choose('address'),ambiguous};
}
