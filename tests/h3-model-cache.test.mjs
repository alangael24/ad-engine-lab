import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {H3Adapter} from '../workers/h3-adapter.mjs';

const manifest=JSON.parse(readFileSync(new URL('../workers/serverless/model-manifest.json',import.meta.url),'utf8'));
test('compact cache covers every production graph model without changing generation settings',async()=>{
 const adapter=new H3Adapter('http://comfy.test',{fetchImpl:async url=>url.endsWith('/upload/image')
  ?Response.json({name:'reference.png'}):new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}})});
 for(const referenceUrl of [null,'https://storage.test/ref']){
  const {prompt:graph}=await adapter.build({prompt:'One continuous shot of falling water',durationSeconds:5,resolution:'720p',aspectRatio:'9:16',referenceUrl});
  const files=[];
  const fields={unet_name:'diffusion_models',clip_name:'text_encoders',vae_name:'vae',lora_name:'loras'};
  for(const node of Object.values(graph))for(const [field,folder] of Object.entries(fields))
   if(node.inputs?.[field])files.push(`${folder}/${node.inputs[field]}`);
  assert.deepEqual(files.sort(),Object.keys(manifest.files).sort());
  assert.equal(graph['9'].inputs.steps,8);
 }
 assert.equal(Object.values(manifest.files).reduce((sum,f)=>sum+f.bytes,0),43821523663);
});

const handler=fileURLToPath(new URL('../workers/serverless/handler.py',import.meta.url));
function pythonScenario(body){
 execFileSync('python3',['-c',`
import importlib.util, pathlib, tempfile, os
s=importlib.util.spec_from_file_location('h3_handler', ${JSON.stringify(handler)})
h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
# Tiny stand-in weights exercise filesystem behavior without GPU or downloads.
h.MODEL_SIZES={name:i+1 for i,name in enumerate(h.MODEL_SIZES)}
tmp=tempfile.TemporaryDirectory();base=pathlib.Path(tmp.name)
root=base/'comfy';cache=base/'cache';repo='Comfy-Org/MiniMax-H3'
a='a'*40;b='b'*40
def snapshot(rev, names=None, model=repo):
 p=cache/('models--'+model.replace('/','--'))/'snapshots'/rev
 for name in (names if names is not None else h.MODEL_SIZES):
  f=p/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(b'x'*h.MODEL_SIZES[name])
 return p
def fails(code, **kw):
 try:h.link_models(root,cache,**kw)
 except RuntimeError as e:assert str(e)==code, str(e)
 else:raise AssertionError('expected failure')
${body}
`],{env:{...process.env,H3_MODEL_REPO:manifest.sourceRepo,H3_MODEL_REVISION:'',PYTHONDONTWRITEBYTECODE:'1'},stdio:'pipe'});
}
test('worker starts with only the four production weights present',()=>pythonScenario(`
p=snapshot(a)
h.link_models(root,cache)
assert len(list((root/'models').rglob('*.safetensors')))==4
for name in h.MODEL_SIZES:assert (root/'models'/name).resolve()==(p/name).resolve()
`));
test('partial snapshots are never mixed to make a complete cache',()=>pythonScenario(`
names=list(h.MODEL_SIZES);snapshot(a,names[:2]);snapshot(b,names[2:])
fails('H3_CACHE_MISSING')
assert not root.exists()
`));
test('configured compact repository and immutable revision select the correct weights',()=>pythonScenario(`
p=snapshot(a,model='example/h3-production');snapshot(b,model='example/h3-production')
h.link_models(root,cache,repo='example/h3-production',revision=a)
for name in h.MODEL_SIZES:assert (root/'models'/name).resolve()==(p/name).resolve()
`));
test('cached main revision is authoritative and cannot fall back to old complete weights',()=>pythonScenario(`
snapshot(a);snapshot(b,list(h.MODEL_SIZES)[:2])
ref=cache/'models--Comfy-Org--MiniMax-H3'/'refs'/'main';ref.parent.mkdir();ref.write_text(b)
fails('H3_CACHE_MISSING')
ref.write_text(a);h.link_models(root,cache)
`));
test('ambiguous revisions and path traversal fail without downloading models',()=>pythonScenario(`
snapshot(a);snapshot(b)
fails('H3_CACHE_AMBIGUOUS_REVISION')
fails('H3_CACHE_INVALID_REPO',repo='../outside')
fails('H3_CACHE_INVALID_REVISION',revision='../../outside')
`));
test('wrong-sized required weight is rejected before linking anything',()=>pythonScenario(`
p=snapshot(a);(p/next(iter(h.MODEL_SIZES))).write_bytes(b'corrupt')
fails('H3_CACHE_MISSING')
assert not root.exists()
`));
