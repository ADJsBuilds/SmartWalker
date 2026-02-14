import time
from typing import Any, Dict

walker_state: Dict[str, Dict[str, Any]] = {}
vision_state: Dict[str, Dict[str, Any]] = {}
merged_state: Dict[str, Dict[str, Any]] = {}


def now_ts() -> int:
    return int(time.time())


def compute_merged(resident_id: str) -> Dict[str, Any]:
    w = walker_state.get(resident_id)
    v = vision_state.get(resident_id)

    fsr_left = (w or {}).get('fsrLeft', 0)
    fsr_right = (w or {}).get('fsrRight', 0)
    total = fsr_left + fsr_right + 1e-6
    balance = (fsr_left - fsr_right) / total

    tilt = (w or {}).get('tiltDeg')
    # Prioritize camera/vision step count (more accurate) over walker sensor steps
    vision_step_count = (v or {}).get('stepCount') or (v or {}).get('step_count')
    walker_steps = (w or {}).get('steps')
    steps = vision_step_count if vision_step_count is not None else walker_steps

    fall_from_vision = bool((v or {}).get('fallSuspected', False))
    walker_tipped = (tilt is not None) and (tilt >= 60)

    return {
        'residentId': resident_id,
        'ts': max((w or {}).get('ts', 0), (v or {}).get('ts', 0), now_ts()),
        'walker': w,
        'vision': v,
        'metrics': {
            'steps': steps,
            'tiltDeg': tilt,
            'reliance': total,
            'balance': balance,
            'fallSuspected': fall_from_vision or walker_tipped,
        },
    }
