/** Shared pure business rules. The server still owns authentication and authorization. */
export function isRegisteredBusinessRole(role:unknown):role is 'admin'|'sales'{
 return role==='admin'||role==='sales';
}

/** Validate a non-negative DECIMAL value without rounding or multiplying binary fractions. */
export function isDecimalValue(value:unknown,scale:number,integerDigits:number):value is number{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||
    !Number.isInteger(scale)||scale<0||!Number.isInteger(integerDigits)||integerDigits<1)return false;
 const match=/^(\d+)(?:\.(\d+))?$/.exec(String(value));
 return Boolean(match&&match[1].length<=integerDigits&&(match[2]?.length??0)<=scale);
}
