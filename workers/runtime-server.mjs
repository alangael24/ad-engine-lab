import {createChatRuntime} from './chat-runtime.mjs';
import {WORKFLOW_MODEL,SCRIPT_MODEL} from '../assets/model-routing.js';
import {productionPromptModel} from '../src/production-vision.js';
import {H3_GUIDE_REVISION} from '../src/h3-prompts.js';
import {CLIP_BUFFER_CAPACITY} from './production-clip-buffer.mjs';
import {materialImageReviewEnabled} from './material-image-review.mjs';
import {productionWorkflow} from '../assets/production-workflow.js';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSandbox} from './video-use/sandbox.mjs';
import {editorialConfig,EDITORIAL_VERSION,EDITORIAL_MODELS} from './editorial-models.mjs';
// Always-on host for production/render workers and authenticated web chat. No public job API.
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createProductionProviders} from './production-providers.mjs';
import {productionApi} from './production-worker.mjs';
import {studioApi} from './studio-worker.mjs';
import {runtimeWorkerEnvironment} from './runtime-identity.mjs';
Object.assign(process.env,runtimeWorkerEnvironment(process.env));
await createProductionProviders(process.env).ready();
productionApi({appUrl:process.env.CREATIVE_RUSH_URL,token:process.env.PRODUCTION_WORKER_TOKEN,workerId:process.env.PRODUCTION_WORKER_ID});
studioApi({appUrl:process.env.CREATIVE_RUSH_URL,token:process.env.STUDIO_WORKER_TOKEN,workerId:process.env.STUDIO_WORKER_ID});
for(const bin of ['ffmpeg','ffprobe'])execFileSync(bin,['-version'],{stdio:'ignore'});
if(process.env.STUDIO_EDITORIAL_ENGINE==='legacy'){
 const check=await mkdtemp(join(tmpdir(),'editor-ready-'));
 try{await mkdir(join(check,'edit'));const sandbox=await createSandbox(check,{python:process.env.VIDEO_USE_PYTHON});await sandbox.run([sandbox.python,'-c','import PIL, numpy'],30000);}finally{await rm(check,{recursive:true,force:true});}
}else editorialConfig(process.env);
if(process.env.H3_SERVERLESS_ENDPOINT_ID && process.env.GPU_IDLE_ENABLED==='true')throw Error('Choose Serverless or managed Pod idle control, not both');
const concurrency=Number(process.env.PRODUCTION_CONCURRENCY||1);
if(![1,2].includes(concurrency))throw Error('PRODUCTION_CONCURRENCY_CONFIG');
const processes=[...Array(concurrency).fill('production-worker.mjs'),'studio-worker.mjs',...(process.env.H3_BACKEND!=='pod'&&process.env.H3_SERVERLESS_ENDPOINT_ID?['h3-worker.mjs']:[]),...(process.env.GPU_IDLE_ENABLED==='true'?['gpu-idle-worker.mjs']:[])];
let stopping=false;const children=new Set();const chat=createChatRuntime();
const server=createServer((req,res)=>{if(req.url!=='/health'||req.method!=='GET'){void chat.handle(req,res).then(handled=>{if(!handled)res.writeHead(404).end();}).catch(()=>{if(!res.headersSent)res.writeHead(503);res.end();});return;}res.writeHead(!stopping&&children.size===processes.length?200:503,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({status:!stopping&&children.size===processes.length?'ok':'stopping',commit:process.env.RENDER_GIT_COMMIT||null,editorial:process.env.STUDIO_EDITORIAL_ENGINE==='legacy'?'legacy':EDITORIAL_VERSION,workflow:productionWorkflow(process.env).version,models:productionWorkflow(process.env),chatRuntime:chat.ready?'render-v1':'disabled',chatModel:WORKFLOW_MODEL,referenceModel:WORKFLOW_MODEL,scriptModel:SCRIPT_MODEL,productionConcurrency:concurrency,clipBufferCapacity:CLIP_BUFFER_CAPACITY,h3PromptWriter:productionPromptModel(process.env),h3PromptGuide:H3_GUIDE_REVISION,imageProvider:process.env.PRODUCTION_IMAGE_PROVIDER||'openai',imageReview:materialImageReviewEnabled(process.env)?'deepseek-material-v1':'legacy'}));});
function shutdown(code){if(stopping)return;stopping=true;server.close();void chat.close().then(()=>{if(!children.size&&!chat.pendingCount)process.exit(code);});for(const child of children)child.kill('SIGTERM');const deadline=setTimeout(()=>process.exit(code),25000);deadline.unref();if(!children.size&&!chat.pendingCount)process.exit(code);}
for(const file of processes){
 const child=spawn(process.execPath,['--max-old-space-size=512',fileURLToPath(new URL(file,import.meta.url))],{stdio:'inherit',env:file==='production-worker.mjs'?runtimeWorkerEnvironment(process.env):process.env});children.add(child);
 child.on('error',error=>{console.error(JSON.stringify({event:'runtime_child_error',file,code:error.code||'UNKNOWN'}));shutdown(1);});
 child.on('exit',(code,signal)=>{console.log(JSON.stringify({event:'runtime_child_exit',file,code,signal,stopping}));children.delete(child);if(stopping){if(!children.size&&!chat.pendingCount)process.exit(0);}else shutdown(1);});
}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>shutdown(0));
server.listen(Number(process.env.PORT||10000),'0.0.0.0');
