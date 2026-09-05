export {postStoreImport as onRequestPost} from '../../src/store-import.js';
export function onRequest(){return new Response(null,{status:405});}
