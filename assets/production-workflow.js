// Versioned production decisions; EDL schema compatibility is kept separately.
export const DEFAULT_PRODUCTION_WORKFLOW='astra-deepseek-v1';
export const PRODUCTION_WORKFLOWS=Object.freeze({
 'astra-deepseek-v1':{director:'gpt-6-astra',editor:'deepseek-flash',reasoning:'low',imageModel:'gpt-image-2'},
 'sol-luna-v1':{director:'gpt-5.6-sol',editor:'gpt-5.6-luna',reasoning:'high',imageModel:'gpt-image-1.5'},
});
export function productionWorkflow(env={}){
 const version=env.PRODUCTION_WORKFLOW_PROFILE||DEFAULT_PRODUCTION_WORKFLOW;
 if(!Object.hasOwn(PRODUCTION_WORKFLOWS,version))throw Error('PRODUCTION_WORKFLOW_CONFIG');
 return {version,...PRODUCTION_WORKFLOWS[version]};
}
export function editorialReviewModelMatches(review){
 const profile=review?.workflowProfile||'sol-luna-v1';
 return Object.hasOwn(PRODUCTION_WORKFLOWS,profile)&&review?.model===PRODUCTION_WORKFLOWS[profile].director;
}
