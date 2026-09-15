import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveredStillApprovals} from '../src/recovered-still-approvals.js';
import {measuredEditorialCost} from '../src/production-spend.js';
function fixture(){
 const project={id:'p',user_id:'u',revision:7,brand_snapshot:{product:'shower'},data:{scriptDraft:'Hello',scenes:[{id:'s',imageAssetId:'corrected'}]}};
 const prior={id:'old',user_id:'u',project_id:'p',status:'failed',expected_revision:7,steps:{prepare:{status:'done',result:structuredClone(project)},plan:{result:{scenes:[{id:'plan-s'}]}},timing:{result:[{id:'s',planSceneId:'plan-s'}]},'still-check-0-0':{status:'done',result:{verdict:'repair',issues:[{}],assetIds:['wrong']}},'still-check-0-1':{status:'done',result:{verdict:'pass',issues:[],assetIds:['corrected']}}}};
 return {project,prior};
}
test('exact unchanged retry reuses the approved repaired image, never the rejected original',()=>{
 const {project,prior}=fixture();assert.equal(recoveredStillApprovals(project,[prior]).s.assetId,'corrected');
 assert.equal(recoveredStillApprovals(project,[prior]).s.productionId,'old');
});
test('editing settles only a reconciled complete usage record; unknown or inconsistent calls retain their reservation',()=>{
 const usage={unknown:false,total:.25,calls:[{status:'completed',cost:.1},{status:'failed',cost:.15}]};
 assert.equal(measuredEditorialCost(usage),.25);
 assert.equal(measuredEditorialCost({...usage,unknown:true}),null);
 assert.equal(measuredEditorialCost({...usage,total:.05}),null);
 assert.equal(measuredEditorialCost({...usage,calls:[{status:'started',cost:.25}]}),null);
 assert.equal(measuredEditorialCost({...usage,calls:[{status:'failed'}]}),null);
 assert.equal(measuredEditorialCost({unknown:false,total:0,calls:[]}),0);
});
test('changed product, script, image, revision, ownership or incomplete proof invalidates approval',()=>{
 const changes=[p=>p.data.scriptDraft='Other',p=>p.brand_snapshot.product='Other',p=>p.data.scenes[0].imageAssetId='other',p=>p.revision++,p=>p.user_id='other'];
 for(const change of changes){const {project,prior}=fixture();change(project);assert.deepEqual(recoveredStillApprovals(project,[prior]),{});}
 for(const change of [p=>p.status='running',p=>p.steps.prepare.status='started',p=>p.steps['still-check-0-1'].result.verdict='repair',p=>p.steps['still-check-0-1'].result.assetIds=['wrong'],p=>p.steps['still-check-0-1'].result.issues=[{}]]){const {project,prior}=fixture();change(prior);assert.deepEqual(recoveredStillApprovals(project,[prior]),{});}
});
test('failed retry follows a verified unchanged snapshot chain, not changed creative content',()=>{
 const {project,prior}=fixture(),snapshot=structuredClone(project);
 const note='Product, character and scene images approved before animation.';
 snapshot.data.creativeMemory={decisions:[note],preferences:['Dynamic']};
 prior.steps.prepare.result=structuredClone(snapshot);
 const current=structuredClone(snapshot);current.revision=8;current.data.creativeMemory.decisions.push(note);
 const retry={id:'retry',user_id:'u',project_id:'p',status:'failed',expected_revision:8,snapshot,
  steps:{prepare:{status:'done',result:structuredClone(current)},plan:{result:{scenes:[{id:'s'}]}},timing:{result:[{id:'s',planSceneId:'s'}]}}};
 assert.equal(recoveredStillApprovals(current,[retry,prior]).s.productionId,'old');
 for(const change of [p=>p.data.scenes[0].imageAssetId='changed',p=>p.data.scriptDraft='changed',p=>p.data.creativeMemory.preferences=['Other'],p=>p.data.creativeMemory.decisions.push('New direction')]){
  const modified=structuredClone(current);change(modified);
  assert.deepEqual(recoveredStillApprovals(modified,[{...retry,steps:{...retry.steps,prepare:{status:'done',result:modified}}},prior]),{});
 }
});
