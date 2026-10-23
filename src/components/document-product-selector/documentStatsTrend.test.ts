import assert from 'node:assert/strict';
import test from 'node:test';
import {computeTrend,formatTrend,isDateString,previousRange,quickRanges,rangeLength,shiftDate} from './documentStatsTrend';

test('TREND-01 date helpers work across month and year boundaries',()=>{
 assert.equal(shiftDate('2026-10-01',-1),'2026-09-30');
 assert.equal(shiftDate('2026-01-01',-1),'2025-12-31');
 assert.equal(shiftDate('2026-03-01',-1),'2026-02-28');
 assert.equal(shiftDate('2024-03-01',-1),'2024-02-29');
 assert.equal(rangeLength('2026-10-01','2026-10-31'),31);
 assert.equal(rangeLength('2026-10-01','2026-10-01'),1);
 assert.equal(isDateString('2026-02-31'),false);
 assert.equal(isDateString('2026-10-01'),true);
 assert.throws(()=>rangeLength('2026-10-31','2026-10-01'));
});

test('TREND-01 previous range is the immediately preceding equal-length window',()=>{
 assert.deepEqual(previousRange({from:'2026-10-01',to:'2026-10-07'}),{from:'2026-09-24',to:'2026-09-30'});
 assert.deepEqual(previousRange({from:'2026-10-01',to:'2026-10-01'}),{from:'2026-09-30',to:'2026-09-30'});
 assert.deepEqual(previousRange({from:'2026-01-01',to:'2026-01-31'}),{from:'2025-12-01',to:'2025-12-31'});
 // 无限区间没有可比基期。
 assert.equal(previousRange({from:'',to:''}),null);
 assert.equal(previousRange({from:'2026-10-01',to:''}),null);
 assert.equal(previousRange({from:'','to':'2026-10-01'}),null);
});

test('TREND-01 trend reports direction and ratio, and refuses to invent a percentage on a zero baseline',()=>{
 const up=computeTrend(120,100);
 assert.equal(up.direction,'up');
 assert.equal(up.ratio,0.2);
 assert.equal(formatTrend(up),'+20%');
 const down=computeTrend(80,100);
 assert.equal(down.direction,'down');
 assert.equal(down.ratio,-0.2);
 assert.equal(formatTrend(down),'-20%');
 const flat=computeTrend(100,100);
 assert.equal(flat.direction,'flat');
 assert.equal(formatTrend(flat),'0%');
 const zeroBase=computeTrend(50,0);
 assert.equal(zeroBase.ratio,null);
 assert.equal(zeroBase.delta,50);
 assert.equal(formatTrend(zeroBase),'新增 50');
 const noBase=computeTrend(50,null);
 assert.equal(noBase.ratio,null);
 assert.equal(noBase.delta,null);
 assert.equal(formatTrend(noBase),'');
});

test('TREND-01 quick ranges cover 7 days, 30 days, this month and all',()=>{
 const options=quickRanges('2026-10-20');
 assert.deepEqual(options.map(item=>item.key),['7d','30d','month','all']);
 assert.deepEqual(options[0].range,{from:'2026-10-14',to:'2026-10-20'});
 assert.deepEqual(options[1].range,{from:'2026-09-21',to:'2026-10-20'});
 assert.deepEqual(options[2].range,{from:'2026-10-01',to:'2026-10-20'});
 assert.deepEqual(options[3].range,{from:'',to:''});
});
