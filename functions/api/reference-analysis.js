export {getReferenceAnalysis as onRequestGet,postReferenceAnalysis as onRequestPost} from '../../src/reference-analysis.js';
export function onRequest(){return new Response(null,{status:405});}
