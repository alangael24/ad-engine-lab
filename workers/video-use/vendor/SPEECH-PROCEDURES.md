# Speech procedures v1

Use these procedures when the requested/approved edit calls for speech cleanup or dynamic captions. Preserve existing creative decisions and unrelated layers. They require cached word-level timestamps, not sentence SRT or estimated word lengths. No transcription, model or GPU API is invoked by the helpers.

## Speech cleanup

The hosted editor exposes `plan_speech_cleanup(source, trim_silences, approved_repetitions, protected)` in edit mode. It returns source ranges and an audit; merge them into the current EDL without discarding overlays, color, other sources or requested content. Inspect source and output cut boundaries and listen before declaring speech natural.

1. First call with no approved repetition IDs. Protect deliberate dramatic pauses, laughter, reactions and important visual actions using source-time intervals.
2. The hosted helper measures audio with FFmpeg silencedetect (-38 dB, at least 250 ms); only the intersection of measured silence and the padded transcript gap can be removed. Music may prevent a silence cut, which is intentional conservative behavior. The helper shortens gaps of at least 650 ms to approximately 280 ms, retaining at least 450 ms at sentence endings or speaker changes. It keeps leading/trailing footage, fillers, words and unselected repetitions. Explicit audio events are protected.
3. Exact adjacent repeated phrases (3–12 words, same labeled speaker, at most 3 seconds apart) are candidates only. Review the source before selecting an ID. Repeated slogans, emphasis, quoted speech and meaningful repetition stay. Partial restarts and paraphrases are not automatically detected by v1.
4. Send only verified unwanted restarts in `approved_repetitions`. Their word indices are removed with padded boundaries; remaining word coverage must match exactly. Unknown candidates, overlap, protected content and unsafe edges fail closed.
5. If the project has an approved verbatim script, hosted execution rejects repetition deletion. Do not circumvent narration coverage checks.

Standalone: `python helpers/speech_edit.py plan transcript.json --duration 40 --source S01 --audio source.mp4 -o edit/cleanup.json`. Rerun with `--approve-repeat repeat-I-N` after semantic review. `plan-request` accepts JSON keyword arguments for `plan_cleanup`, including protected intervals. Outputs belong in the project's edit directory.

## Dynamic captions

In the EDL set `subtitles: "master.ass"` and `dynamic_captions: {}`. Optional settings:

```json
{"dynamic_captions":{"color":"#ffffff","highlight":"#ffdf00","font_size":54,"max_words":4,"bottom_fraction":0.19}}
```

Font size is in output canvas pixels. Omit it for automatic sizing. Default positions are a starting point, not guaranteed safe for every face, platform UI or existing on-screen text. Inspect and adjust within 10–35% bottom margin. Do not combine with legacy `subtitle_style`.

The production renderer measures encoded segment durations first, remaps cached words into the output timeline and then generates ASS. Captions break at punctuation, speaker changes, gaps and cuts; measured width limits each group to two lines. The phrase stays stationary and only the spoken word changes color. It retains actual spelling, accents and punctuation; it does not invent a transcript. ASS control sequences in source text are escaped. Overlays render first and captions last.

`master.audit.json` records word coverage, output timing, excluded words, measured line widths and reading-speed warnings. Inspect rendered interior frames and every cut. A warning is a reason to inspect, not automatically regenerate. Grouping is based on punctuation and timing; it is not a complete language parser. ASR errors, missing events, font fallback and occlusion still require review.

Standalone generation: `python helpers/speech_edit.py captions edit/edl.json --edit-dir edit -o edit/master.ass`. For edits with multiple cuts, supply `rendered_start` and `rendered_duration` measured from the encoded segments. Nominal EDL sums can drift. Render ASS without applying an SRT `force_style` override.

## Regression checks

From the CreativeRush repository:

```
python tests/speech-edit.py
node --test tests/speech-edit.test.mjs tests/video-use.test.mjs tests/video-use-stream.test.mjs
python tests/video-use-timeline.py
```

The local media demonstration uses cached reference footage and Scribe word timestamps. A repeated sentence and silence were deliberately inserted as a controlled fixture, then removed through the same planner. This is an integration test, not evidence that a model has passed arbitrary real-world edits autonomously. Existing burned-in captions were cropped out only to isolate the new caption layer.

For the local skill, `helpers/speech_render.py` is the production renderer snapshot. Use `python helpers/speech_render.py edit/edl.json -o edit/final.mp4 --build-subtitles` for measured dynamic caption rendering; the legacy local `render.py` is unchanged.
