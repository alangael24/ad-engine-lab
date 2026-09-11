import {readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {productionWorkflow} from '../assets/production-workflow.js';
const root=fileURLToPath(new URL('../',import.meta.url)),manifest=resolve(root,'docs/production-workflow-lock.json');
async function files(dir){const out=[];for(const e of await readdir(resolve(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(/\.(?:js|mjs|py|json|toml)$/.test(e.name)||e.name==='Dockerfile')out.push(p);}return out;}
const paths=[...new Set((await Promise.all(['assets','src','workers','functions/api'].map(files))).flat().concat(['scripts/freeze-production-workflow.mjs','scripts/build-static.mjs','package.json','package-lock.json','wrangler.toml']))].sort();
const hashes={};for(const path of paths)hashes[path]=createHash('sha256').update(await readFile(resolve(root,path))).digest('hex');
const body={version:1,profile:productionWorkflow(),files:hashes};
if(process.argv.includes('--check')){
 const expected=JSON.parse(await readFile(manifest,'utf8'));
 if(JSON.stringify(expected)!==JSON.stringify(body)){console.error('Production code/prompt freeze changed. Re-freeze intentionally before a new benchmark.');process.exitCode=1;}
 else console.log(`Production workflow freeze verified: ${paths.length} files, ${body.profile.version}`);
}else{await writeFile(manifest,JSON.stringify(body,null,2)+'\n');console.log('Frozen '+relative(root,manifest)+' ('+paths.length+' files)');}
