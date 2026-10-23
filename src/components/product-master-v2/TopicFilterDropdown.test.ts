import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildTopicFilterGroups,resolveSelectedTopicLabels,TopicFilterDropdown} from './TopicFilterDropdown';
import {TOPIC_PRESETS} from './topicCatalog';

const topics=[
 {id:'1',name:'油画花卉',isArchived:false},
 {id:'2',name:'条纹',isArchived:false},
 {id:'3',name:'我的手绘涂鸦',isArchived:false},
 {id:'4',name:'已归档题材',isArchived:true},
];

test('all 16 preset topics remain selectable even when dictionary rows are not yet created',()=>{
 const groups=buildTopicFilterGroups(topics,[]);
 assert.equal(groups.presets.length,16);
 assert.equal(groups.presets.length,TOPIC_PRESETS.length);
 const seeded=groups.presets.find(p=>p.name==='油画花卉')!;
 assert.equal(seeded.available,true);assert.equal(seeded.id,'1');
 const missing=groups.presets.find(p=>p.name==='波点')!;
 assert.equal(missing.available,true);assert.equal(missing.id,'');
 // 自定义/历史题材单独分组
 assert.deepEqual(groups.others.map(o=>o.name),['我的手绘涂鸦','已归档题材']);
});

test('P1-7 dropdown reflects current selection on both preset and custom options',()=>{
 const groups=buildTopicFilterGroups(topics,['1','3']);
 assert.equal(groups.presets.find(p=>p.name==='油画花卉')!.checked,true);
 assert.equal(groups.presets.find(p=>p.name==='条纹')!.checked,false);
 assert.equal(groups.others.find(o=>o.name==='我的手绘涂鸦')!.checked,true);
});

test('custom historical topics remain distinguishable, archived tags cannot be newly selected',()=>{
 const groups=buildTopicFilterGroups(topics,['4']);
 assert.equal(groups.others.find(x=>x.name==='已归档题材')?.available,false);
 assert.equal(groups.others.find(x=>x.name==='我的手绘涂鸦')?.available,true);
});
test('P1-7 selected topic labels keep unknown ids visible',()=>{
 assert.deepEqual(resolveSelectedTopicLabels(topics,['1','99']),[
  {id:'1',name:'油画花卉'},{id:'99',name:'题材 #99'}
 ]);
});

test('historical archived custom labels expose deletion without re-enabling selection',()=>{
 const html=renderToStaticMarkup(React.createElement(TopicFilterDropdown,{topics,selected:[],onToggle(){},onArchiveCustom:async()=>{}}));
 assert(html.includes('删除自定义题材 已归档题材'));
 assert(html.includes('该题材已归档'));
});
test('P1-7 dropdown renders one trigger instead of 16 flat chips',()=>{
 const html=renderToStaticMarkup(React.createElement(TopicFilterDropdown,{topics,selected:['1'],onToggle(){}}));
 assert(html.includes('v2-topic-trigger'));
 assert(html.includes('aria-expanded="false"'));
 assert(html.includes('v2-topic-trigger-count'));
 // 已选题材单独一行，且带单个移除按钮
 assert(html.includes('已选题材'));
 assert(html.includes('移除题材 油画花卉'));
 // 面板默认收起
 assert(html.includes('v2-topic-panel"'));
 assert(html.includes('hidden'));
});

test('P1-7 dropdown lists presets and custom topics inside the panel',()=>{
 const html=renderToStaticMarkup(React.createElement(TopicFilterDropdown,{topics,selected:[],onToggle(){},onAddCustom:async()=>{},onArchiveCustom:async()=>{}}));
 for(const name of TOPIC_PRESETS)assert(html.includes(name),name);
 assert(html.includes('我的手绘涂鸦'));
 assert(html.includes('自定义／历史题材'));
 // 预设项缺少数据库记录时也允许点击，由父组件按需创建并筛选。
 assert(!html.includes('暂无该题材的花型标签'));
 assert(html.includes('aria-label="添加自定义题材"'));
 assert(html.includes('删除自定义题材 我的手绘涂鸦'));
});
