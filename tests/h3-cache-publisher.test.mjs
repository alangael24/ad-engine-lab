import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/publish-h3-cache.py',import.meta.url));

function scenario(body){execFileSync('python3',['-c',`
import importlib.util, json
from types import SimpleNamespace as Obj
s=importlib.util.spec_from_file_location('publisher',${JSON.stringify(script)})
p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
m=json.loads(p.MANIFEST_PATH.read_text());meta={n:b'fixture' for n in p.METADATA_FILES if n!='.gitattributes'}
def weights():return [Obj(rfilename=n,size=f['bytes'],lfs=Obj(sha256=f['sha256'])) for n,f in m['files'].items()]
def extra(name):return Obj(rfilename=name,size=1,lfs=None)
class Missing(Exception):pass
class API:
 def __init__(self,target=None):self.source=Obj(siblings=weights(),sha=m['sourceRevision']);self.target=target;self.commits=[];self.creates=[]
 def model_info(self,repo,**kwargs):
  if repo==m['sourceRepo']:return self.source
  if self.target is None:raise Missing()
  return self.target
 def create_repo(self,**kwargs):self.creates.append(kwargs);self.target=Obj(siblings=[extra('.gitattributes')],private=True,sha='initial')
 def create_commit(self,**kwargs):
  self.commits.append(kwargs);self.target=Obj(siblings=weights()+[extra(n) for n in meta],private=True,sha='completed');return Obj(oid='completed')
def publish(api,repo='owner/creativerush-h3-fl2v-turbo8'):
 return p.publish(api,m,repo,'owner',meta,lambda **kw:Obj(kind='copy',**kw),lambda **kw:Obj(kind='add',**kw),Missing)
def fails(api,code,repo='owner/creativerush-h3-fl2v-turbo8'):
 try:publish(api,repo)
 except ValueError as e:assert str(e).startswith(code),str(e)
 else:raise AssertionError('expected failure')
 assert not api.commits
${body}
`],{stdio:'pipe',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});}

test('publisher copies only the four pinned weights server-side into a private repo',()=>scenario(`
a=API();out=publish(a)
assert a.creates[0]['private'] is True
c=a.commits[0];assert c['parent_commit']=='initial'
copies=[o for o in c['operations'] if o.kind=='copy']
assert {o.path_in_repo for o in copies}==set(m['files'])
assert all(o.src_repo_id==m['sourceRepo'] and o.src_revision==m['sourceRevision'] for o in copies)
assert {o.path_in_repo for o in c['operations'] if o.kind=='add'}==set(meta)
assert out.sha=='completed'
`));
test('changed upstream hash stops before repository creation',()=>scenario(`
a=API();a.source.siblings[0].lfs.sha256='wrong'
fails(a,'H3_CACHE_HASH_MISMATCH');assert not a.creates
`));
test('foreign account and public destination cannot be modified',()=>scenario(`
a=API();fails(a,'H3_CACHE_DESTINATION_NOT_OWNED','someone-else/weights');assert not a.creates
a=API(Obj(private=False,siblings=[],sha='initial'));fails(a,'H3_CACHE_DESTINATION_MUST_BE_PRIVATE')
`));
test('existing unrelated files are never deleted or overwritten',()=>scenario(`
a=API(Obj(private=True,siblings=weights()+[extra('user-document.txt')],sha='existing'))
fails(a,'H3_CACHE_UNEXPECTED_FILES');assert not a.creates
`));
test('lost commit acknowledgement is recovered from verified destination without recopy',()=>scenario(`
a=API();publish(a)
out=publish(a);assert out.sha=='completed';assert len(a.commits)==1;assert len(a.creates)==1
`));
test('existing weights with incomplete license metadata are not reported as published',()=>scenario(`
a=API(Obj(private=True,siblings=weights(),sha='existing'))
fails(a,'H3_CACHE_EXISTING_METADATA_INCOMPLETE')
`));
