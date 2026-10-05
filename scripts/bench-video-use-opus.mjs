// Benchmark: run the real CreativeRush Editor loop (plan -> approve -> edit ->
// render -> review) with Claude Opus as the model, through the local Claude Code
// CLI (`claude -p`, billed to the signed-in plan). Records per-call usage and cost.
//
//   node scripts/bench-video-use-opus.mjs --video videos/03_ads_animados.mp4 \
//     --transcript videos/edit/transcripts/03_ads_animados.json \
//     --python /abs/venv/bin/python --out /abs/out-dir [--request "..."]
//
// With --executor deepseek, Opus directs and DeepSeek v4.1 Flash (OpenCode Go,
// OPENCODE_API_KEY) executes: it writes the EDL and overlays from Opus' brief, and
// handles animation builders and filmstrip observations.
//
// Costs are the API list-price equivalent reported by Claude Code (1h cache writes),
// plus a recomputation at standard API rates with 5-minute cache writes. A plan
// subscription does not debit these amounts.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,chmod,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,basename} from 'node:path';
import {parseArgs} from 'node:util';
import {runVideoUse,boundedVisualContext} from '../workers/video-use/agent.mjs';
import {prepareInputs} from '../workers/video-use-worker.mjs';

const {values:opt}=parseArgs({options:{
 video:{type:'string',default:'videos/03_ads_animados.mp4'},
 transcript:{type:'string',default:'videos/edit/transcripts/03_ads_animados.json'},
 python:{type:'string'},out:{type:'string'},
 reference:{type:'string'},'reference-transcript':{type:'string'},
 broll:{type:'string'},'broll-transcript':{type:'string'},
 model:{type:'string',default:'claude-opus-5-5'},effort:{type:'string',default:'low'},
 claude:{type:'string',default:'claude'},'max-usd':{type:'string',default:'6'},
 executor:{type:'string',default:'none'},
 request:{type:'string',default:'Quita los silencios largos y las pausas muertas. Agrega subtítulos dinámicos con la palabra que se está diciendo resaltada en amarillo. Pon el título «Energía después de los 40» solo durante los primeros 3 segundos.'},
}});
if(!opt.python||!opt.out)throw Error('--python (absolute venv interpreter) and --out are required');

// USD per million tokens, Claude API list prices (snapshot 2026-09-25).
const PRICES={'claude-opus-5-5':{input:4,read:.2,write5m:5,write1h:8,output:20},'claude-sonnet-5-5':{input:2,read:.2,write5m:2.5,write1h:4,output:10}};
// Astra rates from workers/editorial-models.mjs, for a rough same-token reference only.
const ASTRA={input:10,read:1,write:12.5,output:50};
const price=PRICES[opt.model];if(!price)throw Error('No price snapshot for '+opt.model);
// OpenCode peak API-equivalent rates for deepseek-flash (workers/editorial-models.mjs);
// a Go subscription does not debit these amounts.
const DEEPSEEK={model:'deepseek-v4.1-flash',input:.3,read:.006,output:1.2};
// Sub-agent roles that only execute or describe; direction and review stay on Opus.
const EXECUTOR_TOOLS=new Set(['build_animation','observations']);
if(!['none','deepseek'].includes(opt.executor))throw Error('--executor must be none or deepseek');
if(opt.executor==='deepseek'&&!process.env.OPENCODE_API_KEY)throw Error('OPENCODE_API_KEY is required for --executor deepseek');

const out=resolve(opt.out),ledger=[];let phase='setup';
await mkdir(out,{recursive:true});

// Render the OpenAI-style chat history as stable, append-only content blocks so
// the prompt cache can reuse earlier turns, the same as a provider cache would.
function render(messages,tools){
 const [first,...rest]=messages,names=new Map(),blocks=[];
 for(const m of rest){
  if(m.role==='assistant'){
   const calls=(m.tool_calls||[]).map(c=>{names.set(c.id,c.function.name);return `-> called ${c.function.name} ${c.function.arguments}`;}).join('\n');
   blocks.push({type:'text',text:`[YOUR EARLIER TURN]\n${[m.content,calls].filter(Boolean).join('\n')}`});
  }else if(m.role==='tool')blocks.push({type:'text',text:`[TOOL RESULT ${names.get(m.tool_call_id)||''}]\n${m.content}`});
  else if(m.role==='system')blocks.push({type:'text',text:`[OPERATOR NOTE]\n${m.content}`});
  else if(typeof m.content==='string')blocks.push({type:'text',text:`[USER]\n${m.content}`});
  else for(const c of m.content){
   if(c.type==='text')blocks.push({type:'text',text:`[USER]\n${c.text}`});
   else{const u=c.image_url.url,d=/^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(u);blocks.push(d?{type:'image',source:{type:'base64',media_type:d[1],data:d[2]}}:{type:'image',source:{type:'url',url:u}});}
  }
 }
 const catalog=tools.map(t=>({name:t.function.name,description:t.function.description,parameters:t.function.parameters}));
 const system=`${first.content}\n\nTOOL PROTOCOL\nYou act by choosing exactly one tool call per response, returned in the structured output as {"call":{"tool":<name>,"arguments":{...}}}. Optional "note" is brief text shown alongside the call. Earlier turns and tool results appear in the conversation as labeled blocks. Available tools:\n${JSON.stringify(catalog)}`;
 const schema={type:'object',additionalProperties:false,required:['call'],properties:{note:{type:'string'},call:{anyOf:catalog.map(t=>({type:'object',additionalProperties:false,required:['tool','arguments'],properties:{tool:{const:t.name},arguments:t.parameters}}))}}};
 return {system,schema,blocks};
}

function claude(system,schema,blocks){
 const args=['-p','--model',opt.model,'--effort',opt.effort,'--tools','','--strict-mcp-config','--setting-sources','','--no-session-persistence','--system-prompt',system,'--json-schema',JSON.stringify(schema),'--input-format','stream-json','--output-format','stream-json','--verbose'];
 return new Promise((yes,no)=>{
  const p=spawn(opt.claude,args,{cwd:out,stdio:['pipe','pipe','pipe']});let so='',se='';
  const timer=setTimeout(()=>p.kill('SIGKILL'),600000);
  p.stdout.on('data',x=>so+=x);p.stderr.on('data',x=>se=(se+x).slice(-4000));p.on('error',no);
  p.on('close',code=>{clearTimeout(timer);try{const r=so.trim().split('\n').map(l=>{try{return JSON.parse(l);}catch{return null;}}).findLast(x=>x?.type==='result');r.is_error||code?no(Object.assign(Error('claude -p failed: '+(r.result||se).slice(0,500)),{result:r})):yes(r);}catch{no(Error(`claude -p exited ${code}: ${se.slice(-500)}`));}});
  p.stdin.on('error',()=>{}); // a CLI that exits early reports through close
  p.stdin.end(JSON.stringify({type:'user',message:{role:'user',content:blocks}})+'\n');
 });
}

const cost=u=>({cc:null,api5m:((u.input_tokens||0)*price.input+(u.cache_read_input_tokens||0)*price.read+(u.cache_creation_input_tokens||0)*price.write5m+(u.output_tokens||0)*price.output)/1e6,astraRef:(((u.input_tokens||0)+(u.cache_creation_input_tokens||0))*ASTRA.input+(u.cache_read_input_tokens||0)*ASTRA.read+(u.output_tokens||0)*ASTRA.output)/1e6});
const spent=()=>ledger.reduce((n,c)=>n+(c.costUSD||0),0);

async function deepseekTurn(messages,tools,usage){
 const started=Date.now(),r=await fetch('https://opencode.ai/zen/go/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(600000),
  headers:{authorization:`Bearer ${process.env.OPENCODE_API_KEY}`,'content-type':'application/json','x-opencode-session':'creativerush-bench-'+crypto.randomUUID()},
  body:JSON.stringify({model:DEEPSEEK.model,reasoning_effort:'low',max_tokens:12000,tool_choice:'required',parallel_tool_calls:false,tools,messages:boundedVisualContext(messages)})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok||d.error){usage.unmetered++;ledger.push({phase,model:DEEPSEEK.model,tools:tools.map(t=>t.function.name),error:JSON.stringify(d.error||r.status).slice(0,300)});throw Error('DeepSeek unavailable');}
 const u=d.usage||{},cached=u.prompt_tokens_details?.cached_tokens||0,input=(u.prompt_tokens||0)-cached,c=d.choices?.[0];
 const costUSD=(input*DEEPSEEK.input+cached*DEEPSEEK.read+(u.completion_tokens||0)*DEEPSEEK.output)/1e6;
 const entry={phase,model:d.model,tool:c?.message?.tool_calls?.[0]?.function?.name,ms:Date.now()-started,input,cacheRead:cached,cacheWrite:0,output:u.completion_tokens,costUSD,api5m:costUSD,astraRef:0};
 ledger.push(entry);usage.calls++;usage.input+=u.prompt_tokens||0;usage.cached+=cached;usage.output+=u.completion_tokens||0;
 await writeFile(resolve(out,'ledger.json'),JSON.stringify(ledger,null,1));
 console.log(JSON.stringify({phase,n:ledger.length,model:'deepseek',tool:entry.tool,cost:+costUSD.toFixed(4),total:+spent().toFixed(4),s:Math.round(entry.ms/1000)}));
 if(!String(d.model).startsWith(DEEPSEEK.model))throw Error('Unexpected DeepSeek model: '+d.model);
 const calls=c?.message?.tool_calls||[];
 if(c?.finish_reason!=='tool_calls'||calls.length!==1||!tools.some(t=>t.function.name===calls[0].function.name))throw Error('Incomplete DeepSeek tool response');
 return {role:'assistant',content:c.message.content||null,tool_calls:calls.map(x=>({id:x.id,type:'function',function:{name:x.function.name,arguments:x.function.arguments}}))};
}

// Same contract as agent.mjs modelTurn: one tool call per assistant turn.
async function turn(messages,tools,env,usage){
 checkBudget(usage);
 if(opt.executor==='deepseek'&&tools.length===1&&EXECUTOR_TOOLS.has(tools[0].function.name))return deepseekTurn(messages,tools,usage);
 const {system,schema,blocks}=render(boundedVisualContext(messages),tools),started=Date.now();
 let r;try{r=await claude(system,schema,blocks);}catch(e){usage.unmetered++;ledger.push({phase,tools:tools.map(t=>t.function.name),error:e.message});throw e;}
 const u=r.usage||{},models=Object.keys(r.modelUsage||{});
 if(models.some(m=>m!==opt.model))throw Error('Unexpected model in usage: '+models.join(','));
 const c=r.structured_output?.call,entry={phase,model:opt.model,tool:c?.tool,ms:Date.now()-started,turns:r.num_turns,input:u.input_tokens,cacheRead:u.cache_read_input_tokens,cacheWrite:u.cache_creation_input_tokens,output:u.output_tokens,images:blocks.filter(b=>b.type==='image').length,costUSD:r.total_cost_usd,...cost(u)};
 delete entry.cc;ledger.push(entry);
 usage.calls++;usage.input+=(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0);usage.cached+=u.cache_read_input_tokens||0;usage.cacheWrite=(usage.cacheWrite||0)+(u.cache_creation_input_tokens||0);usage.output+=u.output_tokens||0;
 await writeFile(resolve(out,'ledger.json'),JSON.stringify(ledger,null,1));
 console.log(JSON.stringify({phase,n:ledger.length,tool:entry.tool,cost:+(entry.costUSD||0).toFixed(4),total:+spent().toFixed(4),s:Math.round(entry.ms/1000)}));
 if(!c||!tools.some(t=>t.function.name===c.tool))throw Error('Incomplete Opus tool response');
 return {role:'assistant',content:r.structured_output.note||null,tool_calls:[{id:'call_'+ledger.length,type:'function',function:{name:c.tool,arguments:JSON.stringify(c.arguments??{})}}]};
}
function checkBudget(usage){if(usage.calls>=80||spent()>=Number(opt['max-usd']))throw Error('Editing model budget reached');}

const python=opt.python,video=resolve(opt.video),bytes=await readFile(video);
const root=resolve(out,'job');await mkdir(resolve(root,'edit'),{recursive:true});await chmod(resolve(root,'edit'),0o777);
const sandboxOptions={python};
const hash=b=>createHash('sha256').update(b).digest('hex'),sources=[{id:'S01',name:basename(video),path:video}],cachedTranscripts={S01:{path:resolve(opt.transcript),sha256:hash(bytes)}};
// Optional style reference: shown to the editor as evidence, never used as footage.
// Optional B-roll: real footage the edit may use (e.g. the lower panel of a split screen).
if(opt.broll){const b=resolve(opt.broll);sources.push({id:'S0'+(sources.length+1),name:basename(b),path:b});cachedTranscripts['S0'+sources.length]={path:resolve(opt['broll-transcript']),sha256:hash(await readFile(b))};}
if(opt.reference){const ref=resolve(opt.reference);const rid='S0'+(sources.length+1);sources.push({id:rid,name:basename(ref),path:ref,reference:true});cachedTranscripts[rid]={path:resolve(opt['reference-transcript']),sha256:hash(await readFile(ref))};}
const input=await prepareInputs({sources},await realpath(root),{sandboxOptions,cachedTranscripts});
// The executor writes files and code from Opus' brief (delegate_execution).
const executeModel=opt.executor==='deepseek'?async(messages,tools,env,usage)=>{if(spent()>=Number(opt['max-usd']))throw Error('Editing model budget reached');return deepseekTurn(messages,tools,usage);}:null;
const common={root:await realpath(root),request:opt.request,env:{VIDEO_USE_PYTHON:python},sandboxOptions,callModel:turn,checkBudget,executeModel,...input};
const report={broll:opt.broll||null,model:opt.model,executor:opt.executor==='deepseek'?DEEPSEEK.model:null,effort:opt.effort,video:opt.video,reference:opt.reference||null,request:opt.request,startedAt:new Date().toISOString()};
const t0=Date.now();
try{
 phase='plan';const plan=await runVideoUse({...common,mode:'plan'});report.plan={status:plan.status,message:plan.message};
 if(plan.status==='awaiting_approval'){
  phase='edit';const edit=await runVideoUse({...common,mode:'edit',strategy:plan.message});
  report.edit={status:edit.status,message:edit.message,renderedDuration:edit.renderedDuration,output:edit.path};
 }
}catch(e){report.error=e.message;}
const sum=(p,k)=>ledger.filter(c=>!p||c.phase===p).reduce((n,c)=>n+(c[k]||0),0);
report.minutes=+((Date.now()-t0)/60000).toFixed(1);
report.totals=Object.fromEntries(['plan','edit',null].map(p=>[p||'all',{calls:ledger.filter(c=>!p||c.phase===p).length,input:sum(p,'input'),cacheRead:sum(p,'cacheRead'),cacheWrite:sum(p,'cacheWrite'),output:sum(p,'output'),costUSD_claudeCode:+sum(p,'costUSD').toFixed(4),costUSD_api5m:+sum(p,'api5m').toFixed(4),astraSameTokensRef:+sum(p,'astraRef').toFixed(4)}]));
report.byModel={};for(const c of ledger.filter(x=>!x.error)){const m=report.byModel[c.model]??={calls:0,costUSD:0};m.calls++;m.costUSD=+(m.costUSD+(c.costUSD||0)).toFixed(4);}
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
