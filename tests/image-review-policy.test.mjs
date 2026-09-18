import test from 'node:test';
import assert from 'node:assert/strict';
import {IMAGE_REVIEW_POLICY_VERSION,validateImageAssessment,imageEscalation,decideImage} from '../assets/image-review-policy.js';
import {runImageReviewPilot} from '../workers/image-review-pilot.mjs';
import {parseImageReviewJSON} from '../workers/image-review-json.mjs';
const criterion=(id,extra={})=>({id,kind:'product_identity',requirement:'Preserve recognizable product',blocking:true,risk:'normal',impact:'Viewer must recognize the advertised product',...extra});
const contract=(criteria=[criterion('identity')])=>({version:IMAGE_REVIEW_POLICY_VERSION,sceneId:'s1',revision:'1',unresolved:[],criteria});
const check=(criterionId,status='met',extra={})=>({criterionId,status,difference:status==='met'?'none':status==='violated'?'present':'unverifiable',observation:'Actual observed visible evidence',consequence:status==='violated'?'Product no longer recognizable':'',...extra});
const assessment=(c,checks=c.criteria.map(x=>check(x.id)))=>({sceneId:c.sceneId,checks});
const packet=c=>({contract:c,imageSha256:'a'.repeat(64),references:[{sha256:'b'.repeat(64),role:'actual_product'}]});
function harness(packets,fn){
 const store=new Map(),requests=[];
 const options={packets,auditRate:0,auditSeed:'fixed',modelIds:{primary:'deepseek-flash',secondary:'gpt-6-astra'},load:async k=>store.get(k),save:async(k,v)=>store.set(k,v),review:async req=>{requests.push(req);return fn?fn(req):{assessments:req.packets.map(p=>assessment(p.contract,p.scope.map(id=>check(id)))),usage:{tokens:1},costUsd:.001};}};
 return {options,requests,store};
}
test('tolerable real differences do not cause repairs or risk escalation',()=>{
 const c=contract([criterion('geometry',{kind:'product_relation',blocking:false,risk:'known_weakness',impact:''})]),a=assessment(c,[check('geometry','violated')]);
 assert.deepEqual(imageEscalation(c,a).criteria,[]);const d=decideImage(c,a);assert.equal(d.decision,'approve');assert.equal(d.observations.length,1);
});
test('mandatory known weakness is checked even after confident primary approval',()=>{
 const c=contract([criterion('geometry',{kind:'product_relation',risk:'known_weakness'})]),a=assessment(c);
 assert.deepEqual(imageEscalation(c,a).criteria,['geometry']);assert.equal(decideImage(c,a).decision,'consult');
 assert.equal(decideImage(c,a,{confirmed:[check('geometry','violated')]}).decision,'repair');
});
test('rejection needs independent confirmation; confirmed pass keeps asset',()=>{
 const c=contract(),a=assessment(c,[check('identity','violated')]);assert.equal(decideImage(c,a).decision,'consult');
 const d=decideImage(c,a,{confirmed:[check('identity')]});assert.equal(d.decision,'approve');assert.equal(d.overruled.length,1);
});
test('uncertainty or missing material consequence never authorizes repair',()=>{
 const c=contract(),a=assessment(c,[check('identity','unverifiable')]);assert.equal(decideImage(c,a,{confirmed:[check('identity','unverifiable')]}).decision,'consult');
 assert.equal(decideImage(c,a,{confirmed:[check('identity','violated',{consequence:''})]}).decision,'consult');
});
test('missing/duplicate/invented criteria and invented confirmations fail closed',()=>{
 const c=contract();assert.throws(()=>validateImageAssessment(assessment(c,[]),c));
 assert.throws(()=>validateImageAssessment(assessment(c,[check('invented')]),c));
 assert.throws(()=>decideImage(c,assessment(c),{confirmed:[check('identity')]}));
 const d=contract([criterion('a'),criterion('b')]);assert.throws(()=>validateImageAssessment(assessment(d,[check('a'),check('a')]),d));
});
test('unresolved contract stops before any model call',async()=>{
 const c=contract();c.unresolved=['photo versus cartoon not resolved'];const h=harness([packet(c)]);const r=await runImageReviewPilot(h.options);assert.equal(r.status,'contract_blocked');assert.equal(h.requests.length,0);assert.equal(r.animationReady,false);
});
test('collection style gate catches an omission before animation and caches paid stages',async()=>{
 const c=contract([criterion('identity'),criterion('style',{kind:'style',requirement:'Clearly handcrafted clay, not photographic people'})]);
 const second={...c,sceneId:'s2'};
 const h=harness([packet(c),packet(second)],req=>({assessments:req.packets.map(p=>assessment(p.contract,p.scope.map(id=>check(id,req.stage==='collection_gate'&&p.contract.sceneId==='s2'?'violated':'met')))),costUsd:.01,usage:{tokens:10}}));
 const r=await runImageReviewPilot(h.options);assert.equal(h.requests.length,3);assert.equal(h.requests.filter(x=>x.stage==='collection_gate').length,1);assert.equal(r.animationReady,false);assert.deepEqual(r.decisions.map(d=>d.decision),['approve','repair']);
 const resumed=await runImageReviewPilot(h.options);assert.equal(h.requests.length,3);assert(resumed.calls.every(c=>c.reused));
});
test('changed assets/contracts/references invalidate cache',async()=>{
 const h=harness([packet(contract())]);await runImageReviewPilot(h.options);h.options.packets[0].imageSha256='c'.repeat(64);await runImageReviewPilot(h.options);assert.equal(h.requests.length,2);
 h.options.packets[0].contract.revision='2';await runImageReviewPilot(h.options);assert.equal(h.requests.length,3);
 h.options.packets[0].references[0].sha256='d'.repeat(64);await runImageReviewPilot(h.options);assert.equal(h.requests.length,4);
});
test('sample audit examines passes without showing the primary verdict to Astra',async()=>{
 const h=harness([packet(contract())]);h.options.auditRate=1;const r=await runImageReviewPilot(h.options);assert.equal(h.requests.length,2);assert.equal(h.requests[1].stage,'collection_gate');assert(!JSON.stringify(h.requests[1]).includes('primary'));assert.equal(r.animationReady,true);
});
test('invalid answers preserve usage, stop, and are not paid again on resume',async()=>{
 const h=harness([packet(contract())],()=>({assessments:[],usage:{tokens:100},costUsd:.12}));const r=await runImageReviewPilot(h.options);assert.equal(r.decisions[0].decision,'consult');assert.equal([...h.store.values()][0].costUsd,.12);
 await runImageReviewPilot(h.options);assert.equal(h.requests.length,3); // Primary, fallback and bounded confirmation retry; all cached.
});
test('unknown transport cost is retained as unknown, not zero',async()=>{
 const h=harness([packet(contract())],()=>{throw Error('offline');});const r=await runImageReviewPilot(h.options);assert.equal(r.animationReady,false);assert.equal([...h.store.values()][0].costUsd,null);
});
test('review adapter cannot relax the frozen acceptance contract',async()=>{
 const h=harness([packet(contract())],req=>{req.packets[0].contract.criteria[0].blocking=false;return {assessments:[]};});
 const r=await runImageReviewPilot(h.options);assert.equal(r.decisions[0].decision,'consult');assert.equal(h.options.packets[0].contract.criteria[0].blocking,true);
});
test('technical failure escalates once; other scenes still finish',async()=>{
 const c=contract(),h=harness([packet(c),packet({...c,sceneId:'s2'})],req=>{
  if(req.stage==='inspect'&&req.packets[0].contract.sceneId==='s1')return {assessments:[],usage:{tokens:3}};
  return {assessments:req.packets.map(p=>assessment(p.contract,p.scope.map(id=>check(id))))};
 });
 const r=await runImageReviewPilot(h.options);assert.equal(r.records[0].primaryUnavailable,true);assert.equal(r.animationReady,true);assert.equal(h.requests.filter(q=>q.stage==='collection_gate').length,1);
});
test('syntax-only recovery closes delimiters without inventing missing criteria',()=>{
 const c=contract(),text=JSON.stringify({assessments:[assessment(c)]});
 const parsed=parseImageReviewJSON(text.slice(0,-2));assert.deepEqual(parsed.value,JSON.parse(text));assert.equal(parsed.normalization.appended,']}');
 const incomplete=parseImageReviewJSON('{"sceneId":"s1","checks":[');assert.throws(()=>validateImageAssessment(incomplete.value,c));
 assert.throws(()=>parseImageReviewJSON('{"sceneId":"unfinished'));
 assert.throws(()=>parseImageReviewJSON('{"sceneId":}'));
});

test('incomplete confirmation retries the same evidence once and retains both costs',async()=>{
 const h=harness([packet(contract())],req=>({assessments:req.stage==='collection_gate'?[]:req.packets.map(p=>assessment(p.contract,p.scope.map(id=>check(id,req.stage==='inspect'?'violated':'met')))),costUsd:.01}));
 const r=await runImageReviewPilot(h.options);
 assert.equal(r.animationReady,true);assert.equal(h.requests.length,3);
 assert.deepEqual(h.requests[1].packets,h.requests[2].packets);
 assert.equal(h.requests[2].stage,'confirmation_retry');
 assert.equal(r.calls.reduce((n,c)=>n+c.costUsd,0),.03);
 await runImageReviewPilot(h.options);assert.equal(h.requests.length,3);
});
