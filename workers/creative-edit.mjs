// Local creative-flow adapter. No GPU, image generation or speech API calls here.
// The next creative comparison uses the actual sandboxed editor, not finish.py.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {creativeContext} from '../assets/creative-context.js';
import {prepareInputs} from './video-use-worker.mjs';
import {runVideoUse,verifyNarrationCoverage} from './video-use/agent.mjs';
import {processCommand} from './video-use/sandbox.mjs';

export async function finishCreativeProject({root,project,shots,narration,words,reference,strategy,env=process.env,signal,sandboxOptions={},fetchImpl=fetch,run=runVideoUse}){
 if(!strategy?.trim()||!project.data?.scriptDraft?.trim())throw Error('Approved direction and script are required');
 const scenes=project.data.scenes||[],approved=new Set(project.data.creativeMemory?.approvedAssets||[]);
 if(!scenes.length||scenes.length>24||!Array.isArray(words)||!words.length)throw Error('Measured narration and scenes are required');
 if(scenes.some(s=>!approved.has(s.imageAssetId)||!shots.some(t=>t.sceneId===s.id)))throw Error('Every shot needs its approved still and generated clip');
 if((project.data.referenceUrl||project.data.referenceAnalysisId)&&!reference?.path&&!project.referenceEvidence?.length)throw Error('Original reference video is required');
 root=resolve(root);await mkdir(resolve(root,'prepared'),{recursive:true});
 const sources=[],cachedTranscripts={},metadata={};
 async function add(path,id,name,transcript,isReference=false){
  const bytes=await readFile(path),hash=createHash('sha256').update(bytes).digest('hex'),transcriptPath=resolve(root,'prepared',id+'.json');
  await writeFile(transcriptPath,JSON.stringify(transcript));
  cachedTranscripts[id]={sha256:hash,path:transcriptPath};sources.push({id,path,name,reference:isReference});
 }
 for(const [i,s] of scenes.entries()){
  const shot=shots.find(t=>t.sceneId===s.id),id='S'+String(i+1).padStart(2,'0'),duration=s.end-s.start,from=s.narrationStart??s.start;
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(from)||from<0)throw Error('Invalid scene timing');
  const selected=words.filter(w=>w.type==='word'&&w.start>=from-.001&&w.end<=from+duration+.001).map(w=>({...w,start:Math.max(0,w.start-from),end:w.end-from}));
  const out=resolve(root,'prepared',id+'.mp4');
  await processCommand('ffmpeg',['-v','error','-y','-ss',String(shot.sourceStart||0),'-i',resolve(shot.path),'-ss',String(from),'-i',resolve(narration),'-map','0:v:0','-map','1:a:0','-t',String(duration),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac',out],{signal});
  await add(out,id,s.text,{text:selected.map(w=>w.text).join(' '),words:selected});
  metadata[id]={sceneId:s.id,visual:s.visual,motion:s.motion};
 }
 if(reference?.path)await add(resolve(reference.path),'S99','Original style reference',reference.transcript||{text:'',words:[],limitation:'Visual reference only; no verified transcript supplied.'},true);
 const input=await prepareInputs({sources},root,{env,fetchImpl,signal,sandboxOptions,cachedTranscripts});
 for(const [id,data] of Object.entries(metadata))Object.assign(input.sources[id],data);
 const baseline={ranges:Object.entries(input.sources).filter(([,s])=>!s.reference).map(([source,s])=>({source,start:0,end:s.duration}))};
 verifyNarrationCoverage(baseline,input.transcripts,project.data.scriptDraft);
 const memory=creativeContext(project);await writeFile(resolve(root,'creative-context.json'),JSON.stringify(memory,null,2));
 const result=await run({root,mode:'edit',request:'Finish the approved ad. Match the visual reference and project direction. Trim unnecessary silence, choose cuts, overlays and captions according to the approved strategy. Preserve every approved spoken word. Inspect and correct the actual result.',strategy,memory,referenceImages:project.referenceEvidence||[],approvedScript:project.data.scriptDraft,...input,env,fetchImpl,signal,sandboxOptions});
 if(result.status==='succeeded')verifyNarrationCoverage(result.edl,input.transcripts,project.data.scriptDraft);
 await writeFile(resolve(root,'creative-edit-result.json'),JSON.stringify(result,null,2));
 return result;
}
