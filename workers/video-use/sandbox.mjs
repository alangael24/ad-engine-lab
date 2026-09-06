import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,realpath,chmod} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const vendor=resolve(dirname(fileURLToPath(import.meta.url)),'vendor');
export async function safePath(root,path){
 const lexical=resolve(root),base=await realpath(root),candidate=resolve(base,path.startsWith(lexical+'/')?path.slice(lexical.length+1):path);
 if(candidate!==base&&!candidate.startsWith(base+'/'))throw Error('Path outside project');
 // Check existing ancestors too: generated symlinks cannot escape the workspace.
 let parent=candidate;while(true){try{const r=await realpath(parent);if(r!==base&&!r.startsWith(base+'/'))throw Error('Path outside project');break;}catch(e){if(e.code!=='ENOENT')throw e;parent=dirname(parent);}}
 return candidate;
}
export function processCommand(bin,args,{cwd,env,signal,timeout=180000}={}){
 return new Promise((yes,no)=>{
  const p=spawn(bin,args,{cwd,env,signal,detached:true,stdio:['ignore','pipe','pipe']});let out='',err='';
  const kill=()=>{try{process.kill(-p.pid,'SIGKILL');}catch{}};
  const timer=setTimeout(kill,timeout);signal?.addEventListener('abort',kill,{once:true});
  p.stdout.on('data',x=>out=(out+x).slice(-20000));p.stderr.on('data',x=>err=(err+x).slice(-10000));
  p.on('error',no);p.on('close',(code,exitSignal)=>{clearTimeout(timer);signal?.removeEventListener('abort',kill);kill();code===0?yes(out):no(Error(`Command failed (${code}, ${exitSignal}): ${err.slice(-2000)}`));});
 });
}
export async function createSandbox(root,{mode=process.platform==='darwin'?'macos':'docker',python=process.env.VIDEO_USE_PYTHON||'python3',signal}={}){
 root=await realpath(root);const edit=resolve(root,'edit');await mkdir(edit,{recursive:true});await mkdir(resolve(edit,'tmp'),{recursive:true});await chmod(resolve(edit,'tmp'),0o777);
 const cleanEnv={PATH:process.env.PATH||'/usr/bin:/bin',HOME:edit,TMPDIR:resolve(edit,'tmp'),PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',MPLCONFIGDIR:resolve(edit,'tmp')};
 if(mode==='macos'){
  if(process.platform!=='darwin'||!python.startsWith('/'))throw Error('Configure an absolute VIDEO_USE_PYTHON');
  const interpreter=await realpath(python);const pythonRoot=dirname(dirname(interpreter));
  const quote=s=>JSON.stringify(s);
  const reads=['/System','/usr','/bin','/sbin','/Library','/private/var/db','/private/preboot','/private/var/run','/dev',root,vendor,pythonRoot,dirname(pythonRoot),dirname(dirname(python)),...cleanEnv.PATH.split(':').filter(p=>p.startsWith('/'))];
  const profile=`(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup)(allow file-read-metadata)(allow file-read* (literal "/"))(allow file-read* ${reads.map(p=>`(subpath ${quote(p)})`).join(' ')}) (allow file-write* (subpath ${quote(edit)})(literal "/dev/null"))`;
  const run=(args,timeout)=>processCommand('/usr/bin/sandbox-exec',['-p',profile,...args],{cwd:root,env:cleanEnv,signal,timeout});
  return {root,edit,vendor,python,run};
 }
 if(mode!=='docker')throw Error('An isolated runner is required');
 const run=async(args,timeout)=>{const name='video-use-'+randomUUID();try{return await processCommand('docker',['run','--name',name,'--rm','--init','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=4g','--cpus=2','--user=1000:1000','--tmpfs=/tmp:rw,noexec,size=256m','-v',`${root}:/job:ro`,'-v',`${edit}:/job/edit:rw`,'-w','/job','-e','HOME=/job/edit','-e','PYTHONDONTWRITEBYTECODE=1','-e','MPLCONFIGDIR=/job/edit/tmp',process.env.VIDEO_USE_IMAGE||'creativerush-video-use:1',...args],{signal,timeout});}finally{await processCommand('docker',['rm','-f',name],{timeout:15000}).catch(()=>{});}};
 return {root:'/job',edit:'/job/edit',vendor:'/opt/video-use',python:'python',run};
}
