import {tickQwenPod} from './qwen-pod-controller.mjs';
import {tickManagedPod} from './h3-pod-controller.mjs';
// Deploy separately with a minute cron. Runs even when no GPU is online.
export default {
  async scheduled(_event, env, context) {
    context.waitUntil((async () => {
      if (!env.CREATIVE_RUSH_URL?.startsWith('https://') || !env.GENERATION_WORKER_TOKEN) throw new Error('Missing sweeper configuration');
      const response = await fetch(`${env.CREATIVE_RUSH_URL.replace(/\/$/,'')}/api/worker`, {
        method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${env.GENERATION_WORKER_TOKEN}`, 'user-agent':'CreativeRush-Worker/1.0' },
        body:JSON.stringify({ action:'sweep' }), signal:AbortSignal.timeout(25000),
      }).catch(()=>({ok:false}));
      if (!response.ok) console.error('Generation reconciliation failed',response.status||'network');
      for(const [name,tick] of [['h3',tickManagedPod],['qwen',tickQwenPod]]){try{console.log(JSON.stringify({controller:name,result:await tick(env)}));}catch(e){console.error(JSON.stringify({controller:name,error:e.message}));}}
    })());
  },
};
