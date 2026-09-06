# Production rollout — 2026-09-06 UTC

## Deployment

- Pages: `ad-engine-lab`, custom domain `creativerushai.com`.
- Render: `creativerush-production`, `srv-daedg0gu01pc73e20q50`, My Workspace.
- Health: https://creativerush-production.onrender.com/health
- Render source: branch `codex/production-rollout`, automatic deploys disabled.
- Runtime: Node 22.18.0, FFmpeg, coordinator `render-production-1` and renderer
  `render-assembly-1`. The previous Mac render process was stopped before testing.
- RunPod: `afqgave1r50kq8`, RTX 5090, $0.69/hour for GPU, storage extra.
  150GB persistent pod disk at `/workspace`. This is not a detachable network
  volume; do not terminate the pod if its files must be preserved.
- H3: all eight model sizes verified; PyTorch 2.10.0+cu130. ComfyUI listens only
  on loopback, uses 8-step FL2V LoRA, and outputs clips without generated audio.
- Persistent startup script: `workers/deploy/h3-boot.sh`, installed under
  `/workspace/creativerush/boot.sh`. The pod startup command waits for this
  persisted file. A real pod restart recovered ComfyUI and the worker heartbeat
  automatically. RunPod can change the SSH port on restart; query the pod.

The cloud workers use secrets configured on their own services. Never copy
runtime.env, API keys, or worker tokens into the repository.

## New-account test

A new email-login account was created through the public website, with test
credits explicitly recorded as `internal_e2e_test_grant`. No Stripe purchase
was fabricated and no real card was charged.

The test imported an Allbirds Wool Runner from its public store, attached an
existing Nebula reference video, analyzed frames plus transcription, drafted an
English script, revised it through chat, and approved production through the
normal UI. Real OpenAI images and MiniMax speech are used. The first production
began before image-credit accounting was deployed; its initial five images are
an internal test expense, not evidence of production image-credit debits.

End-to-end render and chat revision results: pending final verification.

## Fixes found in the real test

- Supabase email callbacks now return to `creativerushai.com` instead of the old
  Pages hostname. Previous callback URLs were preserved.
- Server RPCs can read only the required Auth columns (`id`, `email`,
  `created_at`). Browser roles receive no new permissions.
- Product size variants on the same page become one product. Published image
  candidates retain the largest width instead of a thumbnail; the page's meta
  description fills incomplete Product JSON-LD.
- Reference transcription can use OpenAI Whisper when `REFERENCE_OPENAI_KEY`
  is configured, while preserving ElevenLabs Scribe support. It still validates
  word timestamps and passes bounded transcript evidence to DeepSeek.
- `PRODUCTION_ALLOWED_USERS` limits this rollout to the test account while
  end-to-end delivery and billing verification are unfinished.

## Credits and recovery

- Clips retain the existing pricing: 1 video credit per 5 generated seconds.
- Each newly generated image reserves 1 image credit transactionally before
  calling the provider. Replays of completed steps reuse their result.
- Failed or uncertain, undelivered image steps refund that image credit once.
  Provider costs on an ambiguous failure remain the operator's expense.
- An explicit new attempt on an unchanged project that failed before saving its
  storyboard reuses completed planning, narration, timing, and image steps.
  Completed scene versions on a saved storyboard are reused by the coordinator.
- Empty balances are rejected before starting. Remaining image and clip
  requirements are checked before their respective stages; clips and images
  still debit atomically per generation. This is not a whole-ad escrow: spending
  in another tab can still stop a later stage, preserving its completed assets.
- Hosted-DB transactional checks under `service_role` verified duplicate clip
  reservations, duplicate failure refunds, image debits/refunds and reuse of
  completed images. These checks rolled back all fixture state and did not call
  a provider.
- Local suite: 133 passed, 1 optional separate-editor sandbox check skipped.
- Stripe checkout currently sells the existing $999 MXN bundle. This rollout
  does not change pricing. Real payment/webhook verification is pending because
  the Stripe connector requires reauthentication.

## Fixed infrastructure cost

Render Standard: $25/month. The RunPod GPU accrues $0.69/hour while running,
plus its disk charges. Keep it running only when intended; stopping/terminating
and scaling policies are separate operational decisions. Supabase/Pages and
provider usage depend on their existing plans and actual consumption.
