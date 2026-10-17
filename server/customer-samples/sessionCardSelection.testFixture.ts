type Row=Record<string,unknown>;
export class CardSelectionFixture{
 role='sales';active=true;login=true;grant=true;open=true;card=true;retired=false;parentActive=true;token=true;
 products:Row[]=[{id:'8',fabric_id:'18',master_id:'12',product_no:'0012-1-F018',colorway_no:1,product_active:1,colorway_active:1,sampling_available:1},
  {id:'9',fabric_id:'18',master_id:'12',product_no:'0012-2-F018',colorway_no:2,product_active:1,colorway_active:1,sampling_available:1}];
 items:Row[]=[];events:unknown[][]=[];cards=new Set<string>();calls:{sql:string;args:unknown[]}[]=[];commits=0;rollbacks=0;released=0;failure='';
 async getConnection(){const db=this;let snapshot:{items:Row[];events:unknown[][];cards:Set<string>};return {
  async beginTransaction(){snapshot={items:db.items.map(x=>({...x})),events:db.events.slice(),cards:new Set(db.cards)};},
  async commit(){if(db.failure==='commit')throw Error('PRIVATE commit');db.commits++;},
  async rollback(){db.rollbacks++;db.items=snapshot.items;db.events=snapshot.events;db.cards=snapshot.cards;},release(){db.released++;},
  async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   db.calls.push({sql,args});
   if(sql.includes('FROM v2_access_users'))return [[{id:'6',role:db.role,is_active:Number(db.active)}],[]];
   if(sql.includes('FROM v2_access_sessions'))return [db.login?[{id:'1'}]:[],[]];
   if(sql.includes('FROM customer_sample_session_access'))return [db.grant?[{can_manage:1}]:[],[]];
   if(sql.includes('FROM customer_sample_sessions'))return [[{id:'11',status:db.open?'open':'closed'}],[]];
   if(sql.includes('FROM pattern_masters'))return [[{id:'12',is_active:Number(db.parentActive)}],[]];
   if(sql.includes('FROM v2_fabrics'))return [[{id:'18',is_active:Number(db.parentActive)}],[]];
   if(sql.includes('FROM sample_cards'))return [db.card?[{id:'44',master_id:'12',fabric_id:'18',is_active:1,deleted_at:db.retired?'2026-10-17':null}]:[],[]];
   if(sql.includes('FROM sample_card_tokens'))return [db.token?[{card_id:'44',revoked_at:null}]:[],[]];
   if(sql.includes('FROM v2_products'))return [db.products,[]];
   if(sql.startsWith('SELECT')&&sql.includes('FROM customer_sample_items'))return [db.items.filter(x=>args.length===1||x.product_id===args[1]),[]];
   if(sql.startsWith('INSERT INTO customer_sample_selected_cards')){db.cards.add(String(args[1]));return [{affectedRows:1},[]];}
   if(sql.startsWith('INSERT INTO customer_sample_items')){
    if(db.failure==='insert'&&args[1]==='9')throw Error('PRIVATE insert');
    const id=String(80+db.items.length);db.items.push({id,product_id:args[1],removed_at:null,removed_by_user_id:null,selected_by_user_id:args[2]});return [{insertId:id,affectedRows:1},[]];
   }
   if(sql.startsWith('UPDATE customer_sample_items')){const item=db.items.find(x=>x.product_id===args[1])!;item.removed_at=null;item.removed_by_user_id=null;return [{affectedRows:1},[]];}
   if(sql.startsWith('INSERT INTO customer_sample_manual_events')){if(db.failure==='audit')throw Error('PRIVATE audit');db.events.push(args);return [{affectedRows:1,insertId:db.events.length},[]];}
   throw Error('Unexpected SQL '+sql);
  }
 };}
}
