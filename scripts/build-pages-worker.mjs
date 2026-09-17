import {readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('wrangler/package.json'))('esbuild');
export async function buildPagesWorker(root,output){
 const folder=resolve(root,'functions'),files=[];
 async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())await walk(p);else if(e.name.endsWith('.js'))files.push(p);}}
 await walk(folder);files.sort();
 const imports=[`import {pagesDispatcher} from ${JSON.stringify(resolve(root,'src/pages-dispatch.js'))};`],entries=[];
 for(const [i,file] of files.entries()){
  const name=relative(folder,file).replaceAll('\\','/');
  // Do not silently bypass newly introduced middleware or unsupported patterns.
  if(name.includes('_middleware')||(name.includes('[')&&name!=='api/generations/[id].js'))throw Error('Unsupported Pages route: '+name);
  const route='/'+name.replace(/\.js$/,'').replace(/\/index$/,'');
  imports.push(`import * as route${i} from ${JSON.stringify(file)};`);entries.push(`${JSON.stringify(route)}:route${i}`);
 }
 const entry=resolve(root,'.wrangler/static-pages-entry.mjs');await mkdir(resolve(root,'.wrangler'),{recursive:true});
 await writeFile(entry,imports.join('\n')+'\nexport default pagesDispatcher({'+entries.join(',')+'});\n');
 await build({entryPoints:[entry],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:resolve(output,'_worker.js'),external:['node:*','cloudflare:*'],logLevel:'warning'});
}
