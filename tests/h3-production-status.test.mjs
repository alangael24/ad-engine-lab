import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clipProgress,productionClipIds} from '../src/h3-production-status.js';
test('customer states describe actual queue, preparation, generation and reassignment',()=>{
 assert.equal(clipProgress([{status:'queued'}]).state,'waiting_capacity');
 assert.equal(clipProgress([{status:'queued',managed_run_id:'r'}]).state,'preparing_generator');
 assert.equal(clipProgress([{status:'running',provider_phase:'reconciling'}]).state,'reassigning');
 const result=clipProgress([{status:'succeeded'},{status:'running',provider_phase:'generating'}],11);
 assert.equal(result.complete,1);assert.equal(result.total,11);assert.equal(result.waiting,false);
});
test('progress includes only submitted clip checkpoints, excluding prompts and other productions',()=>{
 assert.deepEqual(productionClipIds({steps:{'clip-0':{status:'done',result:{id:'v'}},'clip-0-prompt':{status:'done',result:{id:'wrong'}},'repair-clip-0-1':{status:'done',result:{id:'repair'}}}}),['v','repair']);
});
