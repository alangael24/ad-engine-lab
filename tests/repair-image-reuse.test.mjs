import test from 'node:test';import assert from 'node:assert/strict';
import {canReuseRepairImages as reuse} from '../src/repair-image-reuse.js';
const a=[{id:'s1',imageAssetId:'a'},{id:'s2',imageAssetId:'b'}],issues=[{sceneId:'s1',action:'replace_clip'}];
test('clip motion repair retains identical approved image collection',()=>assert.equal(reuse(a,a.map(s=>({...s,motion:'new motion'})),issues),true));
test('changed images, scene order, image repairs and unknown scene cannot skip review',()=>{
 assert.equal(reuse(a,[{...a[0],imageAssetId:'new'},a[1]],issues),false);
 assert.equal(reuse(a,[a[1],a[0]],issues),false);
 assert.equal(reuse(a,a,[{sceneId:'s1',action:'replace_image'}]),false);
 assert.equal(reuse(a,a,[{sceneId:'other',action:'replace_clip'}]),false);
 assert.equal(reuse(a,a,[]),false);
});
