"""Outbound-only Qwen worker. No public port, shell API or customer credentials."""
import base64, gc, hashlib, io, json, os, pathlib, sys, threading, time, urllib.request, urllib.error
from datetime import datetime
ROOT = pathlib.Path('/workspace/qwen-results'); ROOT.mkdir(parents=True, exist_ok=True)
CONFIG = json.loads(pathlib.Path(__file__).with_name('config.json').read_text())
ORIGIN = os.environ['CREATIVE_RUSH_URL'].rstrip('/')
TOKEN = os.environ['GENERATION_WORKER_TOKEN']; RUN = os.environ['QWEN_RUN_ID']
DEADLINE = datetime.fromisoformat(os.environ['QWEN_DEADLINE'].replace('Z','+00:00')).timestamp()
if not ORIGIN.startswith('https://'): raise RuntimeError('QWEN_HTTPS_REQUIRED')
STOP = threading.Event()
def api(action, **data):
    body = json.dumps({'action':action, 'data':{'runId':RUN, **data}}).encode()
    req = urllib.request.Request(ORIGIN+'/api/qwen-image-worker', data=body, headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json','User-Agent':'CreativeRush-Worker/1.0'})
    with urllib.request.urlopen(req, timeout=45) as response: return json.load(response)
def log(event, **data): print(json.dumps({'event':event, **data}), flush=True)
def heartbeat():
    while not STOP.wait(25):
        try: api('progress')
        except Exception: log('heartbeat_unconfirmed')
        if time.time() >= DEADLINE: os._exit(2)
def persist(path, obj):
    tmp = path.with_suffix('.tmp'); tmp.write_text(json.dumps(obj)); tmp.replace(path)
def image_from_url(url):
    # These signed URLs are resolved from owned assets by the server, never by an LLM.
    if not url.startswith('https://'): raise ValueError('QWEN_REFERENCE_HTTPS')
    with urllib.request.urlopen(url, timeout=60) as r: raw=r.read(6291457)
    if len(raw)>6291456: raise ValueError('QWEN_REFERENCE_SIZE')
    return Image.open(io.BytesIO(raw)).convert('RGB')
try:
    api('progress'); threading.Thread(target=heartbeat, daemon=True).start()
    import torch
    from PIL import Image
    from huggingface_hub import snapshot_download
    from diffusers import QwenImage21Pipeline
    from transformers import AutoProcessor, AutoModelForImageTextToText
    sys.path.insert(0,str(pathlib.Path(__file__).with_name('official')))
    import pe_core as core
    from run_transformers import rewrite
    if '5090' not in torch.cuda.get_device_name(0): raise ValueError('QWEN_GPU_MISMATCH')
    image_path=snapshot_download(CONFIG['imageModel'], revision=CONFIG['imageRevision'], max_workers=5)
    rewrite_path=snapshot_download(CONFIG['rewriteModel'], revision=CONFIG['rewriteRevision'], max_workers=5)
    log('models_downloaded')
    pipe=QwenImage21Pipeline.from_pretrained(image_path,torch_dtype=torch.bfloat16)
    pipe.enable_model_cpu_offload()
    processor=AutoProcessor.from_pretrained(rewrite_path)
    rewriter=AutoModelForImageTextToText.from_pretrained(rewrite_path,dtype=torch.bfloat16,low_cpu_mem_usage=True).eval()
    system=core.load_system_prompt(None,rewrite_path); profile=core.get_profile('edit')
    api('progress',ready=True); log('ready',version=CONFIG['version'])
    while time.time()<DEADLINE:
        try: job=api('claim')
        except Exception: time.sleep(5); continue
        if not job: time.sleep(3); continue
        jid=job['id']; token=job['claim_token']; path=ROOT/(jid+'.png'); recpath=ROOT/(jid+'.json'); rewritefile=ROOT/(jid+'-rewrite.json')
        try:
            request=job['request']
            if request['version']!=CONFIG['version']: raise ValueError('QWEN_VERSION_MISMATCH')
            if path.exists() and recpath.exists():
                receipt=json.loads(recpath.read_text())
                if receipt['fingerprint']!=job['fingerprint']: raise ValueError('QWEN_CHECKPOINT_CONFLICT')
            else:
                refs=[image_from_url(u) for u in job['referenceUrls']]
                if request.get('filmstrip'): refs.append(Image.open(io.BytesIO(base64.b64decode(request['filmstrip'].split(',',1)[1]))).convert('RGB'))
                prompt=request['prompt']; rewrite_seconds=0
                if rewritefile.exists():
                    rewritten=json.loads(rewritefile.read_text())
                    if rewritten['fingerprint']!=job['fingerprint']: raise ValueError('QWEN_CHECKPOINT_CONFLICT')
                    prompt=rewritten['prompt']; rewrite_seconds=rewritten['seconds']
                elif refs:
                    for component in pipe.components.values():
                        if isinstance(component,torch.nn.Module): component.to('cpu')
                    torch.cuda.empty_cache(); t=time.monotonic(); rewriter.to('cuda')
                    resized=[]
                    for im in refs:
                        im=im.copy()
                        if im.width*im.height>profile.image_max_pixels:
                            scale=(profile.image_max_pixels/(im.width*im.height))**.5
                            im=im.resize((max(1,int(im.width*scale)),max(1,int(im.height*scale))),Image.LANCZOS)
                        resized.append(im)
                    thinking,answer=rewrite(rewriter,processor,core.build_messages(system,prompt,resized),max_new_tokens=profile.max_new_tokens,temperature=profile.temperature,top_p=profile.top_p,top_k=profile.top_k,presence_penalty=profile.presence_penalty,seed=42)
                    record=core.build_record({'id':jid,'prompt':prompt},thinking,answer,profile)
                    if not record.get('parse_ok') or not record.get('positive_prompt'): raise ValueError('QWEN_REWRITE_INVALID')
                    prompt=record['positive_prompt']; rewriter.to('cpu'); gc.collect(); torch.cuda.empty_cache()
                    rewrite_seconds=time.monotonic()-t
                    persist(rewritefile,{'fingerprint':job['fingerprint'],'prompt':prompt,'seconds':rewrite_seconds})
                width,height=map(int,request['size'].split('x')); t=time.monotonic()
                result=pipe(prompt=prompt,image=refs or None,width=width,height=height,num_inference_steps=CONFIG['steps'],true_cfg_scale=CONFIG['cfg'],generator=torch.Generator('cuda').manual_seed(CONFIG['seed']),use_kv_cache=CONFIG['kvCache']).images[0]
                torch.cuda.synchronize(); seconds=time.monotonic()-t
                temporary=path.with_suffix('.tmp'); result.save(temporary,format='PNG'); temporary.replace(path)
                receipt={'version':CONFIG['version'],'fingerprint':job['fingerprint'],'model':CONFIG['imageModel'],'revision':CONFIG['imageRevision'],'rewriteSeconds':rewrite_seconds,'generationSeconds':seconds,'size':[width,height],'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'rewriterUsed':bool(refs)}
                persist(recpath,receipt)
            # Keep generated bytes even if storage/API temporarily fail.
            done=False
            for attempt in range(6):
                try:
                    upload=api('upload',id=jid,claimToken=token)
                    req=urllib.request.Request(upload['uploadUrl'],data=path.read_bytes(),method='PUT',headers={'Content-Type':'image/png','x-upsert':'false'})
                    try:
                        with urllib.request.urlopen(req,timeout=120): pass
                    except urllib.error.HTTPError as e:
                        if e.code not in (400,409): raise
                    api('finish',id=jid,claimToken=token,receipt=receipt); done=True; break
                except Exception: time.sleep(min(5*(attempt+1),25))
            if not done:
                log('upload_pending',job=jid); time.sleep(5); continue
            log('image_complete',job=jid,**receipt)
        except Exception as e:
            # Material/inference errors need an explicit new production attempt;
            # there is never a hidden paid regeneration of the same request.
            code=str(e) if str(e).startswith('QWEN_') else 'QWEN_INFERENCE_FAILED'
            log('image_failed',job=jid,error=type(e).__name__)
            try: api('fail',id=jid,claimToken=token,error=code)
            except Exception: pass
            break
except Exception as e:
    log('boot_failed',error=type(e).__name__)
    try: api('progress',error='QWEN_BOOT_FAILED')
    except Exception: pass
finally:
    STOP.set()
