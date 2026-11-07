/** Whole-image physical dimensions, shared by every colorway of a master. */
export interface PatternDimensions {widthCm:number|null;heightCm:number|null}
export function validatePatternDimensions(width:unknown,height:unknown):PatternDimensions{
 if(width===null&&height===null)return {widthCm:null,heightCm:null};
 const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=99999999.9999&&/^\d+(?:\.\d{1,4})?$/.test(String(v));
 if(!valid(width)||!valid(height))throw Error('宽高须同时填写大于0的厘米数（最多4位小数），或同时留空');
 return {widthCm:width,heightCm:height};
}
export function parsePatternDimensionDraft(width:string,height:string):PatternDimensions{
 const w=width.trim(),h=height.trim();
 if(!w&&!h)return {widthCm:null,heightCm:null};
 if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(w)||!(/^(?:\d+(?:\.\d*)?|\.\d+)$/).test(h))throw Error('请完整填写花型宽度和高度，单位厘米');
 return validatePatternDimensions(Number(w),Number(h));
}
export function formatPatternDimensions(value:{widthCm?:number|null;heightCm?:number|null}):string{
 return value.widthCm!=null&&value.heightCm!=null?`${value.widthCm} × ${value.heightCm} cm`:'—';
}
