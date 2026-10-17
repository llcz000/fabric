/** P6-1 calculation contracts for the three EXISTING document templates.
 * sample / deposit / bulk are persisted template_type values; frontend sales
 * is an alias of bulk only at this explicit boundary. Values rounded in cents.
 */
export type PersistedDocumentType='sample'|'deposit'|'bulk';
export type DocumentTypeInput=PersistedDocumentType|'sales';
interface LineInput {
 meters:number;
 unitPrice:number;
 deductionMeters?:number;
 pieceMeters?:number[]|null;
}
export interface CalculatedLine{
 amount:number;rolls:number;netMeters:number;deductionMeters:number;pieceMeters:number[]|null;
}
export interface DocumentTotals{
 totalMeters:number;totalPieces:number;totalAmount:number;totalDeductionMeters:number;
 depositAmount:number;receivableAmount:number;
}
interface StoredLine extends LineInput{amount:number}
export class DocumentCalculationError extends Error{
 readonly status=400;
 constructor(message:string){super(message);}
}
function kind(value:DocumentTypeInput):PersistedDocumentType{
 if(value==='sales')return 'bulk';
 if(value==='bulk'||value==='sample'||value==='deposit')return value;
 throw new DocumentCalculationError('Unknown document type');
}
function cents(num:unknown,name:string,max=999999999.99):number{
 if(typeof num!=='number'||!Number.isFinite(num)||num<0||num>max||
    Math.abs(num*100-Math.round(num*100))>1e-5)
  throw new DocumentCalculationError('Invalid '+name+' (0–2 decimal places required)');
 return Math.round(num*100);
}
function addSafe(a:number,b:number):number{
 if(!Number.isSafeInteger(a+b)||a+b>99999999999)
  throw new DocumentCalculationError('Document total exceeds supported precision');
 return a+b;
}
function roundAmountCents(grossMetersCents:number,priceCents:number):number{
 const n=(BigInt(grossMetersCents)*BigInt(priceCents)+50n)/100n;
 if(n>99999999999n)throw new DocumentCalculationError('Line amount overflow');
 return Number(n);
}
/** Interpret only JSON arrays or number arrays; never eval/freeform token parsing in server. */
export function normalizePieceMeters(raw:unknown):number[]|null{
 if(raw==null)return null;
 let items:unknown=raw;
 if(typeof raw==='string'){
  try{items=JSON.parse(raw);}catch{throw new DocumentCalculationError('Invalid piece_meters JSON');}
 }
 if(!Array.isArray(items))throw new DocumentCalculationError('Invalid piece_meters array');
 return items.map((value,i)=>cents(value,'piece_meters['+i+']')/100);
}
export function calculateLineAmounts(type:DocumentTypeInput,input:LineInput):CalculatedLine{
 const t=kind(type),m=cents(input.meters,'meters'),p=cents(input.unitPrice,'unit_price');
 const deduction=input.deductionMeters===undefined?0:cents(input.deductionMeters,'deduction_meters');
 const pieces=normalizePieceMeters(input.pieceMeters);
 if(t!=='bulk'&&(deduction!==0 || pieces!==null))
  throw new DocumentCalculationError('Non-sales document cannot set rolls or deductions');
 let rollCount=0;
 if(t==='bulk'&&pieces){
  let pieceGross=0;
  for(const piece of pieces){
   const pc=cents(piece,'piece_meters');
   if(pc===0)throw new DocumentCalculationError('Piece meters must be positive');
   pieceGross=addSafe(pieceGross,pc);
  }
  if(pieces.length>0 && pieceGross!==m)
   throw new DocumentCalculationError('Roll meters must equal gross line meters');
  rollCount=pieces.length;
 }
 const net=Math.max(0,m-(t==='bulk'?deduction:0));
 return {
  amount:roundAmountCents(net,p)/100,
  rolls:t==='bulk'?rollCount:t==='sample'?1:0,
  netMeters:net/100,
  deductionMeters:t==='bulk'?deduction/100:0,
  pieceMeters:t==='bulk'?pieces:null
 };
}
export function calculateDocumentTotals(type:DocumentTypeInput,lines:StoredLine[],deposit:number):DocumentTotals{
 const t=kind(type);
 if(!Array.isArray(lines)||lines.length>200)throw new DocumentCalculationError('Invalid document items');
 let meters=0,deduction=0,total=0,rolls=0;
 for(const line of lines){
  const calc=calculateLineAmounts(t,line);
  const stored=cents(line.amount,'amount');
  if(stored!==Math.round(calc.amount*100))
   throw new DocumentCalculationError('Stored line amount is not the calculated amount');
  meters=addSafe(meters,cents(line.meters,'meters'));
  deduction=addSafe(deduction,cents(calc.deductionMeters,'deduction_meters'));
  total=addSafe(total,stored);
  rolls+=calc.rolls;
 }
 return {
  totalMeters:meters/100,totalPieces:rolls,totalAmount:total/100,
  totalDeductionMeters:deduction/100,
  ...calculateDocumentPayment(t,total/100,deposit)
 };
}

/** Receipt values derive from the saved gross. Round deposit money first, then subtract.
 * Sample legacy prepayment remains in raw history, but is not a field in this document type.
 */
export function calculateDocumentPayment(type:DocumentTypeInput,totalAmount:number,deposit:number):Pick<DocumentTotals,'depositAmount'|'receivableAmount'>{
 const t=kind(type),total=cents(totalAmount,'total_amount');
 const input=t==='sample'?0:cents(deposit,'deposit',t==='deposit'?100:999999999.99);
 const paid=t==='deposit'?Number((BigInt(total)*BigInt(input)+5000n)/10000n):input;
 if(!Number.isSafeInteger(paid))throw new DocumentCalculationError('Invalid deposit amount');
 return {depositAmount:paid/100,receivableAmount:(total-paid)/100};
}
