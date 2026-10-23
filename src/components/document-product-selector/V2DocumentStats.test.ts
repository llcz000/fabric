import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DocumentStatsResults,V2DocumentStats} from './V2DocumentStats';
import type {DocumentStatsData} from './documentStatsModel';
const data:DocumentStatsData={
 orderCount:3,metersTotal:35,amountTotal:350,
 pendingAmount:250,pendingCount:2,
 byType:{sample:{count:1,meters:10,amount:100},bulk:{count:1,meters:20,amount:250},deposit:{count:1,meters:5,contractAmount:700}},
 topProducts:[{productName:'棉麻布',meters:30}],
 recentOrders:[{id:'9007199254740993',orderNo:'XS-001',date:'2026-10-16',receivingUnit:'客户甲',type:'bulk',totalMeters:20,totalAmount:250}],
 compare:null
};
test('STATS-01 V2 dashboard renders server Top5 and navigable recent orders without deposit amount mixing',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentStatsResults,{data,onProduct:()=>{},onDocument:()=>{}}));
 for(const fragment of ['样布码单','销售发货码单','定金单','Top 5','棉麻布','XS-001','客户甲','合同额','700.00','350.00'])assert(html.includes(fragment),fragment);
 assert(html.includes('type="button"'));
 assert(!html.includes('平均单价'));
 assert(!html.includes('>定金金额<'));
});
test('STATS-01 dashboard uses one comparable metric set for all three document types',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentStatsResults,{data,onProduct:()=>{},onDocument:()=>{}}));
 // 每张类型卡都必须给出 单据数 / 出库米数 / 每米均价，避免定金单与营收单混比。
 for(const fragment of ['每米均价','单','米'])assert(html.includes(fragment),fragment);
 assert(html.includes('10.00'),'sample 每米均价应为 100/10');
 assert(html.includes('12.50'),'bulk 每米均价应为 250/20');
 assert(html.includes('不计入营收'));
});
test('STATS-01 dashboard surfaces outstanding receivable and never mixes it into revenue',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentStatsResults,{data,onProduct:()=>{},onDocument:()=>{}}));
 assert(html.includes('待收尾款'),'缺少待收尾款指标');
 assert(html.includes('2 单未结清'),'缺少未结清单数');
 assert(html.includes('250.00'));
});
test('STATS-01 dashboard shows period-over-period trend only when a comparison baseline exists',()=>{
 const withBase=renderToStaticMarkup(React.createElement(DocumentStatsResults,{
  data:{...data,compare:{...data,orderCount:2,amountTotal:280,metersTotal:28,pendingAmount:300,pendingCount:3}},
  onProduct:()=>{},onDocument:()=>{}}));
 assert(withBase.includes('较上期'),'有基期时应显示环比');
 assert(withBase.includes('+50%'),'单据数环比应为 +50%');
 assert(!renderToStaticMarkup(React.createElement(DocumentStatsResults,{data,onProduct:()=>{},onDocument:()=>{}})).includes('较上期'),
  '无基期时不应显示环比，避免把「无数据」误读为「零增长」');
});
test('STATS-01 Top5 ranking shows share so the leader is readable at a glance',()=>{
 const html=renderToStaticMarkup(React.createElement(DocumentStatsResults,{data,onProduct:()=>{},onDocument:()=>{}}));
 assert(html.includes('100.0%'),'单条排行应占 100%');
 assert(html.includes('v2-rank-bar'),'排行缺少进度条');
});
test('STATS-02 dashboard has server-only loading state and date filter controls',()=>{
 const html=renderToStaticMarkup(React.createElement(V2DocumentStats,{apiFetch:fetch,onProduct:()=>{},onDocument:()=>{}}));
 assert(html.includes('正在获取当前账号统计'));
 assert(html.includes('起始日期'));
 assert(html.includes('截止日期'));
 assert(html.includes('近 30 天'),'缺少快捷时间区间');
 assert(!html.includes('ownerId'));
});
