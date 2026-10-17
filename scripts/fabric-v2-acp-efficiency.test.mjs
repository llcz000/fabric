import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {recordEvent,summarizeEfficiency} from './fabric-v2-acp-efficiency.mjs';

const fresh=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fabric-acp-metrics-'));return {dir,file:path.join(dir,'metrics.jsonl')}};
test('latest requirements use SCAN/QUERY IDs without pretending to be legacy AC tasks',()=>{
 const {dir,file}=fresh();
 try{
  recordEvent(file,{run:'scan-01-probe',role:'A',ac:'SCAN-01',kind:'started'},()=>new Date('2026-10-15T00:00:00Z'));
  recordEvent(file,{run:'query-03-probe',role:'C',ac:'QUERY-03',kind:'started'},()=>new Date('2026-10-15T00:00:00Z'));
  assert.equal(summarizeEfficiency(file).completedDeliveries,0);
  assert.throws(()=>recordEvent(file,{run:'unsafe',role:'A',ac:'FAKE-01',kind:'started'}),/identity/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('records observed lifecycle timestamps and separates verified delivery from claimed completion',()=>{
 const {dir,file}=fresh();
 try{
  recordEvent(file,{run:'fixture-1',role:'A',ac:'AC-71',kind:'started'},()=>new Date('2026-10-15T00:00:00Z'));
  recordEvent(file,{run:'fixture-1',role:'A',ac:'AC-71',kind:'red',tests:3},()=>new Date('2026-10-15T00:00:05Z'));
  recordEvent(file,{run:'fixture-1',role:'A',ac:'AC-71',kind:'green',tests:8},()=>new Date('2026-10-15T00:01:00Z'));
  recordEvent(file,{run:'fixture-1',role:'A',ac:'AC-71',kind:'agent_done'},()=>new Date('2026-10-15T00:01:15Z'));
  let r=summarizeEfficiency(file);
  assert.equal(r.completedDeliveries,0);assert.equal(r.runs[0].verified,false);
  recordEvent(file,{run:'fixture-1',role:'A',ac:'AC-71',kind:'verified',tests:8,changedFiles:2,rework:1,tokens:53194},()=>new Date('2026-10-15T00:02:00Z'));
  r=summarizeEfficiency(file);
  assert.equal(r.completedDeliveries,1);
  assert.equal(r.runs[0].wallSeconds,120);
  assert.equal(r.runs[0].secondsToRed,5);
  assert.equal(r.runs[0].secondsAgentWork,75);
  assert.equal(r.runs[0].integrationSeconds,45);
  assert.equal(r.runs[0].testCount,8);
  assert.equal(r.runs[0].changedFiles,2);
  assert.equal(r.runs[0].rework,1);
  assert.equal(r.runs[0].tokens,53194);
  assert.equal(r.aggregate.reportedTokens,53194);
  assert.equal(r.aggregate.tokenReports,1);
  assert.equal(r.speedupPercent,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('rejects out-of-order, invalid and duplicated events and never accepts client wall-clock values',()=>{
 const {dir,file}=fresh();
 try{
  const base={run:'safe-task',role:'A',ac:'AC-71'};
  assert.throws(()=>recordEvent(file,{...base,kind:'green',tests:1},()=>new Date()),/first|started|sequence/i);
  assert.throws(()=>recordEvent(file,{...base,kind:'started',timestamp:'2020-01-01'},()=>new Date()),/field|unknown/i);
  recordEvent(file,{...base,kind:'started'},()=>new Date('2026-10-15T00:00:00Z'));
  assert.throws(()=>recordEvent(file,{...base,kind:'started'},()=>new Date('2026-10-15T00:00:02Z')),/duplicate|sequence/i);
  assert.throws(()=>recordEvent(file,{...base,kind:'verified',tests:1,changedFiles:1,rework:0},()=>new Date('2026-10-15T00:00:03Z')),/sequence/i);
  assert.throws(()=>recordEvent(file,{...base,kind:'red',tests:-1},()=>new Date()),/tests/i);
  recordEvent(file,{...base,kind:'blocked'},()=>new Date('2026-10-15T00:00:10Z'));
  assert.equal(summarizeEfficiency(file).completedDeliveries,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('permits late observation without inventing RED/GREEN timestamps',()=>{
 const {dir,file}=fresh();
 try{
  const base={run:'late-run',role:'A',ac:'AC-71'};
  recordEvent(file,{...base,kind:'started'},()=>new Date('2026-10-15T00:00:00Z'));
  recordEvent(file,{...base,kind:'agent_done'},()=>new Date('2026-10-15T00:00:30Z'));
  recordEvent(file,{...base,kind:'verified',tests:30,changedFiles:2,rework:0},()=>new Date('2026-10-15T00:00:50Z'));
  const report=summarizeEfficiency(file);
  assert.equal(report.completedDeliveries,1);
  assert.equal(report.runs[0].secondsToRed,null);
  assert.equal(report.runs[0].secondsAgentWork,30);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('cancelled ACP can be independently salvaged without pretending Agent completed',()=>{
 const {dir,file}=fresh();
 try{
  const base={run:'agent-cancelled',role:'A',ac:'AC-71'};
  recordEvent(file,{...base,kind:'started'},()=>new Date('2026-10-15T00:00:00Z'));
  recordEvent(file,{...base,kind:'red',tests:23},()=>new Date('2026-10-15T00:00:40Z'));
  recordEvent(file,{...base,kind:'agent_cancelled'},()=>new Date('2026-10-15T00:03:00Z'));
  assert.throws(()=>recordEvent(file,{...base,kind:'verified',tests:23,changedFiles:2,rework:2},()=>new Date('2026-10-15T00:03:01Z')),/sequence|cancel/i);
  recordEvent(file,{...base,kind:'salvaged',tests:23,changedFiles:2,rework:2,tokens:53194},()=>new Date('2026-10-15T00:04:00Z'));
  const report=summarizeEfficiency(file);
  assert.equal(report.completedDeliveries,1);
  assert.equal(report.salvagedDeliveries,1);
  assert.equal(report.agentSuccessfulDeliveries,0);
  assert.equal(report.runs[0].status,'salvaged');
  assert.equal(report.runs[0].agentCompleted,false);
  assert.equal(report.runs[0].integrationSeconds,60);
  assert.equal(report.aggregate.reportedTokens,53194);
  assert.equal(report.speedupPercent,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('reports multiple runs without fictional serial baselines; no secrets or raw agent prompts',()=>{
 const {dir,file}=fresh();
 try{
  for(const [id,role] of [['a','A'],['b','B']]){
   const base={run:'safe-'+id,role,ac:'AC-71'};
   recordEvent(file,{...base,kind:'started'},()=>new Date('2026-10-15T00:00:00Z'));
   recordEvent(file,{...base,kind:'red',tests:1},()=>new Date('2026-10-15T00:00:10Z'));
   recordEvent(file,{...base,kind:'green',tests:2},()=>new Date('2026-10-15T00:00:20Z'));
   recordEvent(file,{...base,kind:'agent_done'},()=>new Date('2026-10-15T00:00:30Z'));
   recordEvent(file,{...base,kind:'verified',tests:2,changedFiles:2,rework:0},()=>new Date('2026-10-15T00:00:40Z'));
  }
  const report=summarizeEfficiency(file);
  assert.equal(report.completedDeliveries,2);
  assert.equal(report.aggregate.verifiedTests,4);
  assert.equal(report.aggregate.totalRework,0);
  assert.equal(report.speedupPercent,null);
  assert.ok(!JSON.stringify(report).includes('secret'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});