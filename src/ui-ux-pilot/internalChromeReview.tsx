import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../.agent-workspaces/v2-quality-20261020/src/index.css';
import {ColumnSettingsMenu,SortableHeader} from '../../.agent-workspaces/v2-quality-20261020/src/components/product-master-v2/LibraryTableChrome';
import {buildColumnVisibility,readColumnVisibility,writeColumnVisibility,visibleColumns,sortRows,nextSortState,type LibraryColumn,type SortState} from '../../.agent-workspaces/v2-quality-20261020/src/components/product-master-v2/libraryTableChromeModel';

type R={id:string;name:string;weight:number};
const DATA:R[]=[{id:'B2',name:'细棉',weight:90},{id:'A1',name:'雪纺',weight:75}];
const columns:LibraryColumn<R>[]=[
 {key:'id',label:'品号',sortable:true,value:r=>r.id,locked:true},
 {key:'name',label:'品名'},
 {key:'weight',label:'克重',sortable:true,value:r=>r.weight},
 {key:'actions',label:'操作',locked:true}
];
const storage='fabric.ui.qa.columns';
function App(){
 const [sort,setSort]=useState<SortState|null>(null);
 const [visibility,setVisibility]=useState(()=>readColumnVisibility(columns,storage));
 const shown=visibleColumns(columns,visibility);
 const rows=sortRows(DATA,sort,columns);
 const toggle=(key:string)=>setVisibility(cur=>{const next={...cur,[key]:!cur[key]};writeColumnVisibility(storage,next);return next;});
 const reset=()=>{const next=buildColumnVisibility(columns);writeColumnVisibility(storage,next);setVisibility(next);};
 return <main style={{padding:24,maxWidth:950,margin:'auto',fontFamily:'system-ui'}} aria-label="内部列表操作验收">
  <h1 style={{fontSize:22}}>列设置组件 · 独立交互验收</h1><p>这是实际管理组件的本机测试夹具，使用模拟行，不连接业务服务。</p>
  <button type="button" aria-label="页面其它操作" id="other-action">页面其它操作</button>
  <div style={{padding:'15px 0'}}>
   <ColumnSettingsMenu columns={columns} visibility={visibility} onToggle={toggle} onReset={reset}/>
  </div>
  <table style={{width:'100%',borderCollapse:'collapse'}}>
   <thead><tr>{shown.map(c=><SortableHeader key={c.key} column={c} sort={sort} onSort={key=>setSort(cur=>nextSortState(cur,key))}/>)}</tr></thead>
   <tbody>{rows.map(r=><tr key={r.id}>{shown.map(c=><td key={c.key} data-column={c.key} style={{padding:12,borderBottom:'1px solid #ddd'}}>{c.key==='id'?r.id:c.key==='name'?r.name:c.key==='weight'?r.weight:'查看'}</td>)}</tr>)}</tbody>
  </table>
 </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
