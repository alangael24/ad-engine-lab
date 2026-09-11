import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeShotContract} from '../assets/image-continuity.js';
import {projectData} from '../assets/studio-model.js';
import {sceneVideoContext} from '../src/h3-prompts.js';
import {command,probe} from '../workers/studio-renderer.mjs';
import {reviewVideo} from '../workers/production-quality.mjs';
import {MATERIAL_REVIEW_RULES} from '../assets/quality-model.js';
import {CHAT_MODEL} from '../assets/chat-model.js';
const contract={productVisible:true,characterVisible:true,transition:'cut',camera:'Rear view',state:'Right hand holds grounded case',endState:'Right hand carries case off floor',preserve:['Identity','Case'],change:['Viewpoint'],productViewAssetIds:[]};
test('opening and ending survive save and reach current and neighboring H3 shot contexts',()=>{
 const scene={id:crypto.randomUUID(),text:'Go.',visual:'Rear view',motion:'Lift case',start:0,end:2,shotContract:contract,imageAssetId:crypto.randomUUID(),selectedVersionId:null};
 const data=projectData({title:'Test',referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',scenes:[scene,{...scene,id:crypto.randomUUID(),start:2,end:4}]});
 const c=sceneVideoContext({data,brand_snapshot:{}},scene.id);
 assert.equal(c.scene.shotContract.endState,contract.endState);assert.equal(c.next.shotContract.state,contract.state);
 const {endState,...legacy}=contract;assert.deepEqual(normalizeShotContract(legacy),legacy);
 assert.throws(()=>normalizeShotContract({...contract,endState:' '}),/PRODUCTION_PLAN/);
});
test('review confirms continuity allegation with separate actual frames, prior scene and boundary samples',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'continuity-test-'));try{
 const path=join(dir,'test.mp4');await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=blue:s=96x160:r=24:d=2','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t','2','-c:v','libx264','-c:a','aac',path]);
 const scenes=[{id:'a',start:0,end:1,text:'First',shotContract:contract},{id:'b',start:1,end:2,text:'Second',shotContract:contract}];let calls=0;
 const result=await reviewVideo({path,scenes,directory:dir,project:{data:{}},env:{PRODUCTION_WORKFLOW_PROFILE:'sol-luna-v1',REFERENCE_FLASH_KEY:'fixture'},fetchImpl:async(_url,opts)=>{
 const req=JSON.parse(opts.body),content=req.messages?.[1].content||req.input[1].content;
 const context=JSON.parse(content[0].text);calls++;
 assert.ok((req.messages||req.input)[0].content.includes(MATERIAL_REVIEW_RULES), 'overview and focused review share materiality criteria');
 if(calls===1){assert.equal(context.scenes[1].shotContract.endState,contract.endState);assert.ok(context.sampling[0].times[2]>.94);}
 else {assert.equal(context.scenes.length,2);const imgs=content.filter(x=>x.type==='image_url'||x.type==='input_image');assert.ok(imgs.length>=6);assert.ok(content.some(x=>x.text?.includes('Scene a, actual output time')));}
 const raw=calls===1?{verdict:'repair',summary:'Proposed issue',issues:[{sceneId:'b',relatedSceneId:null,kind:'continuity',at:1.5,evidence:'Possible hand change',action:'replace_clip',visual:'Same case',motion:'Preserve hand'}]}:{verdict:'pass',summary:'Separate frames do not support allegation',issues:[]};
 return new Response('data: '+JSON.stringify({model:CHAT_MODEL,choices:[{delta:{tool_calls:[{index:0,function:{name:'review_ad',arguments:JSON.stringify(raw)}}]},finish_reason:'tool_calls'}]})+'\n\n');
 }});
 assert.equal(calls,2);assert.equal(result.verdict,'pass');assert.equal(result.issues.length,0);
 const sheet=await probe(join(dir,'sheet-0.jpg'));assert.equal(sheet.streams[0].width,768); // 3*240 + 4*12 gap/margin
 assert.ok((await readFile(join(dir,'individual-0-0-0.jpg'))).length>0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
