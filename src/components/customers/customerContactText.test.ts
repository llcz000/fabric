import test from 'node:test';
import assert from 'node:assert/strict';
import {recognizeContactText} from './customerContactText';

test('recognizes a labeled shipping note and omits a trailing remark',()=>{
 const result=recognizeContactText('收货人：王小明\n手机号码：+86 138 0013 8000\n详细地址：浙江省杭州市西湖区文一西路88号\n3幢201室\n备注：周五送到');
 assert.deepEqual(result,{name:'王小明',phone:'+86 138 0013 8000',address:'浙江省杭州市西湖区文一西路88号 3幢201室',ambiguous:[]});
});

test('recognizes labels on one line and an unlabeled name phone address',()=>{
 assert.deepEqual(recognizeContactText('姓名: 林女士 电话: 0571-88886666 地址: 杭州市拱墅区庆隆路15号'),
  {name:'林女士',phone:'0571-88886666',address:'杭州市拱墅区庆隆路15号',ambiguous:[]});
 assert.deepEqual(recognizeContactText('赵启明 13900139000 广东省深圳市南山区科技中路3号'),
  {name:'赵启明',phone:'13900139000',address:'广东省深圳市南山区科技中路3号',ambiguous:[]});
});

test('returns blank for conflicting matches and for incomplete masked phones',()=>{
 const result=recognizeContactText('联系人：赵女士\n电话：13800001234 或 13900005678\n收货地址：杭州市拱墅区庆隆路15号');
 assert.deepEqual(result,{name:'赵女士',phone:'',address:'杭州市拱墅区庆隆路15号',ambiguous:['phone']});
 assert.deepEqual(recognizeContactText('手机：138****1234，邮编：310000'),
  {name:'',phone:'',address:'',ambiguous:[]});
});

test('deduplicates repeated phone notation and fits the form field limit',()=>{
 assert.deepEqual(recognizeContactText('姓名：陆女士\n手机：+8613800138000\n电话：138 0013 8000'),
  {name:'陆女士',phone:'+8613800138000',address:'',ambiguous:[]});
 const long='浙江省杭州市街道沿路仓库'.repeat(10);
 assert.equal(recognizeContactText('详细地址：'+long).address,'');
});
