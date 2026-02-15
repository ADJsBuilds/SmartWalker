#!/usr/bin/env python3
import argparse
import asyncio
import json

import websockets


async def run(url: str):
    async with websockets.connect(url) as ws:
        print(f'connected: {url}')
        async for msg in ws:
            try:
                data = json.loads(msg)
            except json.JSONDecodeError:
                data = msg
            print(data)


def main():
    parser = argparse.ArgumentParser(description='Listen to SmartWalker websocket stream.')
    parser.add_argument('--base-url', default='ws://localhost:8000')
    parser.add_argument('--resident-id', default=None)
    args = parser.parse_args()
    path = '/ws/live'
    if args.resident_id:
        path += f'?residentId={args.resident_id}'
    else:
        path = '/ws'
    url = f"{args.base_url.rstrip('/')}{path}"
    asyncio.run(run(url))


if __name__ == '__main__':
    main()
