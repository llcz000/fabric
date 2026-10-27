import type {AppPrincipal} from '../access/types';
import type {SamplePool} from './scanRepository';
import {lockSelectionAccess,selectionDbId,selectionRows,SampleSessionManualError} from './sessionManual';
import {getSelectedSampleCards,SampleCardError} from './cardLibrary';
import {buildSampleCardsWorkbook} from './cardExcel';
/** One authorized read transaction pins selection; no client-provided card IDs. */
export async function exportSessionCards(pool:SamplePool,actor:AppPrincipal,sessionId:string,scanOrigin?:string):Promise<Buffer>{
 const tx=await pool.getConnection();let began=false;
 try{
  await tx.beginTransaction();began=true;await lockSelectionAccess(tx,actor,sessionId,false);
  const [raw]=await tx.query('SELECT selected_card.card_id AS export_card_id FROM customer_sample_selected_cards selected_card '+
   'WHERE selected_card.session_id=? AND EXISTS (SELECT 1 FROM customer_sample_items selected '+
   'WHERE selected.session_id=selected_card.session_id AND selected.removed_at IS NULL AND ('+
   'EXISTS (SELECT 1 FROM customer_sample_item_sources src WHERE src.session_id=selected.session_id AND src.product_id=selected.product_id AND src.card_id=selected_card.card_id) OR '+
   'EXISTS (SELECT 1 FROM customer_sample_manual_events e WHERE e.session_id=selected.session_id AND e.product_id=selected.product_id AND e.card_id=selected_card.card_id))) '+
   'ORDER BY selected_card.card_id',[sessionId]);
  const ids=selectionRows(raw).map(row=>selectionDbId(row.export_card_id));
  if(!ids.length||new Set(ids).size!==ids.length)throw new SampleSessionManualError(409);
  const cards=[];
  for(let offset=0;offset<ids.length;offset+=1000)cards.push(...await getSelectedSampleCards(tx,ids.slice(offset,offset+1000)));
  if(cards.some(card=>!card.isActive))throw new SampleSessionManualError(409);
  const bytes=await buildSampleCardsWorkbook(cards,scanOrigin);
  await tx.commit();began=false;return bytes;
 }catch(error){if(began)await tx.rollback();if(error instanceof SampleCardError)throw new SampleSessionManualError(409);throw error;}finally{tx.release();}
}
