# H3 prompt writer: DeepSeek

For the `astra-deepseek-v1` profile, both automatic production and individual scene
versions use DeepSeek Flash through OpenCode to write H3 prompts. Astra still owns
reference analysis, scene direction and final visual review. The dedicated
`prompter` role accepts the approved first-frame image, unlike the text-only editor.
No failure in this role falls back to Astra. Model aliases are validated by the
provider adapter and preserved in the usage record.

## Official guide

Reviewed September 16, 2026:
[MiniMax H3 base/keyframe guide](https://github.com/MiniMax-AI/MiniMax-H3/blob/35491cdba2adfe62a510f725e8619f8e58783ea2/skills/h3-prompt-writing/references/base-en.txt).
The revision is exposed as `h3PromptGuide` in runtime health; `h3PromptWriter`
identifies the configured writer separately from the director.

The current scene API supplies either a first-frame image (I2VA) or text (T2VA).
It does not supply a last frame, even though the installed model supports it.
Accordingly it must not invent FL2VA/L2VA headers or an unattached second picture.

| Requirement | Enforcement |
| --- | --- |
| Correct first-frame alignment instruction for I2VA; none for T2VA | Server serializer, not model-generated |
| Three ordered core fields | Server serializer |
| Style/composition anchored in the supplied image, followed by observable action and development | Writer instructions and actual image input |
| Preserve identities, props, spatial relationships and required ending | Approved scene, neighbors, continuity and shot contract supplied unchanged |
| Natural camera-motion wording, with meaningful range/speed | Writer instructions |
| Preserve necessary visible writing in double quotes | Writer instructions |
| No timestamp on the opening shot | Instructions and format validator |

CreativeRush uses a deliberately narrower production contract than the general
guide: one continuous shot, no additional media references, no generated speech,
no added labels/subtitles and complete silence. These are application choices,
not limitations of H3. The explicit silence requirement permits the guide's `N/A`
soundscape; voice, captions and any music are assembled separately. The validator
rejects extra shots, dialogue/speaker markers and unsupported reference tags.

The writer only returns the visual-description JSON field. It cannot alter render
settings, duration, script, scene ordering, image selection or acceptance criteria.
Output size limits remain the existing application limits. One metered format
repair is permitted; malformed/unknown provider calls fail closed. Completed
prompts remain cached by the production clip-preparation checkpoint, including
older accepted Astra prompts: switching models does not repay completed work.

Usage records now label these calls `role: prompter`, `model: deepseek-flash`.
The existing reservation/settlement callback accounts for both attempts when a
format repair is needed. Semantic quality still depends on model output and the
existing visual review; structural validation alone does not guarantee animation
quality.
