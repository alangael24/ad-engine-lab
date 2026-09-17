export const CONTENT_KINDS={story:'Historia',comedy:'Comedia',explainer:'Explicación',educational:'Educativo',other:'Libre'};
export function creatorBrief(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('STUDIO_INVALID');
 const kind=raw.kind??'other',duration=raw.targetDuration??30;
 if(!Object.hasOwn(CONTENT_KINDS,kind)||!Number.isInteger(duration)||duration<10||duration>120)throw Error('STUDIO_INVALID');
 return {kind,targetDuration:duration};
}
export function creatorRequest(text,{mode='idea',kind='other',targetDuration=30,aspectRatio='9:16',creative={format:'auto',look:'auto'},referenceUrl='',characterAssetIds=[]}={}){
 const idea=text.trim(),brief=creatorBrief({kind,targetDuration});
 if(!idea||idea.length>3000||!['idea','script'].includes(mode))throw Error('STUDIO_INVALID');
 return {title:idea.slice(0,100),idea,creatorBrief:brief,scriptDraft:mode==='script'?idea:'',brandId:null,creative,referenceUrl,referenceNotes:'',aspectRatio,scenes:[],narrationAssetId:null,timingConfirmed:false,...(characterAssetIds.length?{creativeMemory:{characterAssetIds}}:{})};
}
