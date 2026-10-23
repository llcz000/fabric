/** P1-8 generic library table chrome: sortable headers, column visibility, row hover.
 * Pure functions only — no React, no network — so every catalog can reuse them. */

export type SortDirection='asc'|'desc';

export interface LibraryColumn<T>{
 /** Stable key, also used for the persisted column-visibility state. */
 key:string;
 label:string;
 /** Whether the column can be sorted. */
 sortable?:boolean;
 /** Value used for sorting. Omit for non-sortable columns. */
 value?(row:T):string|number|null;
 /** Whether the column is visible by default. */
 defaultVisible?:boolean;
 /** Columns that can never be hidden (e.g. the action column). */
 locked?:boolean;
}

export interface SortState{
 key:string;direction:SortDirection;
}

export interface ColumnVisibility{
 [key:string]:boolean;
}

/** Build the default visibility map from a column definition list. */
export function buildColumnVisibility<T>(columns:LibraryColumn<T>[]):ColumnVisibility{
 const map:ColumnVisibility={};
 for(const column of columns)map[column.key]=column.defaultVisible!==false;
 return map;
}

/** Toggle one column; locked columns are always visible. */
export function toggleColumnVisibility<T>(columns:LibraryColumn<T>[],visibility:ColumnVisibility,key:string):ColumnVisibility{
 const column=columns.find(c=>c.key===key);
 if(!column||column.locked)return visibility;
 return {...visibility,[key]:visibility[key]===false};
}

/** Visible columns in definition order. */
export function visibleColumns<T>(columns:LibraryColumn<T>[],visibility:ColumnVisibility):LibraryColumn<T>[]{
 return columns.filter(column=>column.locked||visibility[column.key]!==false);
}

/** Next sort direction for a header click: unsorted → asc → desc → unsorted. */
export function nextSortState(current:SortState|null,key:string):SortState|null{
 if(!current||current.key!==key)return {key,direction:'asc'};
 if(current.direction==='asc')return {key,direction:'desc'};
 return null;
}

/** Sort rows by the given state. Rows without a comparable value sink to the bottom. */
export function sortRows<T>(rows:T[],sort:SortState|null,columns:LibraryColumn<T>[]):T[]{
 if(!sort)return rows;
 const column=columns.find(c=>c.key===sort.key);
 if(!column||!column.sortable||!column.value)return rows;
 const factor=sort.direction==='asc'?1:-1;
 return [...rows].sort((a,b)=>{
  const left=column.value!(a),right=column.value!(b);
  const leftEmpty=left===null||left===undefined||left==='';
  const rightEmpty=right===null||right===undefined||right==='';
  if(leftEmpty&&rightEmpty)return 0;
  if(leftEmpty)return 1;
  if(rightEmpty)return -1;
  if(typeof left==='number'&&typeof right==='number')return (left-right)*factor;
  return String(left).localeCompare(String(right),'zh')*factor;
 });
}

/** Persistence helpers — safe on both server (no window) and client. */
export const COLUMN_PREF_KEY='fabric.v2.library.columns';

export function readColumnVisibility<T>(columns:LibraryColumn<T>[],storageKey:string):ColumnVisibility{
 const fallback=buildColumnVisibility(columns);
 if(typeof window==='undefined'||!window.localStorage)return fallback;
 try{
  const raw=window.localStorage.getItem(storageKey);
  if(!raw)return fallback;
  const parsed=JSON.parse(raw) as unknown;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return fallback;
  const map=parsed as ColumnVisibility;
  const result:ColumnVisibility={...fallback};
  for(const column of columns){
   if(column.locked){result[column.key]=true;continue;}
   if(typeof map[column.key]==='boolean')result[column.key]=map[column.key] as boolean;
  }
  return result;
 }catch{return fallback;}
}

export function writeColumnVisibility(storageKey:string,visibility:ColumnVisibility):void{
 if(typeof window==='undefined'||!window.localStorage)return;
 try{window.localStorage.setItem(storageKey,JSON.stringify(visibility));}catch{/* storage unavailable — keep in-memory state */}
}
