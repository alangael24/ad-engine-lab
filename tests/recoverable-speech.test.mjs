import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverableSpeech} from '../workers/recoverable-speech.mjs';
const response={base_resp:{status_code:0},data:{status:2,audio:'ff00',subtitle_file:'https://minimax-algeng-chat-tts-us.oss-us-east-1.aliyuncs.com/test'},extra_info:{usage_characters:6}};
test('saved audio survives failed subtitles and retry never resynthesizes it',async()=>{
 const steps={},costs=[];let tts=0,saved=0,valid=false;
 const invoke=async(action,d)=>{
  if(action==='record_cost'){costs.push(d);return {};}
  if(action==='begin_step'){if(steps[d.key]?.status==='started')throw Error('PRODUCTION_UNCERTAIN');return steps[d.key]||=( {status:'started'});}
  if(action==='finish_step')return steps[d.key]={status:'done',result:d.result};
  throw Error(action);
 };
 const fetchImpl=async url=>{if(String(url).includes('t2a_v2')){tts++;return Response.json(response);}return Response.json([{timestamped_words:[{word:valid?'Hello.':'Wrong.',time_begin:0,time_end:500}]}]);};
 const save=async()=>{saved++;return {assetId:'saved-voice',duration:1};};
 await assert.rejects(recoverableSpeech('Hello.',{MINIMAX_API_KEY:'test'},invoke,save,{fetchImpl}),/PRODUCTION_VOICE_ALIGNMENT/);
 assert.equal(Object.values(steps)[0].status,'done');assert.equal(costs.length,1);
 valid=true;const r=await recoverableSpeech('Hello.',{MINIMAX_API_KEY:'test'},invoke,save,{fetchImpl});
 assert.equal(r.assetId,'saved-voice');assert.equal(r.reusedAudio,true);assert.equal(tts,1);assert.equal(saved,1);
});
test('lost TTS response stays ambiguous and cannot silently be charged twice',async()=>{
 let started=false,calls=0;
 const invoke=async()=>{if(started)throw Error('PRODUCTION_UNCERTAIN');started=true;return {status:'started'};};
 const run=()=>recoverableSpeech('Hello.',{MINIMAX_API_KEY:'test'},invoke,async()=>{throw Error('must not save');},{fetchImpl:async()=>{calls++;throw Error('connection lost');}});
 await assert.rejects(run,/PRODUCTION_VOICE_UNCERTAIN/);await assert.rejects(run,/PRODUCTION_UNCERTAIN/);assert.equal(calls,1);
});
