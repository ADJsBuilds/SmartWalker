#!/usr/bin/env python3
import argparse
import json
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description='Send one vision packet.')
    parser.add_argument('--base-url', default='http://localhost:8000')
    parser.add_argument('--resident-id', default='r1')
    parser.add_argument('--camera-id', default='cam-1')
    parser.add_argument('--step-count', type=int, default=100)
    parser.add_argument('--cadence-spm', type=float, default=90.0)
    parser.add_argument('--step-var', type=float, default=9.5)
    parser.add_argument('--confidence', type=float, default=0.92)
    parser.add_argument('--source-fps', type=float, default=28.0)
    parser.add_argument('--inference-ms', type=float, default=24.0)
    parser.add_argument('--fall-suspected', action='store_true')
    parser.add_argument('--ts', type=int, default=None)
    args = parser.parse_args()

    payload = {
        'residentId': args.resident_id,
        'cameraId': args.camera_id,
        'ts': args.ts or int(time.time()),
        'fallSuspected': bool(args.fall_suspected),
        'personDetected': True,
        'stepCount': args.step_count,
        'cadenceSpm': args.cadence_spm,
        'stepVar': args.step_var,
        'confidence': args.confidence,
        'sourceFps': args.source_fps,
        'inferenceMs': args.inference_ms,
    }
    req = urllib.request.Request(
        f"{args.base_url.rstrip('/')}/api/vision",
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(resp.read().decode())


if __name__ == '__main__':
    main()
