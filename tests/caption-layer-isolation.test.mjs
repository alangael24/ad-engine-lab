import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {wordCaptions} from '../workers/simple-ad-renderer.mjs';
const exec=promisify(execFile);
const words=[{text:'Subtítulos de prueba',start:0,end:4}];
const edl={captions:true,captionGroups:[[0,0]],captionSize:46,captionColor:'white',hook:'Hook sin cambios'};
function layerColors(ass){const styles=new Map(ass.split('\n').filter(s=>s.startsWith('Style:')).map(s=>{const fields=s.slice(6).split(',').map(x=>x.trim());return [fields[0],fields[3]];}));return ass.split('\n').filter(s=>s.startsWith('Dialogue:')).map(s=>{const fields=s.slice(9).split(',').map(x=>x.trim());return {layer:fields[0],color:styles.get(fields[3])};});}
test('subtitle color changes only the caption layer, preserving hook color',()=>{
 const before=layerColors(wordCaptions(edl,words,720,1280)),after=layerColors(wordCaptions({...edl,captionColor:'yellow'},words,720,1280));
 assert.equal(before.find(s=>s.layer==='1').color,after.find(s=>s.layer==='1').color);
 assert.notEqual(before.find(s=>s.layer==='0').color,after.find(s=>s.layer==='0').color);
});
test('actual FFmpeg pixels keep the hook identical while subtitles turn yellow',{skip:!process.env.TEST_MEDIA},async()=>{
 const root=await mkdtemp(join(tmpdir(),'caption-layer-'));try{
  const frames=[];
  for(const color of ['white','yellow']){
   const path=join(root,color+'.ass');await writeFile(path,wordCaptions({...edl,captionColor:color},words,720,1280));
   const {stdout}=await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x203040:size=720x1280:rate=24:duration=1','-vf',`ass=filename='${path}'`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:'buffer',maxBuffer:4*1024*1024});frames.push(stdout);
  }
  assert.deepEqual(frames[0].subarray(0,720*640*3),frames[1].subarray(0,720*640*3));
  assert.notDeepEqual(frames[0].subarray(720*640*3),frames[1].subarray(720*640*3));
 }finally{await rm(root,{recursive:true,force:true});}
});
