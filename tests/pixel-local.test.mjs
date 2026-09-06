import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('localhost visits do not load Meta Pixel or enqueue conversion events',async()=>{
  const script=await readFile(new URL('../assets/meta-pixel.js',import.meta.url),'utf8');
  let remoteLoads=0;
  const window={location:{hostname:'127.0.0.1',protocol:'http:'}};
  const document={addEventListener(){},createElement(){remoteLoads++;throw Error('No local pixel');}};
  vm.runInNewContext(script,{window,document});
  window.fbq('track','Purchase',{value:999});
  assert.equal(remoteLoads,0);assert.equal(window._fbq,undefined);
});
