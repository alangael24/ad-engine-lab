# Personalized gift movies

`/regalos/` is a public, Spanish entry within CreativeRush. It collects recipient,
occasion, protagonists/pronunciation, up to three memories, a dedication, exclusions,
style and format. Up to three owned image assets carry explicit identity labels.
No new product checkout, price, delivery promise or subscription is introduced.

The page uses existing authenticated creator-v1 projects (60-second story target),
script chat, review/approval and production pipeline. It is an entry and brief adapter,
not a separate generation engine. Projects are visible under `/crear/`. The original
ad and content entry points retain their profiles and prompts. No migrations or new
worker/provider routing are required.

The brief instructs the writer to preserve factual memories and relationships,
create a recognizable moment, and avoid invented personal events and commercial
CTAs. These are model instructions, not a guarantee of perfect resemblance or facts;
the customer still approves the script and existing visual review remains necessary.

Text drafts persist for the current browser session. Photos upload only after
sign-in and explicit submission. Unsubmitted photo selections do not survive reload.
Project payload and ID are frozen before creation; uncertain replies reuse the same
ID. Chat handoff stores its request ID in the existing studio recovery mechanism.
Revisions, narration, generation and downloads use the existing studio and balances.

Validation: gifts, creator product and onboarding suites: 18 passing tests. Tests
exercise persisted reference ownership, idempotent creation, preservation on save,
full field limits and no production job during draft creation, with local fixtures.
Static build passed. No paid video generation was run for this interface change.
