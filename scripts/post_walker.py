#!/usr/bin/env python3
import argparse
import json
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description='Send one walker packet.')
    parser.add_argument('--base-url', default='http://localhost:8000')
    parser.add_argument('--resident-id', default='r1')
    parser.add_argument('--fsr-left', type=int, default=20)
    parser.add_argument('--fsr-right', type=int, default=18)
    parser.add_argument('--tilt-deg', type=float, default=5.0)
    parser.add_argument('--steps', type=int, default=100)
    parser.add_argument('--ts', type=int, default=None)
    args = parser.parse_args()

    payload = {
        'residentId': args.resident_id,
        'fsrLeft': args.fsr_left,
        'fsrRight': args.fsr_right,
        'tiltDeg': args.tilt_deg,
        'steps': args.steps,
        'ts': args.ts or int(time.time()),
    }
    req = urllib.request.Request(
        f"{args.base_url.rstrip('/')}/api/walker",
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(resp.read().decode())


if __name__ == '__main__':
    main()
