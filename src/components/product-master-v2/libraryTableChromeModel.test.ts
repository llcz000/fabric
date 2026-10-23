import assert from 'node:assert/strict';
import test from 'node:test';
import {buildColumnVisibility,nextSortState,readColumnVisibility,sortRows,toggleColumnVisibility,
 visibleColumns,writeColumnVisibility,type LibraryColumn} from './libraryTableChromeModel';

interface Row{id:string;name:string;count:number|null;note:string}

const columns:LibraryColumn<Row>[]=[
 {key:'id',label:'编号',sortable:true,value:row=>row.id,locked:true},
 {key:'name',label:'名称',sortable:true,value:row=>row.name},
 {key:'count',label:'数量',sortable:true,value:row=>row.count},
 {key:'note',label:'备注'},
 {key:'actions',label:'操作',locked:true},
];

const rows:Row[]=[
 {id:'3',name:'beta',count:20,note:'x'},
 {id:'1',name:'alpha',count:null,note:'y'},
 {id:'2',name:'gamma',count:5,note:'z'},
];

test('P1-8 default visibility hides nothing and keeps locked columns',()=>{
 const map=buildColumnVisibility(columns);
 assert.equal(map.id,true);assert.equal(map.actions,true);assert.equal(map.note,true);
});

test('P1-8 locked columns can never be hidden',()=>{
 const map=toggleColumnVisibility(columns,buildColumnVisibility(columns),'id');
 assert.equal(map.id,true);
 const map2=toggleColumnVisibility(columns,buildColumnVisibility(columns),'actions');
 assert.equal(map2.actions,true);
});

test('P1-8 toggling a column flips its visibility',()=>{
 const base=buildColumnVisibility(columns);
 const hidden=toggleColumnVisibility(columns,base,'name');
 assert.equal(hidden.name,false);
 const shown=toggleColumnVisibility(columns,hidden,'name');
 assert.equal(shown.name,true);
});

test('P1-8 visible columns keep definition order',()=>{
 const map={...buildColumnVisibility(columns),name:false};
 assert.deepEqual(visibleColumns(columns,map).map(c=>c.key),['id','count','note','actions']);
});

test('P1-8 header click cycles unsorted → asc → desc → unsorted',()=>{
 const first=nextSortState(null,'name');
 assert.deepEqual(first,{key:'name',direction:'asc'});
 const second=nextSortState(first,'name');
 assert.deepEqual(second,{key:'name',direction:'desc'});
 assert.equal(nextSortState(second,'name'),null);
 // 换列时从升序重新开始
 assert.deepEqual(nextSortState(second,'count'),{key:'count',direction:'asc'});
});

test('P1-8 sorting compares numbers numerically and strings by locale',()=>{
 const byCount=sortRows(rows,{key:'count',direction:'asc'},columns);
 assert.deepEqual(byCount.map(r=>r.id),['2','3','1']);
 const byName=sortRows(rows,{key:'name',direction:'asc'},columns);
 assert.deepEqual(byName.map(r=>r.name),['alpha','beta','gamma']);
 const desc=sortRows(rows,{key:'name',direction:'desc'},columns);
 assert.deepEqual(desc.map(r=>r.name),['gamma','beta','alpha']);
});

test('P1-8 rows without a comparable value sink to the bottom',()=>{
 const sorted=sortRows(rows,{key:'count',direction:'asc'},columns);
 assert.equal(sorted[sorted.length-1].id,'1');
 const desc=sortRows(rows,{key:'count',direction:'desc'},columns);
 assert.equal(desc[desc.length-1].id,'1');
});

test('P1-8 non-sortable columns are ignored by sorting',()=>{
 assert.deepEqual(sortRows(rows,{key:'note',direction:'asc'},columns),rows);
});

test('P1-8 persisted column visibility survives a reload and ignores junk',()=>{
 const key='fabric.v2.library.columns.test';
 const store=new Map<string,string>();
 const fakeWindow={localStorage:{
  getItem:(k:string)=>store.get(k)??null,
  setItem:(k:string,v:string)=>{store.set(k,v);},
  removeItem:(k:string)=>{store.delete(k);},
  clear:()=>{store.clear();},
  key:()=>null,length:0
 }};
 (globalThis as unknown as {window:unknown}).window=fakeWindow;
 try{
  writeColumnVisibility(key,{id:true,name:false,count:true,note:true,actions:true});
  const restored=readColumnVisibility(columns,key);
  assert.equal(restored.name,false);
  // 未知 key 被忽略，缺失 key 回落到默认值
  writeColumnVisibility(key,{unknown:false} as never);
  const fallback=readColumnVisibility(columns,key);
  assert.equal(fallback.name,true);
 }finally{delete (globalThis as unknown as {window?:unknown}).window;}
});
