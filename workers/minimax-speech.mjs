import {readBounded} from '../src/generations.js';
const fail=()=>{throw Object.assign(Error('PRODUCTION_PROVIDER'),{code:'PRODUCTION_PROVIDER'});};
export function minimaxAlignment(segments,text){
 if(!Array.isArray(segments)||!segments.length)fail();
 const words=segments.flatMap(s=>Array.isArray(s.timestamped_words)?s.timestamped_words:[]);
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
export async function synthesizeMiniMax(text,env,{fetchImpl=fetch}={}){
 if(!env.MINIMAX_API_KEY||typeof text!=='string'||!text.trim()||text.length>=10000)fail();
 const model=env.PRODUCTION_SPEECH_MODEL||'speech-2.8-hd';
 const r=await fetchImpl('https://api.minimax.io/v1/t2a_v2',{method:'POST',headers:{authorization:`Bearer ${env.MINIMAX_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model,text,stream:false,output_format:'hex',subtitle_enable:true,subtitle_type:'word',language_boost:'auto',voice_setting:{voice_id:env.MINIMAX_VOICE_ID||'English_expressive_narrator',speed:1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}}),signal:AbortSignal.timeout(120000)});
 if(!r.ok)fail();const d=JSON.parse(new TextDecoder().decode(await readBounded(r,45000000)));
 if(d.base_resp?.status_code!==0||d.data?.status!==2||typeof d.data.audio!=='string'||! /^(?:[a-f\d]{2})+$/i.test(d.data.audio))fail();
 const bytes=Buffer.from(d.data.audio,'hex');if(!bytes.length||bytes.length>20971520)fail();
 const url=new URL(d.data.subtitle_file);
 if(url.protocol!=='https:'||url.username||url.password||url.port||!['minimax-algeng-chat-tts-us.oss-us-east-1.aliyuncs.com'].includes(url.hostname))fail();
 const sub=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!sub.ok)fail();
 const alignment=minimaxAlignment(JSON.parse(new TextDecoder().decode(await readBounded(sub,3000000))),text);
 return {bytes,alignment,usage:{provider:'minimax',model,characters:d.extra_info?.usage_characters??null,costUsd:model==='speech-2.8-hd'&&Number.isFinite(d.extra_info?.usage_characters)?d.extra_info.usage_characters*.0001:null,basis:'Measured characters at HD list price; subscription cash debit unavailable',traceId:d.trace_id}};
}
