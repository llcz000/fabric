/**
 * 经营大盘「环比」与「快捷区间」的纯函数计算。
 * 不依赖 React 与网络，便于单测覆盖边界（跨月、跨年、空区间、零基数）。
 */

export interface DateRange{from:string;to:string}

const DATE=/^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value:string):boolean{
 if(!DATE.test(value))return false;
 const time=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}

const toUtc=(value:string)=>Date.parse(value+'T00:00:00Z');
const fromUtc=(time:number)=>new Date(time).toISOString().slice(0,10);

/** 某日期加减天数（UTC 日历日）。 */
export function shiftDate(value:string,days:number):string{
 if(!isDateString(value))throw Error('日期格式不正确');
 return fromUtc(toUtc(value)+days*86400000);
}

/** 两个日期之间相差的自然日数（to-from+1）。 */
export function rangeLength(from:string,to:string):number{
 if(!isDateString(from)||!isDateString(to)||from>to)throw Error('日期范围不正确');
 return Math.round((toUtc(to)-toUtc(from))/86400000)+1;
}

/**
 * 推导紧邻当前区间之前的等长区间，用于环比。
 * 缺少任一端点（无限区间）时没有可比基期，返回 null。
 */
export function previousRange(range:DateRange):DateRange|null{
 const {from,to}=range;
 if(!from||!to)return null;
 if(!isDateString(from)||!isDateString(to)||from>to)return null;
 const length=rangeLength(from,to);
 const prevTo=shiftDate(from,-1);
 return {from:shiftDate(prevTo,-(length-1)),to:prevTo};
}

export type TrendDirection='up'|'down'|'flat';

export interface Trend{
 /** 变化量（current-previous）。基期缺失时为 null。 */
 delta:number|null;
 /** 变化百分比（0-1 之间的小数）。基期缺失或基期为 0 时为 null。 */
 ratio:number|null;
 direction:TrendDirection;
}

/** 计算环比。previous 为 null（无基期）时返回空趋势，不臆造 0%。 */
export function computeTrend(current:number,previous:number|null):Trend{
 if(previous===null||!Number.isFinite(current)||!Number.isFinite(previous))
  return {delta:null,ratio:null,direction:'flat'};
 const delta=current-previous;
 if(previous===0)return {delta,ratio:null,direction:delta===0?'flat':delta>0?'up':'down'};
 const ratio=delta/Math.abs(previous);
 return {delta,ratio,direction:delta===0?'flat':delta>0?'up':'down'};
}

/** 环比展示文案：基期缺失时不展示，避免误导。 */
export function formatTrend(trend:Trend):string{
 if(trend.ratio===null)return trend.delta===null?'':(trend.delta>0?'新增 '+trend.delta:(trend.delta<0?'减少 '+Math.abs(trend.delta):'持平'));
 const percent=Math.abs(trend.ratio*100);
 const rounded=percent>=100?Math.round(percent):Math.round(percent*10)/10;
 return (trend.direction==='up'?'+':trend.direction==='down'?'-':'')+rounded+'%';
}

export type QuickRangeKey='7d'|'30d'|'month'|'all';

export interface QuickRangeOption{key:QuickRangeKey;label:string;range:DateRange}

/** 快捷区间：近 7 天 / 近 30 天 / 本月 / 全部。 */
export function quickRanges(today:string):QuickRangeOption[]{
 if(!isDateString(today))throw Error('日期格式不正确');
 return [
  {key:'7d',label:'近 7 天',range:{from:shiftDate(today,-6),to:today}},
  {key:'30d',label:'近 30 天',range:{from:shiftDate(today,-29),to:today}},
  {key:'month',label:'本月',range:{from:today.slice(0,8)+'01',to:today}},
  {key:'all',label:'全部',range:{from:'',to:''}}
 ];
}
