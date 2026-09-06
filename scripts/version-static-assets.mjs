import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
export function versionReferences(source,version,html=false){
 const suffix=path=>/^https?:|^\/\/|^data:/.test(path)?path:path.replace(/\?v=[a-f0-9]+$/,'')+'?v='+version;
 if(html)return source.replace(/((?:src|href)=["'])((?:\/assets\/|\/brand-override)[^"'?]+\.(?:js|css))(["'])/g,(_m,a,p,b)=>a+suffix(p)+b);
 return source.replace(/((?:\bfrom\s*|\bimport\s*\(?\s*)["'])((?:\.\.?\/|\/assets\/)[^"'?]+\.js)(["'])/g,(_m,a,p,b)=>a+suffix(p)+b);
}
export async function versionStaticAssets(root){
 const files=[];
 async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(['videos','_next'].includes(e.name))continue;const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.(js|css|html)$/.test(e.name))files.push(p);}}
 await walk(root);files.sort();const contents=await Promise.all(files.map(p=>readFile(p,'utf8'))),hash=createHash('sha256');
 files.forEach((p,i)=>hash.update(relative(root,p)).update(contents[i]));const version=hash.digest('hex').slice(0,12);
 await Promise.all(files.map((p,i)=>p.endsWith('.css')?null:writeFile(p,versionReferences(contents[i],version,p.endsWith('.html')))));
 // Unversioned entry pages must revalidate so they reference the current modules.
 await writeFile(join(root,'_headers'),'/*\n  Cache-Control: public, max-age=0, must-revalidate\n');
 return version;
}
