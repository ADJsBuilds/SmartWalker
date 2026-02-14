import base64
import math
import struct
from typing import Iterable, List


def pcm16le_from_float_samples(samples: Iterable[float]) -> bytes:
    out = bytearray()
    for value in samples:
        clamped = max(-1.0, min(1.0, float(value)))
        int_val = int(clamped * 32767.0)
        out.extend(struct.pack('<h', int_val))
    return bytes(out)


def chunk_pcm_bytes(pcm_bytes: bytes, sample_rate_hz: int = 24000, seconds_per_chunk: float = 1.0) -> List[bytes]:
    bytes_per_second = int(sample_rate_hz * 2)
    chunk_size = max(1, int(bytes_per_second * seconds_per_chunk))
    return [pcm_bytes[i : i + chunk_size] for i in range(0, len(pcm_bytes), chunk_size)]


def b64_encode_pcm_chunk(chunk: bytes) -> str:
    return base64.b64encode(chunk).decode('ascii')


def generate_test_tone_pcm16le(
    *,
    duration_seconds: float = 1.0,
    frequency_hz: float = 440.0,
    sample_rate_hz: int = 24000,
    amplitude: float = 0.2,
) -> bytes:
    sample_count = max(1, int(duration_seconds * sample_rate_hz))
    two_pi_f = 2.0 * math.pi * frequency_hz
    samples = []
    for i in range(sample_count):
        t = i / float(sample_rate_hz)
        samples.append(amplitude * math.sin(two_pi_f * t))
    return pcm16le_from_float_samples(samples)

