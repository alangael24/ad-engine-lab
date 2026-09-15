import {randomUUID} from 'node:crypto';

// Old and new instances overlap during rolling deploys. A shared configured
// worker ID would let both reclaim the same live lease and double-dispatch work.
export function runtimeWorkerEnvironment(env,nonce=randomUUID()){
 const suffix=nonce.replaceAll('-','');
 if(!/^[a-f0-9]{32}$/.test(suffix))throw Error('WORKER_IDENTITY_INVALID');
 const next={...env};
 for(const key of ['PRODUCTION_WORKER_ID','STUDIO_WORKER_ID']){
  if(!/^[\w-]{1,80}$/.test(env[key]||''))throw Error('WORKER_IDENTITY_INVALID');
  next[key]=env[key].slice(0,47)+'-'+suffix;
 }
 return next;
}
