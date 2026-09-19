// Actual recovery and input/lease checks run atomically in recover_production_step.
// Render IDs, writes and accounting entries must never cross productions.
export const recoverableProductionStep=key=>/^(plan|timing|narration|image-\d+|repair-image-\d+-\d+|material-contracts-v\d+|material-call-[a-f0-9]{64}|material-v\d+-(still-check-\d+-\d+|image-review-\d+))$/.test(key);
