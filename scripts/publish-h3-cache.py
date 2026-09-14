#!/usr/bin/env python3
"""Prepare a private, hash-verified H3 cache using Hub-to-Hub LFS copies.

Default mode only audits public source metadata. --apply requires an existing
Hugging Face login/write token. No weights are downloaded and no GPU is started.
Requires huggingface_hub==1.31.0 (cross-repository CommitOperationCopy support).
"""
import argparse
import json
from pathlib import Path
import re
import urllib.request

MANIFEST_PATH = Path(__file__).resolve().parents[1] / 'workers/serverless/model-manifest.json'
LICENSE_URL = 'https://huggingface.co/MiniMaxAI/MiniMax-H3/resolve/42ed227ee7df40d41602854ae760620d6eb651fe/LICENSE'
QWEN_LICENSE_URL = 'https://raw.githubusercontent.com/QwenLM/Qwen3-VL/96588727e44c78b25ba03ea03b8e12f7e64fd0da/LICENSE'
METADATA_FILES = {'.gitattributes', 'README.md', 'LICENSE', 'LICENSE-QWEN', 'NOTICE', 'model-manifest.json'}


def verify_files(info, manifest, exact=False):
    files = {f.rfilename: f for f in info.siblings}
    for name, expected in manifest['files'].items():
        f = files.get(name)
        if f is None or f.size != expected['bytes'] or not f.lfs or f.lfs.sha256 != expected['sha256']:
            raise ValueError('H3_CACHE_HASH_MISMATCH: ' + name)
    if exact and set(files) - set(manifest['files']) - METADATA_FILES:
        raise ValueError('H3_CACHE_UNEXPECTED_FILES')
    return sum(f['bytes'] for f in manifest['files'].values())


def validate_destination(repo_id, owner, manifest):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', repo_id):
        raise ValueError('H3_CACHE_INVALID_REPO')
    if repo_id.split('/')[0] != owner or repo_id == manifest['sourceRepo']:
        raise ValueError('H3_CACHE_DESTINATION_NOT_OWNED')


def small_download(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'CreativeRush-cache-publisher'}), timeout=30) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ValueError('H3_CACHE_METADATA_TOO_LARGE')
    return data


def publish(api, manifest, repo_id, owner, metadata, copy_operation, add_operation, not_found):
    validate_destination(repo_id, owner, manifest)
    source = api.model_info(manifest['sourceRepo'], revision=manifest['sourceRevision'], files_metadata=True)
    verify_files(source, manifest)
    try:
        target = api.model_info(repo_id, files_metadata=True)
    except not_found:
        api.create_repo(repo_id=repo_id, repo_type='model', private=True, exist_ok=False)
        target = api.model_info(repo_id, files_metadata=True)
    if not target.private:
        raise ValueError('H3_CACHE_DESTINATION_MUST_BE_PRIVATE')
    names = {f.rfilename for f in target.siblings}
    if names - {'.gitattributes'}:
        # An interrupted acknowledgement is recovered by reading the result.
        # Never overwrite an unrelated/nonempty repository or blindly recommit.
        verify_files(target, manifest, exact=True)
        if not set(metadata).issubset(names):
            raise ValueError('H3_CACHE_EXISTING_METADATA_INCOMPLETE')
        return target
    operations = [copy_operation(src_path_in_repo=name, path_in_repo=name,
                  src_revision=manifest['sourceRevision'], src_repo_id=manifest['sourceRepo'],
                  src_repo_type='model') for name in manifest['files']]
    operations.extend(add_operation(path_in_repo=name, path_or_fileobj=data) for name, data in metadata.items())
    commit = api.create_commit(repo_id=repo_id, repo_type='model', operations=operations,
                              commit_message='Add unchanged H3 FL2V turbo8 production weights',
                              parent_commit=target.sha)
    target = api.model_info(repo_id, revision=commit.oid, files_metadata=True)
    verify_files(target, manifest, exact=True)
    return target


def main():
    from huggingface_hub import HfApi, CommitOperationCopy, CommitOperationAdd, get_token
    from huggingface_hub.errors import RepositoryNotFoundError
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Create the private cache on the authenticated account')
    parser.add_argument('--repo', help='Defaults to <authenticated-owner>/creativerush-h3-fl2v-turbo8')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST_PATH.read_text())
    api = HfApi(token=get_token() if args.apply else False)
    source = api.model_info(manifest['sourceRepo'], revision=manifest['sourceRevision'], files_metadata=True)
    required_bytes = verify_files(source, manifest)
    report = {'status': 'source_verified', 'sourceRepo': manifest['sourceRepo'],
              'sourceRevision': source.sha, 'weightFiles': len(manifest['files']), 'weightBytes': required_bytes,
              'sourceRepositoryBytes': sum(f.size or 0 for f in source.siblings),
              'gpuStarted': False, 'weightsDownloadedLocally': False, 'runpodConfigured': False}
    if args.apply:
        if not get_token():
            raise ValueError('HF_AUTH_REQUIRED: use hf auth login or HF_TOKEN')
        owner = api.whoami()['name']
        repo_id = args.repo or owner + '/creativerush-h3-fl2v-turbo8'
        notice = 'MiniMax H3 is licensed under the MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax. All Rights Reserved.\n'
        readme = f'''---
license: other
license_name: minimax-h3-community-license-agreement
license_link: LICENSE
base_model: Comfy-Org/MiniMax-H3
tags:
- comfyui
- diffusion-single-file
---
# H3 FL2V turbo8 production cache

Four unchanged weight files from `{manifest['sourceRepo']}@{manifest['sourceRevision']}`.
This private cache only removes unused variants from the repository. It does not
alter, fine-tune, merge or re-quantize the weights. Sizes and SHA-256 hashes are
recorded in model-manifest.json. Source: https://huggingface.co/{manifest['sourceRepo']}.

Use is subject to the original MiniMax H3 license, including its territorial
restrictions. The Qwen encoder also carries Apache 2.0; see LICENSE-QWEN.
'''
        metadata = {'README.md': readme.encode(), 'LICENSE': small_download(LICENSE_URL),
                    'LICENSE-QWEN': small_download(QWEN_LICENSE_URL), 'NOTICE': notice.encode(),
                    'model-manifest.json': (json.dumps(manifest, indent=2) + '\n').encode()}
        target = publish(api, manifest, repo_id, owner, metadata,
                         CommitOperationCopy, CommitOperationAdd, RepositoryNotFoundError)
        report.update(status='private_cache_verified', repo=repo_id, revision=target.sha,
                      url='https://huggingface.co/' + repo_id,
                      workerEnv={'H3_MODEL_REPO': repo_id, 'H3_MODEL_REVISION': target.sha})
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
