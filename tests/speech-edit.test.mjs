import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEDL,editFingerprint} from '../workers/video-use/agent.mjs';
const source={S01:{duration:3,width:720,height:1280,fps:30}};
const edl={ranges:[{source:'S01',start:0,end:3}],subtitles:'master.ass',dynamic_captions:{highlight:'#ffdf00'},output:{width:720,height:1280,fps:30}};
test('dynamic caption configuration rejects unsafe geometry and conflicting legacy styles',()=>{
 assert.equal(validateEDL(edl,source,{}).total_duration_s,3);
 for(const value of [{font_size:1},{font_size:500},{max_words:0},{max_words:2.3},{bottom_fraction:NaN},{highlight:'red'},{evil:'code'}])assert.throws(()=>validateEDL({...edl,dynamic_captions:value},source,{}));
 assert.throws(()=>validateEDL({...edl,subtitles:null},source,{}));
 assert.throws(()=>validateEDL({...edl,subtitle_style:'FontSize=5'},source,{}));
});
test('changing only dynamic caption appearance is a real edit and invalidates cached render',async()=>{
 const a=await editFingerprint(edl,()=>{});
 const b=await editFingerprint({...edl,dynamic_captions:{highlight:'#00ff00'}},()=>{});
 assert.notEqual(a,b);
 assert.equal(a,await editFingerprint(structuredClone(edl),()=>{}));
});
