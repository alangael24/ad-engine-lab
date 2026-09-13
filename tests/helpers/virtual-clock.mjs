// Deterministic time; no wall-clock waits and no paid provider calls.
export function virtualClock(start=Date.parse('2026-09-13T12:00:00Z')){
  let now=start,nextId=0;
  const timers=new Map();
  return {
    now:()=>now,
    async sleep(ms){
      const target=now+ms;
      while(true){
        const next=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];
        if(!next||next[1].due>target)break;
        now=next[1].due;next[1].due+=next[1].ms;await next[1].fn();
      }
      now=target;
    },
    setInterval(fn,ms){const id=++nextId;timers.set(id,{fn,ms,due:now+ms});return id;},
    clearInterval:id=>timers.delete(id),
    get timerCount(){return timers.size;},
  };
}
