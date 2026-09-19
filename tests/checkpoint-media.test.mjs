import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointMediaUrls} from '../src/checkpoint-media.js';
test('new checkpoint can upload before object exists; existing checkpoint can download',async()=>{
 let exists=false;
 const storage={createSignedUploadUrl:async()=>({data:{signedUrl:'upload'}}),createSignedUrl:async()=>exists?{data:{signedUrl:'download'}}:{error:{message:'Object not found',status:400}}};
 assert.deepEqual(await checkpointMediaUrls(storage,'p'),{uploadUrl:'upload'});
 exists=true;assert.deepEqual(await checkpointMediaUrls(storage,'p'),{uploadUrl:'upload',downloadUrl:'download'});
});
test('checkpoint signing does not swallow service or auth errors',async()=>{
 for(const error of [{message:'Unauthorized'},{message:'Service unavailable'}]){
  await assert.rejects(checkpointMediaUrls({createSignedUploadUrl:async()=>({data:{signedUrl:'upload'}}),createSignedUrl:async()=>({error})},'p'),e=>e===error);
 }
});
