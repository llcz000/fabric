import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DocumentStatsResults,V2DocumentStats} from './V2DocumentStats';
import type {DocumentStatsData} from './documentStatsModel';
const data:DocumentStatsData={
 orderCount:3,metersTotal:35,amountTotal:350,
 byType:{sample:{count:1,meters:10,amount:100},bulk:{count:1,meters:20,amount:250},deposit:{count:1,meters:5,contractAmount:700}},
 topProducts:[{productName:'棉麻布',meters:30}],
 recentOrders:[{id:'9007199254740993',orderNo:'XS-001',date:'2026-10-16',receivingUnit:'客户甲',type:'bulk',totalMeters:20,totalAmount:250}]
};
test('STATS-01 V2 dashboard renders server Top5 and navigable recent orders without deposit amount mixing',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentStatsResults,{data,onProduct:()=>{},onDocument:()=>{}}));
 for(const fragment of ['样布码单','销售发货码单','定金单','Top 5','棉麻布','XS-001','客户甲','合同金额','700.00','350.00'])assert(html.includes(fragment),fragment);
 assert(html.includes('type="button"'));
 assert(!html.includes('平均单价'));
 assert(!html.includes('>定金金额<'));
});
test('STATS-02 dashboard has server-only loading state and date filter controls',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentStats,{apiFetch:fetch,onProduct:()=>{},onDocument:()=>{}}));
 assert(html.includes('正在获取当前账号统计'));
 assert(html.includes('起始日期'));
 assert(html.includes('截止日期'));
 assert(!html.includes('ownerId'));
});
