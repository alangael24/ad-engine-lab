import {call} from './database.mjs';
import {alignScenes} from '../../assets/production-model.js';

// Test setup only: import the user's existing media without regenerating it.
export async function seedExistingAd(db,f){
 const plan={continuity:'Same blue-gray CGI and chrome Nebula product.',scenes:f.catalog.map(c=>({...c,id:crypto.randomUUID(),motion:'Original motion'}))};
 const audio=await f.providers.speech(f.project);
 const scenes=alignScenes(plan,audio.alignment,audio.duration).map(s=>({...s,imageAssetId:f.catalog.find(c=>c.sourceKey===s.sourceKey).imageAssetId}));
 const write=(action,data)=>call(db,'studio_write',[f.owner.id,action,f.project.id,JSON.stringify(data),f.project.revision]);
 f.project=await write('save_project',{...f.project.data,narrationAssetId:audio.assetId,timingConfirmed:true,scenes});
 for(const s of scenes){const v=await write('version',{requestId:crypto.randomUUID(),sceneId:s.id,assetId:f.catalog.find(c=>c.sourceKey===s.sourceKey).clipAssetId,instruction:'Existing test media',prompt:s.visual});f.project=await write('select_version',{versionId:v.id});}
 return f;
}
