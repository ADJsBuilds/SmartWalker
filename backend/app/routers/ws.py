import base64
import json
import time
from typing import Any, Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.db.session import SessionLocal
from app.services.merge_state import merged_state
from app.services.voice_sql_pipeline import VoiceSqlPipeline
from app.services.ws_manager import ConnectionManager

router = APIRouter(tags=['ws'])
manager = ConnectionManager()


async def _ws_loop(websocket: WebSocket, resident_id: Optional[str] = None) -> None:
    await manager.connect(websocket, resident_id=resident_id)
    try:
        if resident_id:
            data = [merged_state[resident_id]] if resident_id in merged_state else []
        else:
            data = list(merged_state.values())
        await websocket.send_json({'type': 'snapshot', 'data': data})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


@router.websocket('/ws')
async def ws_legacy(websocket: WebSocket):
    await _ws_loop(websocket, resident_id=None)


@router.websocket('/ws/live')
async def ws_live(websocket: WebSocket, residentId: Optional[str] = Query(default=None)):
    await _ws_loop(websocket, resident_id=residentId)


@router.websocket('/ws/voice-agent')
async def ws_voice_agent(websocket: WebSocket, residentId: Optional[str] = Query(default='r1')):
    await websocket.accept()
    pipeline = VoiceSqlPipeline()
    db = SessionLocal()
    active_resident_id = str(residentId or 'r1')

    async def _send(payload: dict[str, Any]) -> None:
        await websocket.send_json(payload)

    async def _debug(stage: str, message: str, **meta: Any) -> None:
        payload: dict[str, Any] = {'type': 'debug', 'stage': stage, 'message': message}
        if meta:
            payload['meta'] = meta
        await _send(payload)

    async def _handle_turn(*, user_text: Optional[str] = None, audio_bytes: Optional[bytes] = None, mime_type: str = 'audio/webm') -> None:
        transcript = (user_text or '').strip()
        turn_started = time.perf_counter()
        try:
            if audio_bytes:
                await _debug('stt', 'Starting transcription', mime_type=mime_type, audio_bytes=len(audio_bytes))
                transcript = await pipeline.transcribe_audio(audio_bytes, mime_type=mime_type)
                await _debug('stt', 'Transcription completed', transcript_chars=len(transcript))
            if not transcript:
                await _send({'type': 'error', 'error': 'No transcript text available'})
                return
            await _send({'type': 'user_transcript', 'user_transcript': transcript})

            sql_started = time.perf_counter()
            await _debug('sql', 'Generating SQL from transcript')
            sql = await pipeline.generate_sql(transcript, active_resident_id)
            await _debug('sql', 'SQL generated', sql=sql, elapsed_ms=int((time.perf_counter() - sql_started) * 1000))
            await _send({'type': 'sql_generated', 'sql': sql})

            query_started = time.perf_counter()
            rows = pipeline.execute_sql(db, sql)
            await _debug('sql', 'SQL executed', row_count=len(rows), elapsed_ms=int((time.perf_counter() - query_started) * 1000))
            await _send({'type': 'sql_result', 'row_count': len(rows), 'rows_preview': rows[:5]})

            answer_started = time.perf_counter()
            await _debug('answer', 'Generating answer text')
            answer = await pipeline.generate_answer(
                question=transcript,
                resident_id=active_resident_id,
                sql=sql,
                rows=rows,
            )
            await _debug('answer', 'Answer generated', answer_chars=len(answer), elapsed_ms=int((time.perf_counter() - answer_started) * 1000))
            await _send({'type': 'agent_response', 'text': answer})
            await _send({'type': 'audio_start', 'sample_rate_hz': 24000})

            tts_started = time.perf_counter()
            chunk_count = 0
            total_pcm_bytes = 0
            await _debug('tts', 'Starting TTS audio stream')
            async for pcm_chunk in pipeline.stream_tts_pcm(answer):
                chunk_count += 1
                total_pcm_bytes += len(pcm_chunk)
                await _send(
                    {
                        'type': 'audio_chunk',
                        'audio_base64': base64.b64encode(pcm_chunk).decode('ascii'),
                        'sample_rate_hz': 24000,
                    }
                )
            await _debug(
                'tts',
                'TTS audio stream finished',
                chunk_count=chunk_count,
                total_pcm_bytes=total_pcm_bytes,
                elapsed_ms=int((time.perf_counter() - tts_started) * 1000),
            )
            await _send({'type': 'audio_end'})
            await _debug('turn', 'Completed turn', elapsed_ms=int((time.perf_counter() - turn_started) * 1000))
        except Exception as exc:
            await _debug('error', 'Turn failed', detail=str(exc))
            await _send({'type': 'error', 'error': str(exc)})

    try:
        await _send({'type': 'ready', 'resident_id': active_resident_id})
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await _send({'type': 'error', 'error': 'Invalid JSON payload'})
                continue

            msg_type = str(payload.get('type') or '')
            if msg_type == 'ping':
                event_id = str(payload.get('event_id') or '')
                await _send({'type': 'pong', 'event_id': event_id})
                continue
            if msg_type == 'session.start':
                maybe_resident = str(payload.get('resident_id') or '').strip()
                if maybe_resident:
                    active_resident_id = maybe_resident
                await _send({'type': 'session.started', 'resident_id': active_resident_id})
                continue
            if msg_type == 'user_message':
                text_value = str(payload.get('text') or '').strip()
                if not text_value:
                    await _send({'type': 'error', 'error': 'Empty text message'})
                    continue
                await _handle_turn(user_text=text_value)
                continue
            if msg_type == 'user_audio':
                b64_value = str(payload.get('audio_base64') or '').strip()
                if not b64_value:
                    await _send({'type': 'error', 'error': 'audio_base64 is required'})
                    continue
                try:
                    audio = base64.b64decode(b64_value, validate=True)
                except Exception:
                    await _send({'type': 'error', 'error': 'Invalid base64 audio payload'})
                    continue
                mime_type = str(payload.get('mime_type') or 'audio/webm').strip() or 'audio/webm'
                await _handle_turn(audio_bytes=audio, mime_type=mime_type)
                continue

            await _send({'type': 'error', 'error': f'Unsupported message type: {msg_type or "unknown"}'})
    except WebSocketDisconnect:
        pass
    finally:
        db.close()
