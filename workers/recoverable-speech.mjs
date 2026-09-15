import {createHash} from 'node:crypto';
import {requestMiniMaxAudio,alignMiniMaxAudio} from './minimax-speech.mjs';
// The checkpoint is bound to the exact spoken copy and voice configuration.
// A started checkpoint without a confirmed result must never resubmit TTS.
export async function recoverableSpeech(text,env,invoke,save,{fetchImpl=fetch,stepKey='narration'}={}){
 const fingerprint=createHash('sha256').update(JSON.stringify([text,env.PRODUCTION_SPEECH_MODEL||'speech-2.8-hd',env.MINIMAX_VOICE_ID||'English_expressive_narrator','auto',stepKey])).digest('hex');
 const key='voice-'+fingerprint.slice(0,32),state=await invoke('begin_step',{key,stage:'narration'});
 let capture;
 if(state.status==='done')capture=state.result;
 else{
  const generated=await requestMiniMaxAudio(text,env,{fetchImpl});
  if(Number.isFinite(generated.usage.costUsd))await invoke('record_cost',{key:stepKey,costUsd:generated.usage.costUsd});
  const saved=await save(generated.bytes);
  capture={...saved,subtitleUrl:generated.subtitleUrl,usage:generated.usage,fingerprint};
  await invoke('finish_step',{key,stage:'narration',result:capture});
 }
 if(capture.fingerprint!==fingerprint||!capture.assetId)throw Error('PRODUCTION_VOICE_UNCERTAIN');
 const alignment=await alignMiniMaxAudio(capture,text,{fetchImpl});
 if(!Number.isFinite(capture.duration)||capture.duration<=0||capture.duration>120||alignment.character_end_times_seconds.some(t=>t>capture.duration+.05))throw Error('PRODUCTION_TIMING');
 return {assetId:capture.assetId,duration:capture.duration,alignment,usage:capture.usage,reusedAudio:state.status==='done'};
}
