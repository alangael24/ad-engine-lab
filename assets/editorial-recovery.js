// Repeated identical memory entries are retry bookkeeping, not new creative
// direction. Preserve every distinct instruction and all other project fields.
export function editorialRecoveryProject(project){
 const result=structuredClone(project),m=result.data?.creativeMemory;
 if(m)for(const key of ['decisions','preferences','rejections','approvedAssets'])if(Array.isArray(m[key]))m[key]=[...new Set(m[key])];
 return result;
}
