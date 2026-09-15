import {readBounded} from '../src/generations.js';
const fail=(code='PRODUCTION_VOICE_ALIGNMENT',details={})=>{
 console.error(JSON.stringify({event:'production_voice_failed',code,...details}));
 throw Object.assign(Error(code),{code});
};
export function subtitleUrl(value){
 let url;try{url=new URL(value);}catch{fail('PRODUCTION_VOICE_SUBTITLES');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!['minimax-algeng-chat-tts-us.oss-us-east-1.aliyuncs.com'].includes(url.hostname))fail('PRODUCTION_VOICE_SUBTITLES');
 return url;
}

export function minimaxAlignment(segments,text){
 if(!Array.isArray(segments)||!segments.length)fail();
 const sourceWords=segments.flatMap(s=>Array.isArray(s.timestamped_words)?s.timestamped_words:[]),words=[];
 // MiniMax repeats the same source range for phonetic pieces of numbers.
 // Collapse only identical, explicit ranges; real repeated words have distinct offsets.
 for(const w of sourceWords){
  const previous=words.at(-1),range=Number.isInteger(w.word_begin)&&Number.isInteger(w.word_end)&&w.word_end>w.word_begin;
  if(previous&&range&&w.word_begin===previous.word_begin&&w.word_end===previous.word_end&&w.word===previous.word&&Number.isFinite(w.time_begin)&&Number.isFinite(w.time_end)&&w.time_begin>=previous.time_end-.001&&w.time_end>=w.time_begin){previous.time_end=w.time_end;}
  else words.push({...w});
 }

 if(!words.length)fail();
 let previous=0;
 for(const w of words){if(typeof w.word!=='string'||!Number.isFinite(w.time_begin)||!Number.isFinite(w.time_end)||w.time_begin<previous||w.time_end<w.time_begin)fail();previous=w.time_begin;}
 if(words.map(w=>w.word).join('').replace(/\s/gu,'')!==text.replace(/\s/gu,'')){
  const norm=s=>s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  if(norm(words.map(w=>w.word).join(''))!==norm(text))fail();
  const spans=[];for(const w of words){const n=norm(w.word).length;for(let i=0;i<n;i++)spans.push([w.time_begin/1000+(w.time_end-w.time_begin)/1000*i/n,w.time_begin/1000+(w.time_end-w.time_begin)/1000*(i+1)/n]);}
  let offset=0;const tokens=[];for(const word of text.match(/\S+/gu)||[]){const n=norm(word).length;if(!n){if(tokens.length)tokens.at(-1).word+=' '+word;continue;}tokens.push({word,start:spans[offset][0],end:spans[offset+n-1][1]});offset+=n;}
  return {characters:tokens.map(w=>w.word),character_start_times_seconds:tokens.map(w=>w.start),character_end_times_seconds:tokens.map(w=>w.end)};
 }
 return {characters:words.map(w=>w.word),character_start_times_seconds:words.map(w=>w.time_begin/1000),character_end_times_seconds:words.map(w=>w.time_end/1000)};
}
export async function requestMiniMaxAudio(text,env,{fetchImpl=fetch}={}){
 if(!env.MINIMAX_API_KEY||typeof text!=='string'||!text.trim()||text.length>=10000)fail('PRODUCTION_VOICE_CONFIG');
 const model=env.PRODUCTION_SPEECH_MODEL||'speech-2.8-hd';
 let r;try{r=await fetchImpl('https://api.minimax.io/v1/t2a_v2',{method:'POST',headers:{authorization:`Bearer ${env.MINIMAX_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model,text,stream:false,output_format:'hex',subtitle_enable:true,subtitle_type:'word',language_boost:'auto',voice_setting:{voice_id:env.MINIMAX_VOICE_ID||'English_expressive_narrator',speed:1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}}),signal:AbortSignal.timeout(120000)});}catch{fail('PRODUCTION_VOICE_UNCERTAIN');}
 if(!r.ok)fail('PRODUCTION_VOICE_HTTP',{httpStatus:r.status});
 let d;try{d=JSON.parse(new TextDecoder().decode(await readBounded(r,45000000)));}catch{fail('PRODUCTION_VOICE_UNCERTAIN');}
 const traceId=typeof d.trace_id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(d.trace_id)?d.trace_id:null;
 if(d.base_resp?.status_code!==0)fail('PRODUCTION_VOICE_REJECTED',{providerCode:Number.isInteger(d.base_resp?.status_code)?d.base_resp.status_code:null,traceId});
 const usage={provider:'minimax',model,characters:d.extra_info?.usage_characters??null,costUsd:model==='speech-2.8-hd'&&Number.isFinite(d.extra_info?.usage_characters)?d.extra_info.usage_characters*.0001:null,basis:'Measured characters at HD list price; subscription cash debit unavailable',traceId};
 console.log(JSON.stringify({event:'production_voice_usage',...usage}));
 if(d.data?.status!==2||typeof d.data.audio!=='string'||! /^(?:[a-f\d]{2})+$/i.test(d.data.audio))fail('PRODUCTION_VOICE_AUDIO',{traceId});
 const bytes=Buffer.from(d.data.audio,'hex');if(!bytes.length||bytes.length>20971520)fail('PRODUCTION_VOICE_AUDIO',{traceId});
 // Preserve paid audio even when subtitles are absent or malformed. URL is checked before fetching.
 return {bytes,subtitleUrl:typeof d.data.subtitle_file==='string'?d.data.subtitle_file:null,usage};
}
export async function alignMiniMaxAudio(capture,text,{fetchImpl=fetch}={}){
 const url=subtitleUrl(capture.subtitleUrl);
 let sub;try{sub=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(60000)});}catch{fail('PRODUCTION_VOICE_SUBTITLES');}
 if(!sub.ok)fail('PRODUCTION_VOICE_SUBTITLES',{httpStatus:sub.status});
 let segments;try{segments=JSON.parse(new TextDecoder().decode(await readBounded(sub,3000000)));}catch{fail('PRODUCTION_VOICE_SUBTITLES');}
 return minimaxAlignment(segments,text);
}
export async function synthesizeMiniMax(text,env,{fetchImpl=fetch,onAudio}={}){
 const capture=await requestMiniMaxAudio(text,env,{fetchImpl});
 if(onAudio)await onAudio(capture);
 return {...capture,alignment:await alignMiniMaxAudio(capture,text,{fetchImpl})};
}
