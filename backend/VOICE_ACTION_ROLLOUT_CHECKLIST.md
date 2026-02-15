# Voice Action Rollout Checklist

Use this checklist before enabling `VOICE_ACTION_ENABLE_LLM_FALLBACK=true` in production.

## Stage 1: deterministic only (default)

- [ ] Confirm `VOICE_ACTION_ENABLE_LLM_FALLBACK=false`.
- [ ] Confirm `VOICE_ACTION_CONFIRMATION_TIMEOUT_SECONDS` is set (recommended: 20-30).
- [ ] Validate contact map in `CARRIER_CONTACTS` includes expected lowercase keys.
- [ ] Run smoke test in staging:
  - [ ] Say: "Zoom my daughter" -> receive `action_detected` and `action_confirm_required`.
  - [ ] Say: "no" -> receive `action_cancelled` with `reason=user_denied`.
  - [ ] Say: "Zoom my daughter" then "yes" -> receive `action_executed` with `ok=true`.
- [ ] Validate SQL flow still works for non-action prompts (e.g., "How many steps today?").

## Stage 2: observability review

- [ ] Review websocket debug events with `stage=action` for at least one day in staging.
- [ ] Confirm no duplicate invites for repeated utterances during a pending confirmation window.
- [ ] Confirm unknown contacts return safe action cancellation and no Zoom API call is made.
- [ ] Confirm no increase in `error` frames for normal SQL Q&A prompts.

## Stage 3: enable LLM fallback gradually

- [ ] Enable `VOICE_ACTION_ENABLE_LLM_FALLBACK=true` in staging first.
- [ ] Validate natural-language variants trigger confirmation without false positives.
- [ ] Promote to production only after stable staging behavior and low false-positive rate.

