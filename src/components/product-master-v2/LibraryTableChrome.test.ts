import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ColumnSettingsMenu,SortableHeader} from './LibraryTableChrome';
import {buildColumnVisibility,type LibraryColumn} from './libraryTableChromeModel';

interface Row{id:string;name:string}
const columns:LibraryColumn<Row>[]=[
 {key:'id',label:'编号',sortable:true,value:r=>r.id},
 {key:'name',label:'名称'},
 {key:'actions',label:'操作',locked:true},
];

test('P1-8 sortable header renders a button and reports the active direction',()=>{
 const html=renderToStaticMarkup(React.createElement(SortableHeader,{
  column:columns[0],sort:{key:'id',direction:'desc'},onSort:()=>{}}));
 assert(html.includes('v2-sort-header'));
 assert(html.includes('aria-sort="descending"'));
 assert(html.includes('编号'));
});
test('P1-8 non-sortable header stays a plain th',()=>{
 const html=renderToStaticMarkup(React.createElement(SortableHeader,{
  column:columns[1],sort:null,onSort:()=>{}}));
 assert(!html.includes('v2-sort-header'));
 assert(html.includes('名称'));
});
test('P1-8 column settings menu exposes a trigger; the panel is gated behind the open state',()=>{
 const html=renderToStaticMarkup(React.createElement(ColumnSettingsMenu,{
  columns,visibility:buildColumnVisibility(columns),onToggle:()=>{},onReset:()=>{}}));
 assert(html.includes('列设置'));
 assert(!html.includes('aria-controls='),'hidden settings panel must not leave a dangling control reference');
 assert(!html.includes('aria-haspopup="true"'),'column controls use disclosure semantics, not a menu role');
 assert(html.includes('aria-expanded="false"'));
 // 面板默认收起，锁定列（操作）不出现在菜单项里
 assert(!html.includes('v2-column-menu-item'));
});
