"""Only MiniMax H3. Model downloads are delegated to Runpod's host cache."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request

MODEL_MANIFEST = json.loads(Path(__file__).with_name('model-manifest.json').read_text())
# The server-owned graph always uses FL2V turbo8, with narration added by the
# editor. REF2V, turbo4 and the audio decoder are not dependencies of this worker.
MODEL_SIZES = {name: spec['bytes'] for name, spec in MODEL_MANIFEST['files'].items()}


def link_models(root, cache, repo=None, revision=None):
    repo = repo or os.environ.get('H3_MODEL_REPO') or MODEL_MANIFEST['sourceRepo']
    revision = revision or os.environ.get('H3_MODEL_REVISION') or None
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repo):
        raise RuntimeError('H3_CACHE_INVALID_REPO')
    model_cache = cache / ('models--' + repo.replace('/', '--'))
    main_ref = model_cache / 'refs' / 'main'
    if revision is None and main_ref.is_file():
        revision = main_ref.read_text().strip()
    if revision is not None and not re.fullmatch(r'[a-f0-9]{40,64}', revision):
        raise RuntimeError('H3_CACHE_INVALID_REVISION')
    snapshots = [model_cache / 'snapshots' / revision] if revision else sorted((model_cache / 'snapshots').glob('*'))
    # Require one complete snapshot. Mixing files from different revisions can
    # silently change the model even when individual file sizes look correct.
    complete = [s for s in snapshots if all((s / name).is_file()
                and (s / name).stat().st_size == size for name, size in MODEL_SIZES.items())]
    if len(complete) != 1:
        raise RuntimeError('H3_CACHE_MISSING' if not complete else 'H3_CACHE_AMBIGUOUS_REVISION')
    for relative in MODEL_SIZES:
        source = complete[0] / relative
        target = root / 'models' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink():
            target.unlink()
        target.symlink_to(source)


def start_comfy():
    root = Path(os.environ.get('COMFY_ROOT', '/opt/ComfyUI'))
    link_models(root, Path(os.environ.get('HF_HUB_CACHE', '/runpod-volume/huggingface-cache/hub')))
    child = subprocess.Popen(['python', 'main.py', '--listen', '127.0.0.1', '--port', '8188',
                              '--disable-pinned-memory', '--fp16-intermediates', '--cache-none'], cwd=root)
    for _ in range(120):
        if child.poll() is not None:
            raise RuntimeError('H3_STARTUP_FAILED')
        try:
            with urllib.request.urlopen('http://127.0.0.1:8188/system_stats', timeout=2):
                return child
        except OSError:
            time.sleep(2)
    child.terminate()
    raise RuntimeError('H3_STARTUP_TIMEOUT')


def handler(job):
    # No arbitrary workflows, commands, or code from API callers.
    try:
        result = subprocess.run(['node', 'workers/serverless/run-job.mjs'],
                                input=json.dumps(job['input']), text=True,
                                stdout=subprocess.PIPE, timeout=1140)
        if result.returncode:
            return {'error': 'H3_JOB_FAILED'}
        return json.loads(result.stdout)
    except (ValueError, KeyError, subprocess.TimeoutExpired):
        return {'error': 'H3_JOB_FAILED'}
    finally:
        # One job at a time. Keep models loaded; remove only per-job inputs/outputs.
        root = Path(os.environ.get('COMFY_ROOT', '/opt/ComfyUI'))
        for folder in ['input', 'output', 'temp']:
            for file in (root / folder).rglob('*'):
                if file.is_file() and not file.is_symlink():
                    file.unlink(missing_ok=True)


if __name__ == '__main__':
    import runpod
    comfy = start_comfy()
    try:
        runpod.serverless.start({'handler': handler})
    finally:
        comfy.terminate()
