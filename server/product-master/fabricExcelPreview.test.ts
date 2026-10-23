import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {previewFabricXlsx,FabricExcelError} from './fabricExcelPreview';
async function book(headers:(string|null)[],data:(string|number|null)[][],sheet='面料资料',start=1){
 const workbook=new ExcelJS.Workbook(),ws=workbook.addWorksheet(sheet);
 ws.getRow(start).values=[, ...headers];
 for(let i=0;i<data.length;i++)ws.getRow(start+i+1).values=[,...data[i]];
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
const headers=['品号','品名','成分','克重','克重单位','门幅(cm)','备注'];
test('P5 .xlsx real workbook, seven columns, leading zeros and both units',async()=>{
 const bytes=await book(headers,[
  ['0012','纯丝雪纺','100%真丝',16.5,'姆米',140,'垂感'],
  ['F018','弹力薄纱','涤纶',78.125,'g/m²',150,''],
  ['F019','空规格',null,null,null,null,null]
 ]);
 const result=await previewFabricXlsx(bytes,{filename:'fabrics.xlsx'});
 assert.equal(result.sheetName,'面料资料');assert.equal(result.headerRow,1);
 assert.equal(result.rows[0].fabric?.fabricNo,'0012');
 assert.equal(result.rows[0].fabric?.weightUnit,'mm');
 assert.equal(result.rows[1].fabric?.weightUnit,'gsm');
 assert.deepEqual([result.rows[0].rowNumber,result.rows[1].rowNumber,result.rows[2].rowNumber],[2,3,4]);
 assert.equal(result.rows[2].fabric?.weightValue,null);
 assert.equal(result.rows[2].fabric?.widthValue,null);
 assert.deepEqual(result.counts,{create:3,skip:0,error:0});
});
test('P5 normalized duplicate group skips ALL rows and other valid rows remain importable',async()=>{
 const bytes=await book(headers,[[' f018 ','A',null,null,null,null,null],
  ['F018','B',null,null,null,null,null],['F019','C',null,null,null,null,null]]);
 const p=await previewFabricXlsx(bytes,{filename:'dupes.xlsx'});
 assert.deepEqual(p.rows.map(x=>x.action),['skip','skip','create']);
 assert(p.rows[0].reason.includes('2')&&p.rows[0].reason.includes('3'));
 assert.equal(p.rows[1].fabric?.fabricNo,'F018');
});
test('P5 existing DB conflicts skipped with precise comparison (no silent overwrite)',async()=>{
 const existing={id:'8',fabricNo:'F018',fabricName:'旧品名',composition:'纯棉',
  weightValue:90,weightUnit:'gsm' as const,widthValue:144,remark:'旧备注',isActive:true};
 const bytes=await book(headers,[['F018','新品名','','','','',''],['F019','可新建',null,null,null,null,null]]);
 const p=await previewFabricXlsx(bytes,{filename:'f.xlsx',existing:[existing]});
 assert.equal(p.rows[0].action,'skip');assert.equal(p.rows[0].existing?.fabricName,'旧品名');
 assert.deepEqual(p.rows[0].changes,{fabricName:{from:'旧品名',to:'新品名'}});
 assert.equal(p.rows[1].action,'create');
 assert.equal(p.counts.skip,1);
});
test('P5 missing units require explicit chosen default, but conflicting or unknown units still fail',async()=>{
 const bytes=await book(headers,[
  ['F01','A','棉',95,null,150,null],
  ['F02','B','棉','18 mm','gsm',155,null],
  ['F03','C','棉','90 kg',null,null,null],
  ['F04','D','棉','88 克/平方米',null,140,null]
 ]);
 const a=await previewFabricXlsx(bytes,{filename:'u.xlsx'});
 assert.deepEqual(a.rows.map(x=>x.action),['error','error','error','create']);
 const b=await previewFabricXlsx(bytes,{filename:'u.xlsx',defaultWeightUnit:'gsm'});
 assert.deepEqual(b.rows.map(x=>x.action),['create','error','error','create']);
 assert.equal(b.rows[0].fabric?.weightUnit,'gsm');
});
test('P5 non-cm width, excessive precision and blank numbers are rejected',async()=>{
 const bytes=await book(headers,[['A01','布',null,12.1234,'mm',140,null],
  ['B01','布',null,14,'mm','55 inch',null],
  [' ','空编号',null,null,null,null,null],
  ['C01','正确',null,12.5,'mm','145cm',null]]);
 const sheet=await previewFabricXlsx(bytes,{filename:'broken.xlsx'});
 assert.deepEqual(sheet.rows.map(x=>x.action),['error','error','error','create']);
 assert(sheet.rows[2].reason.includes('空'));
});
test('P5 legacy header aliases & selected worksheet/header row, manual mapping',async()=>{
 const bytes=await book(['面料品号','面料品名','成份','克重数值','单位','门幅','说明'],
  [['S004','香云纱','真丝',19,'mm',138,'测试']], '老文件',3);
 const result=await previewFabricXlsx(bytes,{filename:'legacy.xlsx',sheetName:'老文件',headerRow:3});
 assert.equal(result.rows[0].rowNumber,4);assert.equal(result.rows[0].fabric?.fabricNo,'S004');
 assert.equal(result.rows[0].fabric?.remark,'测试');
 const manual=await book(['编号自填','名称自填','其他'],
  [['AB1','条纹','忽略']],'Sheet1');
 await assert.rejects(previewFabricXlsx(manual,{filename:'map.xlsx'}),FabricExcelError);
 const parsed=await previewFabricXlsx(manual,{filename:'map.xlsx',
  mapping:{fabricNo:1,fabricName:2}});
 assert.equal(parsed.rows[0].action,'create');
});
test('P5 ambiguous headers, same source column and unsupported files fail closed',async()=>{
 const dup=await book(['品号','面料品号','品名'],[['A01','A02','布']]);
 await assert.rejects(previewFabricXlsx(dup,{filename:'dup.xlsx'}),/映射|重复|确认/);
 await assert.rejects(previewFabricXlsx(dup,{filename:'dup.xlsx',mapping:{fabricNo:1,fabricName:1}}),FabricExcelError);
 await assert.rejects(previewFabricXlsx(dup,{filename:'dup.xls'}),/xlsx/);
 await assert.rejects(previewFabricXlsx(Buffer.from('not excel'),{filename:'bad.xlsx'}),FabricExcelError);
});
test('P5 skips empty sheet rows but isolates missing required names and blank numbers',async()=>{
 const bytes=await book(headers,[['A1','',null,null,null,null,null],
  [null,null,null,null,null,null,null],['A2','正常',null,null,null,null,null],
  ['  ','空品号',null,null,null,null,null]]);
 const result=await previewFabricXlsx(bytes,{filename:'errors.xlsx'});
 assert.equal(result.rows.length,3);
 assert.deepEqual(result.rows.map(x=>x.action),['error','create','error']);
 assert.equal(result.counts.error,2);
});

test('actual supplier headers and numeric/free-form fabric numbers need no column configuration',async()=>{
 const input=await book(['品号','品名','成分','克重','gsm/mm','门幅（里面CM）'],[
  [12101,'真丝双绉','100%桑蚕丝',12,'mm',137],
  ['10151-8','真丝欧根纱','100%桑蚕丝',8,'mm',137],
  ['底布 / A_01','粘麻','55%人棉45%亚麻',165,'gsm',138],
  ['  ','空品号',null,null,null,null]
 ]);
 const p=await previewFabricXlsx(input,{filename:'底布编号 -OK.xlsx'});
 assert.deepEqual(p.counts,{create:3,skip:0,error:1});
 assert.deepEqual(p.rows.slice(0,3).map(r=>[r.fabric?.fabricNo,r.fabric?.weightUnit,r.fabric?.widthValue]),
  [['12101','mm',137],['10151-8','mm',137],['底布 / A_01','gsm',138]]);
 assert.match(p.rows[3].reason,/品号.*空/);
});
test('numeric codes and text codes share duplicate/existing lookup, visible zero padding is preserved',async()=>{
 const w=new ExcelJS.Workbook(),ws=w.addWorksheet('面料资料');
 ws.addRow(headers);ws.addRow([12,'A']);ws.addRow(['12','B']);ws.addRow([7,'C']);ws.getCell('A4').numFmt='0000';
 const p=await previewFabricXlsx(Buffer.from(await w.xlsx.writeBuffer()),{filename:'numbers.xlsx'});
 assert.deepEqual(p.rows.map(r=>r.action),['skip','skip','create']);
 assert.equal(p.rows[2].fabric?.fabricNo,'0007');
});
