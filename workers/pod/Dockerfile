FROM ghcr.io/alangael24/creativerush-h3@sha256:f8e3d5c64fded6d75a8b477525cbd67007823bb79a962f9e97df457f7ac53a6c
COPY workers/h3-worker.mjs workers/h3-adapter.mjs workers/h3-serverless-adapter.mjs /opt/creativerush/workers/
COPY src/h3-lifecycle.js src/h3-pod-policy.js /opt/creativerush/src/
COPY workers/workflows/h3.json /opt/creativerush/workers/workflows/h3.json
COPY workers/pod/entry.py /opt/creativerush/workers/pod/entry.py
ENTRYPOINT ["/opt/venv/bin/python", "/opt/creativerush/workers/pod/entry.py"]
CMD []
