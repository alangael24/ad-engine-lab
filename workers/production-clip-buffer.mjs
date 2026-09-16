export const CLIP_BUFFER_CAPACITY=3;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Three outstanding jobs match the existing per-user admission limit: one
// executing and up to two waiting. No concurrent project writes or orphaned
// promises; the single GPU worker remains responsible for serial execution.
export async function runClipBuffer(entries,{prepare,submit,inspect,select,check=()=>{},pollMs=3000,capacity=CLIP_BUFFER_CAPACITY,yieldAfterMs=30000,now=()=>Date.now()}){
 if(!Number.isInteger(capacity)||capacity<1||capacity>3)throw Error('PRODUCTION_INVALID');
 const pending=[];let next=0,waitingSince=null;
 const assertHealthy=current=>{
  for(const {version} of pending){
   const v=current.versions.find(v=>v.id===version.id);
   if(v?.status==='failed'||v?.status==='canceled')throw Error('PRODUCTION_CLIP_FAILED');
  }
 };
 while(next<entries.length||pending.length){
  // Preparing the next prompt overlaps the GPU's previous job. Once prepared,
  // enqueue immediately; never wait for the preceding clip before refilling.
  while(next<entries.length&&pending.length<capacity){
   check();if(pending.length)assertHealthy(await inspect());
   const entry=entries[next],data=await prepare(entry);
   check();if(pending.length)assertHealthy(await inspect());
   const version=await submit(entry,data);
   pending.push({entry,version});next++;
  }
  check();const current=await inspect();assertHealthy(current);
  // Selection stays in script order even if recovered jobs finished out of order.
  let selected=false;
  while(pending.length&&current.versions.find(v=>v.id===pending[0].version.id)?.status==='succeeded'){
   check();const head=pending[0];await select(head.entry,head.version);
   pending.shift();selected=true;
  }
  if(pending.length&&!selected){
   if(current.compute?.waiting){waitingSince??=now();if(now()-waitingSince>=yieldAfterMs)throw Error('PRODUCTION_GPU_WAIT');}
   else waitingSince=null;
   await sleep(pollMs);
  }
 }
}
