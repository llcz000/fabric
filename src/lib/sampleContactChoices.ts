/** A profile version fences these indexes; the chosen display label is saved on the order. */
export function sampleContactChoices(contacts:readonly {name:string}[]){
 const named=contacts.map(({name},index)=>({index,name:name.trim()})).filter(({name})=>name);
 const counts=new Map<string,number>();
 for(const {name} of named)counts.set(name,(counts.get(name)??0)+1);
 return named.map(({index,name})=>({index,name:(counts.get(name)??0)>1?name+' · '+(index+1):name}));
}
export interface SampleContactChoice{index:number;customerVersion:string}
export interface SampleContactAssignment{contactName:string|null;linkVersion:string}
export interface SampleContactOptions extends SampleContactAssignment{customerVersion:string;selectedIndex?:number|null;choices:{index:number;name:string}[]}
