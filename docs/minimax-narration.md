# MiniMax narration

The production provider uses MiniMax when MINIMAX_API_KEY is configured. The previous ElevenLabs path remains available when it is absent. Default model: speech-2.8-hd. Set MINIMAX_VOICE_ID to choose the production voice; the default is English_expressive_narrator. PRODUCTION_SPEECH_MODEL can override the model.

The provider requests word subtitles, converts milliseconds to seconds, verifies the text matches the approved script, probes the actual MP3, and uploads it through the existing narration asset flow. Production's persisted speech step stores duration, alignment and reported character usage. Existing scene alignment consumes those timestamps. Missing/invalid timing fails rather than estimating timings. No automatic fallback makes a second paid generation.

Server configuration: MINIMAX_API_KEY, OPENAI_API_KEY, REFERENCE_FLASH_KEY plus the existing CREATIVE_RUSH_URL, PRODUCTION_WORKER_TOKEN and PRODUCTION_WORKER_ID. Keys are worker-only. For local macOS development, scripts/production-local-keychain.mjs reads the three provider credentials from Keychain into memory and starts the worker; server credentials must still be configured.

This integration does not deploy or activate a production worker. The API reports usage_characters, not the subscription's audio-point balance; do not infer the exact point conversion from this field alone.
