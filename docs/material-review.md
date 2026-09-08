# Material-impact review

Local policy revision 2 applies to still review, final rendered-frame review, focused confirmation and the video-use editor. Technical checks and bounded repair limits are unchanged.

A difference from an incidental motion prompt is not by itself a reason to regenerate. Review evidence must explain the visible defect and the concrete effect on a requirement or viewer understanding. Explicit timing, identity, main branding, necessary framing and cut-state requirements remain binding.

Calibration from video-continuity-07 and video-continuity-08:

| Case | Expected decision | Reason |
| --- | --- | --- |
| Skeleton invents fleshy ear | Repair | Material character/anatomy change |
| Skeleton small nod with preserved identity | Accept | Natural movement preserves scene |
| UGC main GODA lettering changes | Repair | Main product identity changes |
| UGC approaches slightly, GODA stays visible | Accept | Incidental movement, product and actor preserved |
| Zack gains unrequested human hand | Repair | New actor/prop interaction changes scene |
| Zack bottle closes earlier | Conditional | Accept only if narration, required hold and next shot permit a closed final state |

These expectations derive from previously inspected clips; they are not new live-model scores. Automated regression tests verify that overview and focused reviewers receive the shared policy and that an unconfirmed issue is removed. They do not establish live-model accuracy. A fresh blind model run remains necessary before claiming this change improves detection rates.

No GPU or deployment is required by this policy change. No service is activated by importing the policy.
