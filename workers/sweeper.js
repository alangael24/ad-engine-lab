// Deploy separately with a minute cron. Runs even when no GPU is online.
export default {
  async scheduled(_event, env, context) {
    context.waitUntil((async () => {
      if (!env.CREATIVE_RUSH_URL?.startsWith('https://') || !env.GENERATION_WORKER_TOKEN) throw new Error('Missing sweeper configuration');
      const response = await fetch(`${env.CREATIVE_RUSH_URL.replace(/\/$/,'')}/api/worker`, {
        method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${env.GENERATION_WORKER_TOKEN}` },
        body:JSON.stringify({ action:'sweep' }), signal:AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error('Generation reconciliation failed');
    })());
  },
};
