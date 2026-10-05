# Video editor models: Opus 5.5 directs, DeepSeek executes

The `/editor/` worker (`workers/video-use-worker.mjs`) now defaults to
`VIDEO_USE_MODELS=opus-deepseek` (`workers/video-use/models.mjs`):

- **Claude Opus 5.5** (Anthropic Messages API) runs the main loop: strategy,
  the execution brief, render/verify and the final review.
- **DeepSeek v4.1 Flash** (OpenCode Go) writes `edl.json` and overlays from the
  brief (`delegate_execution`), builds animations and describes filmstrips.

`VIDEO_USE_MODELS=astra` restores the previous single-model Astra loop. The
studio ad pipeline (`creative-edit.mjs`) is unchanged and keeps its own profile.

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Opus director. Required. An API key, not a Claude Code plan. |
| `OPENCODE_API_KEY` (or existing `REFERENCE_FLASH_KEY`) | DeepSeek executor. Required. |
| `VIDEO_USE_MAX_MODEL_COST_USD` | Model budget per job, director plus executor. Default 1.50, range 0.10–5. |
| `VIDEO_USE_DIRECTOR_EFFORT` | Opus effort. Default `low`, as benchmarked. |

The worker refuses to start without the keys. Install dependencies on the worker
host (`npm install`) so `@anthropic-ai/sdk` is available; the Python sandbox
image only needs rebuilding for the bundled fonts and sound effects.

## API behavior

- Opus 5.5 rejects forced tool use: tools are offered with `auto`, the prompt
  asks for one call, and the director retries once if none is made.
- Thinking blocks are replayed unchanged. Batch image release can edit earlier
  turns, so requests set `prefix_mismatch_behavior: "drop_block"`
  (beta `thinking-binding-controls-2026-08-01`).
- Server-side refusal fallbacks are on (`fallbacks: "default"`,
  beta `server-side-fallback-2026-07-01`); a final refusal fails the job with
  `DIRECTOR_REFUSAL`.
- The system prompt is identical across jobs and cached; consecutive jobs
  within the cache lifetime read it instead of writing it.
- DeepSeek calls retry twice on transient provider errors or malformed tool
  responses. Every attempt is metered.

## Expected cost

Benchmarked with 30-second UGC clips (`scripts/bench-video-use-opus.mjs`):
median about $0.37 per styled edit at API prices, range $0.28–0.66, with
correction rounds included. These figures were estimated from token logs
recorded through the Claude Code CLI, not measured on the API; confirm them
with production usage before setting plan limits.
