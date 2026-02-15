# Proactive Monitor Rollout

This rollout sequence matches the proactive avatar monitoring plan.

## Phase 1: observe-only

- Set `PROACTIVE_MONITOR_ENABLED=true`.
- Keep operational guardrails strict:
  - `PROACTIVE_REQUIRE_ACTIVE_AVATAR=true`
  - conservative thresholds (`PROACTIVE_WEIGHT_THRESHOLD_KG=20`, `PROACTIVE_BALANCE_THRESHOLD=0.30`)
- Verify websocket `proactive_event` payloads are emitted with expected `eventType`, `severity`, `spoken`, and `error`.

## Phase 2: fall speech first

- Keep monitor enabled.
- Validate live avatar sessions are mapped from `/ws/voice-agent` `session.start`.
- Confirm fall events trigger concern + help question.
- Confirm interrupt behavior works for falls and does not starve normal agent turns.

## Phase 3: coaching speech

- Validate high-load and imbalance coaching cadence is acceptable.
- Tune `PROACTIVE_EVENT_COOLDOWN_SECONDS` and `PROACTIVE_MAX_SPEAKS_PER_MINUTE` to reduce repeated advice.

## Phase 4: tuning and stabilization

- Review false positives per event type.
- Adjust thresholds based on real resident/device calibration.
- Keep fall prompts empathetic and action-oriented; avoid diagnostic language.

