import React from 'react';
import {LibraryPagination} from './LibraryPagination';
import type {PatternPage} from './patternModel';

export function PatternPagination({page,onPage,label='花型分页'}:{page:PatternPage;onPage(offset:number):void;label?:string}){
 return <LibraryPagination label={label} page={page} onPage={onPage}
  summary={<>共 {page.total} 个花型{page.totalColorways!==undefined?' · '+page.totalColorways+' 个配色':''} · 每页 {page.limit} 个花型</>}/>;
}
