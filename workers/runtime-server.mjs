import {productionWorkflow} from '../assets/production-workflow.js';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSandbox} from './video-use/sandbox.mjs';
import {editorialConfig,EDITORIAL_VERSION,EDITORIAL_MODELS} from './editorial-models.mjs';
// Always-on host for the production coordinator and CPU renderer. No public job API.
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createProductionProviders} from './production-providers.mjs';
import {productionApi} from './production-worker.mjs';
import {studioApi} from './studio-worker.mjs';
await createProductionProviders(process.env).ready();
productionApi({appUrl:process.env.CREATIVE_RUSH_URL,token:process.env.PRODUCTION_WORKER_TOKEN,workerId:process.env.PRODUCTION_WORKER_ID});
studioApi({appUrl:process.env.CREATIVE_RUSH_URL,token:process.env.STUDIO_WORKER_TOKEN,workerId:process.env.STUDIO_WORKER_ID});
for(const bin of ['ffmpeg','ffprobe'])execFileSync(bin,['-version'],{stdio:'ignore'});
if(process.env.STUDIO_EDITORIAL_ENGINE==='legacy'){
 const check=await mkdtemp(join(tmpdir(),'editor-ready-'));
 try{await mkdir(join(check,'edit'));const sandbox=await createSandbox(check,{python:process.env.VIDEO_USE_PYTHON});await sandbox.run([sandbox.python,'-c','import PIL, numpy'],30000);}finally{await rm(check,{recursive:true,force:true});}
}else editorialConfig(process.env);
const processes=['production-worker.mjs','studio-worker.mjs',...(process.env.GPU_IDLE_ENABLED==='true'?['gpu-idle-worker.mjs']:[])];
let stopping=false;const children=new Set();
const server=createServer((req,res)=>{if(req.url!=='/health'||req.method!=='GET'){res.writeHead(404).end();return;}res.writeHead(!stopping&&children.size===processes.length?200:503,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({status:!stopping&&children.size===processes.length?'ok':'stopping',commit:process.env.RENDER_GIT_COMMIT||null,editorial:process.env.STUDIO_EDITORIAL_ENGINE==='legacy'?'legacy':EDITORIAL_VERSION,workflow:productionWorkflow(process.env).version,models:productionWorkflow(process.env)}));});
function shutdown(code){if(stopping)return;stopping=true;server.close();for(const child of children)child.kill('SIGTERM');const deadline=setTimeout(()=>process.exit(code),25000);deadline.unref();if(!children.size)process.exit(code);}
for(const file of processes){
 const child=spawn(process.execPath,['--max-old-space-size=512',fileURLToPath(new URL(file,import.meta.url))],{stdio:'inherit'});children.add(child);
 child.on('error',()=>shutdown(1));child.on('exit',()=>{children.delete(child);if(stopping){if(!children.size)process.exit(0);}else shutdown(1);});
}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>shutdown(0));
server.listen(Number(process.env.PORT||10000),'0.0.0.0');
