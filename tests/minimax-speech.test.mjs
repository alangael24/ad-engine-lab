import {test} from 'node:test';
import assert from 'node:assert/strict';
import {minimaxAlignment,synthesizeMiniMax} from '../workers/minimax-speech.mjs';
import {createProductionProviders} from '../workers/production-providers.mjs';
const subtitles=[{timestamped_words:[{word:'Hello',time_begin:0,time_end:500},{word:'.',time_begin:500,time_end:600}]}];
const response={base_resp:{status_code:0},data:{status:2,audio:'ff00',subtitle_file:'https://minimax-algeng-chat-tts-us.oss-us-east-1.aliyuncs.com/test'},extra_info:{usage_characters:6}};
test('MiniMax times are seconds and preserve punctuation',()=>{assert.deepEqual(minimaxAlignment(subtitles,'Hello.'),{characters:['Hello','.'],character_start_times_seconds:[0,.5],character_end_times_seconds:[.5,.6]});assert.throws(()=>minimaxAlignment(subtitles,'Changed.'));assert.throws(()=>minimaxAlignment([{timestamped_words:[{word:'Hello.',time_begin:100,time_end:0}]}],'Hello.'));});
test('requests HD word alignment and records usage without retries',async()=>{let count=0;const r=await synthesizeMiniMax('Hello.',{MINIMAX_API_KEY:'test'},{fetchImpl:async(url,opts)=>{count++;if(count===1){const body=JSON.parse(opts.body);assert.equal(body.subtitle_type,'word');assert.equal(body.model,'speech-2.8-hd');return Response.json(response);}assert.equal(opts.redirect,'error');assert.equal(opts.headers,undefined);return Response.json(subtitles);}});assert.equal(count,2);assert.equal(r.usage.characters,6);assert.equal(r.bytes.length,2);});
test('rejects provider errors and unsafe subtitle URLs without follow-up calls',async()=>{for(const d of [{...response,base_resp:{status_code:1008}},{...response,data:{...response.data,subtitle_file:'http://127.0.0.1/private'}}]){let n=0;await assert.rejects(()=>synthesizeMiniMax('Hello.',{MINIMAX_API_KEY:'test'},{fetchImpl:async()=>{n++;return Response.json(d);}}));assert.equal(n,1);}});
test('production accepts MiniMax without ElevenLabs credentials',async()=>{await createProductionProviders({MINIMAX_API_KEY:'test',REFERENCE_FLASH_KEY:'test',OPENAI_API_KEY:'test'}).ready();await assert.rejects(()=>createProductionProviders({REFERENCE_FLASH_KEY:'test',OPENAI_API_KEY:'test'}).ready());});
test('alignment tolerates punctuation segmentation while preserving every spoken word and original script',()=>{
 const data=[{timestamped_words:[{word:'Hola',time_begin:0,time_end:400},{word:'mundo',time_begin:400,time_end:1000}]}];
 const r=minimaxAlignment(data,'¡Hola, mundo!');assert.deepEqual(r.characters,['¡Hola,','mundo!']);assert.deepEqual(r.character_start_times_seconds,[0,.4]);assert.equal(r.character_end_times_seconds.at(-1),1);
 assert.throws(()=>minimaxAlignment(data,'¡Hola, otro mundo!'));
});

test('normalised number phonemes sharing one source range do not duplicate spoken words',()=>{
 const parts=[{word:'30',word_begin:0,word_end:2,time_begin:0,time_end:100},{word:'30',word_begin:0,word_end:2,time_begin:100,time_end:200},{word:'30',word_begin:0,word_end:2,time_begin:200,time_end:350},{word:' noches',word_begin:2,word_end:9,time_begin:350,time_end:800}];
 const r=minimaxAlignment([{timestamped_words:parts}],'30 noches');assert.deepEqual(r.characters,['30',' noches']);assert.equal(r.character_end_times_seconds[0],.35);
 assert.throws(()=>minimaxAlignment([{timestamped_words:parts.map((w,i)=>({...w,word_begin:i*2,word_end:i*2+2}))}],'30 noches'));
 assert.throws(()=>minimaxAlignment([{timestamped_words:parts.map(({word_begin,word_end,...w})=>w)}],'30 noches'));
});
