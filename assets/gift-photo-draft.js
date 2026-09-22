// Keep selected photos across the form/checkout round trip, scoped to this tab.
const DB='creativerush-gift-photo-drafts',KEY='creativerush-gift-photo-key';
let connection;
function key(scope){if(scope)return 'order:'+scope;let k=sessionStorage.getItem(KEY);if(!k){k=crypto.randomUUID();sessionStorage.setItem(KEY,k);}return k;}
function database(){return connection??=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveGiftPhotos(photos,scope){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({at:Date.now(),photos:photos.map(({file,label})=>({file,label}))},key(scope));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
export async function loadGiftPhotos(scope){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readonly'),r=tx.objectStore('drafts').get(key(scope));r.onsuccess=()=>resolve(r.result&&Date.now()-r.result.at<86400000?r.result.photos:[]);r.onerror=()=>reject(r.error);});}
