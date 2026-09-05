export {getStudio as onRequestGet,postStudio as onRequestPost} from '../../src/studio.js';
export function onRequest(){return new Response(null,{status:405});}
