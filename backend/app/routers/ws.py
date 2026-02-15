import asyncio
import base64
import json
import os
import time
from typing import Any, Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

<<<<<<< HEAD
from app.agents.lite_agent import lite_agent_manager
=======
from app.core.config import get_settings
>>>>>>> c61e0a3 (feat: add voice sql pipeline retention and websocket/ingest updates)
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
async def ws_voice_agent(websocket: WebSocket, residentId: Optional[str] = Query(default='r_1')):
    await websocket.accept()
    pipeline = VoiceSqlPipeline()
    settings = get_settings()
    db = SessionLocal()
<<<<<<< HEAD
    active_resident_id = str(residentId or 'r1')
    active_liveavatar_session_id: Optional[str] = None
=======
    allowed_resident_id = str(settings.ingest_allowed_resident_id or 'r_1').strip()
    initial_resident = str(residentId or allowed_resident_id).strip() or allowed_resident_id
    active_resident_id = allowed_resident_id if initial_resident != allowed_resident_id else initial_resident
>>>>>>> c61e0a3 (feat: add voice sql pipeline retention and websocket/ingest updates)

    async def _send(payload: dict[str, Any]) -> None:
        await websocket.send_json(payload)

    async def _debug(stage: str, message: str, **meta: Any) -> None:
        payload: dict[str, Any] = {'type': 'debug', 'stage': stage, 'message': message}
        if meta:
            payload['meta'] = meta
        await _send(payload)

    async def _handle_turn(
        *,
        user_text: Optional[str] = None,
        audio_bytes: Optional[bytes] = None,
        mime_type: str = 'audio/webm',
        client_metrics: Optional[dict[str, Any]] = None,
        liveavatar_session_id: Optional[str] = None,
    ) -> None:
        transcript = (user_text or '').strip()
        effective_liveavatar_session_id = (liveavatar_session_id or '').strip() or None
        turn_started = time.perf_counter()
        timeline_ms: dict[str, Any] = {
            'turn_started_ms': int(time.time() * 1000),
            'speech_end_ms': (client_metrics or {}).get('speech_end_ms'),
            'last_chunk_sent_ms': (client_metrics or {}).get('last_chunk_sent_ms'),
        }
        try:
            if audio_bytes:
                await _debug('stt', 'Starting transcription', mime_type=mime_type, audio_bytes=len(audio_bytes))
                transcript = await pipeline.transcribe_audio(audio_bytes, mime_type=mime_type)
                timeline_ms['stt_final_ms'] = int(time.time() * 1000)
                await _debug('stt', 'Transcription completed', transcript_chars=len(transcript))
            if not transcript:
                await _send({'type': 'error', 'error': 'No transcript text available'})
                return
            await _send({'type': 'user_transcript', 'user_transcript': transcript})

            sql_started = time.perf_counter()
            await _debug('sql', 'Generating SQL from transcript')
            sql = await pipeline.generate_sql(transcript, active_resident_id)
            await _debug(
                'sql',
                'SQL generated',
                sql=sql,
                elapsed_ms=int((time.perf_counter() - sql_started) * 1000),
                intent=pipeline.last_sql_intent,
                template_hit=pipeline.last_sql_template_hit,
                cache_hit=pipeline.last_sql_cache_hit,
                sql_prompt_chars=pipeline.last_sql_prompt_chars,
            )
            await _send({'type': 'sql_generated', 'sql': sql})

            query_started = time.perf_counter()
            rows = pipeline.execute_sql(db, sql, resident_id=active_resident_id)
            await _debug('sql', 'SQL executed', row_count=len(rows), elapsed_ms=int((time.perf_counter() - query_started) * 1000))
            await _send({'type': 'sql_result', 'row_count': len(rows), 'rows_preview': rows[:5]})

            answer_started = time.perf_counter()
            await _debug('answer', 'Generating answer text')
            question_normalized = transcript.lower()
            include_realtime = any(k in question_normalized for k in ('right now', 'currently', 'now', 'at the moment'))
            realtime_summary = merged_state.get(active_resident_id) if include_realtime else None
            answer = await pipeline.generate_answer(
                question=transcript,
                resident_id=active_resident_id,
                sql=sql,
                rows=rows,
                realtime_summary=realtime_summary if isinstance(realtime_summary, dict) else None,
            )
            timeline_ms['llm_response_ready_ms'] = int(time.time() * 1000)
            await _debug(
                'answer',
                'Answer generated',
                answer_chars=len(answer),
                elapsed_ms=int((time.perf_counter() - answer_started) * 1000),
                answer_prompt_chars=pipeline.last_answer_prompt_chars,
            )
            await _send({'type': 'agent_response', 'text': answer})
            timeline_ms['tts_start_ms'] = int(time.time() * 1000)
            await _send({'type': 'audio_start', 'sample_rate_hz': 24000})

            tts_started = time.perf_counter()
            chunk_count = 0
            total_pcm_bytes = 0
            pcm_accumulator = bytearray()
            await _debug('tts', 'Starting TTS audio stream')
            async for pcm_chunk in pipeline.stream_tts_pcm(answer):
                chunk_count += 1
                total_pcm_bytes += len(pcm_chunk)
                pcm_accumulator.extend(pcm_chunk)
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
            if effective_liveavatar_session_id and pcm_accumulator:
                avatar_sync_started = time.perf_counter()
                status = lite_agent_manager.get_status(effective_liveavatar_session_id)
                await _debug(
                    'liveavatar_sync_start',
                    'Forwarding synthesized PCM to LiveAvatar session',
                    session_id=effective_liveavatar_session_id,
                    bytes_total=len(pcm_accumulator),
                    session_exists=bool(status.get('exists')),
                    ws_connected=bool(status.get('ws_connected')),
                    ready=bool(status.get('ready')),
                    session_state=status.get('session_state'),
                )
                try:
                    speak_result = await lite_agent_manager.speak_pcm(
                        effective_liveavatar_session_id,
                        bytes(pcm_accumulator),
                    )
                    if speak_result.get('ok'):
                        await _debug(
                            'liveavatar_sync_ok',
                            'LiveAvatar sync completed',
                            session_id=effective_liveavatar_session_id,
                            chunk_count=speak_result.get('chunk_count'),
                            elapsed_ms=int((time.perf_counter() - avatar_sync_started) * 1000),
                        )
                    else:
                        await _debug(
                            'liveavatar_sync_error',
                            'LiveAvatar sync failed',
                            session_id=effective_liveavatar_session_id,
                            error=speak_result.get('error'),
                            elapsed_ms=int((time.perf_counter() - avatar_sync_started) * 1000),
                        )
                except Exception as sync_exc:
                    await _debug(
                        'liveavatar_sync_error',
                        'LiveAvatar sync raised exception',
                        session_id=effective_liveavatar_session_id,
                        error=str(sync_exc),
                        elapsed_ms=int((time.perf_counter() - avatar_sync_started) * 1000),
                    )
            timeline_ms['turn_completed_ms'] = int(time.time() * 1000)
            timeline_ms['sql_prompt_chars'] = int(pipeline.last_sql_prompt_chars or 0)
            timeline_ms['answer_prompt_chars'] = int(pipeline.last_answer_prompt_chars or 0)
            timeline_ms['template_hit'] = bool(pipeline.last_sql_template_hit)
            timeline_ms['cache_hit'] = bool(pipeline.last_sql_cache_hit)
            await _send({'type': 'latency_metrics', 'metrics': timeline_ms})
            await _debug('turn', 'Completed turn', elapsed_ms=int((time.perf_counter() - turn_started) * 1000))
        except Exception as exc:
            await _debug('error', 'Turn failed', detail=str(exc))
            await _send({'type': 'error', 'error': str(exc)})

    audio_sessions: dict[str, dict[str, Any]] = {}
    active_audio_session_id: Optional[str] = None
    pending_chunk_meta: Optional[dict[str, Any]] = None

    async def _finalize_chunk_session(session_id: str, *, payload: Optional[dict[str, Any]] = None) -> None:
        session = audio_sessions.get(session_id)
        if not session or session.get('finalizing'):
            return
        session['finalizing'] = True
        partial_task: Optional[asyncio.Task[Any]] = session.get('partial_task')
        if partial_task and not partial_task.done():
            partial_task.cancel()
        raw_audio = b''.join(session.get('chunks') or [])
        if not raw_audio:
            await _send({'type': 'error', 'error': 'No audio chunks received before user_audio_end'})
            audio_sessions.pop(session_id, None)
            return
        end_payload = payload or {}
        await _handle_turn(
            audio_bytes=raw_audio,
            mime_type=str(session.get('mime_type') or 'audio/webm'),
            client_metrics={
                'speech_end_ms': end_payload.get('speech_end_ms'),
                'last_chunk_sent_ms': end_payload.get('last_chunk_sent_ms'),
            },
            liveavatar_session_id=str(session.get('liveavatar_session_id') or '').strip() or active_liveavatar_session_id,
        )
        audio_sessions.pop(session_id, None)

    async def _maybe_emit_partial_transcript(session_id: str) -> None:
        session = audio_sessions.get(session_id)
        if not session:
            return
        if session.get('finalizing'):
            return
        if session.get('partial_task') and not session['partial_task'].done():
            return
        chunks = session.get('chunks') or []
        if len(chunks) < 4:
            return
        snapshot = b''.join(chunks)
        if len(snapshot) < 4096:
            return

        async def _run_partial() -> None:
            try:
                partial = await pipeline.transcribe_audio(snapshot, mime_type=str(session.get('mime_type') or 'audio/webm'))
                cleaned = str(partial or '').strip()
                if cleaned and cleaned != session.get('partial_transcript'):
                    session['partial_transcript'] = cleaned
                    await _send({'type': 'user_transcript_partial', 'user_transcript': cleaned})
            except Exception:
                # Partial STT is best effort; final STT on end is authoritative.
                return

        session['partial_task'] = asyncio.create_task(_run_partial())

    try:
        await _send({'type': 'ready', 'resident_id': active_resident_id})
        await _debug('env', 'Process environment snapshot', env=dict(os.environ))
        while True:
            msg = await websocket.receive()
            msg_type = str(msg.get('type') or '')
            if msg_type == 'websocket.disconnect':
                break

            raw_bytes = msg.get('bytes')
            if isinstance(raw_bytes, (bytes, bytearray)):
                if not active_audio_session_id:
                    await _send({'type': 'error', 'error': 'Binary audio chunk received without active user_audio_start'})
                    continue
                session = audio_sessions.get(active_audio_session_id)
                if not session:
                    await _send({'type': 'error', 'error': 'Audio session missing for received chunk'})
                    continue
                session['chunks'].append(bytes(raw_bytes))
                session['bytes_total'] = int(session.get('bytes_total') or 0) + len(raw_bytes)
                if pending_chunk_meta:
                    seq = int(pending_chunk_meta.get('sequence_number') or 0)
                    session['sequence_number'] = max(int(session.get('sequence_number') or 0), seq)
                    pending_chunk_meta.clear()
                if (int(session.get('sequence_number') or 0) % 8) == 0:
                    await _maybe_emit_partial_transcript(active_audio_session_id)
                continue

            raw_text = msg.get('text')
            if not isinstance(raw_text, str):
                continue
            try:
                payload = json.loads(raw_text)
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
                maybe_liveavatar_session_id = str(payload.get('liveavatar_session_id') or '').strip()
                if maybe_resident:
                    if maybe_resident != allowed_resident_id:
                        await _send({'type': 'error', 'error': f'Only resident_id={allowed_resident_id} is allowed in this deployment'})
                        continue
                    active_resident_id = maybe_resident
                if maybe_liveavatar_session_id:
                    active_liveavatar_session_id = maybe_liveavatar_session_id
                await _send(
                    {
                        'type': 'session.started',
                        'resident_id': active_resident_id,
                        'liveavatar_session_id': active_liveavatar_session_id,
                    }
                )
                continue
            if msg_type == 'user_message':
                text_value = str(payload.get('text') or '').strip()
                if not text_value:
                    await _send({'type': 'error', 'error': 'Empty text message'})
                    continue
                turn_liveavatar_session_id = str(payload.get('liveavatar_session_id') or '').strip() or active_liveavatar_session_id
                await _handle_turn(user_text=text_value, liveavatar_session_id=turn_liveavatar_session_id)
                continue
            if msg_type == 'user_audio_start':
                session_id = str(payload.get('session_id') or '').strip()
                if not session_id:
                    await _send({'type': 'error', 'error': 'session_id is required for user_audio_start'})
                    continue
                active_audio_session_id = session_id
                pending_chunk_meta = None
                turn_liveavatar_session_id = str(payload.get('liveavatar_session_id') or '').strip() or active_liveavatar_session_id
                audio_sessions[session_id] = {
                    'mime_type': str(payload.get('codec') or payload.get('mime_type') or 'audio/webm'),
                    'chunks': [],
                    'sequence_number': 0,
                    'bytes_total': 0,
                    'started_at_ms': int(time.time() * 1000),
                    'partial_transcript': '',
                    'partial_task': None,
                    'finalizing': False,
                    'liveavatar_session_id': turn_liveavatar_session_id,
                }
                await _debug(
                    'stt',
                    'Streaming audio session started',
                    session_id=session_id,
                    codec=audio_sessions[session_id]['mime_type'],
                    sample_rate=payload.get('sample_rate'),
                    channels=payload.get('channels'),
                    liveavatar_session_id=turn_liveavatar_session_id,
                )
                continue
            if msg_type == 'user_audio_chunk_meta':
                pending_chunk_meta = {
                    'session_id': str(payload.get('session_id') or ''),
                    'sequence_number': int(payload.get('sequence_number') or 0),
                    'byte_length': int(payload.get('byte_length') or 0),
                }
                continue
            if msg_type == 'user_audio_end':
                session_id = str(payload.get('session_id') or '').strip() or (active_audio_session_id or '')
                if not session_id:
                    await _send({'type': 'error', 'error': 'No active audio session to end'})
                    continue
                await _finalize_chunk_session(session_id, payload=payload)
                if active_audio_session_id == session_id:
                    active_audio_session_id = None
                    pending_chunk_meta = None
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
                turn_liveavatar_session_id = str(payload.get('liveavatar_session_id') or '').strip() or active_liveavatar_session_id
                await _handle_turn(
                    audio_bytes=audio,
                    mime_type=mime_type,
                    client_metrics={
                        'speech_end_ms': payload.get('speech_end_ms'),
                    },
                    liveavatar_session_id=turn_liveavatar_session_id,
                )
                continue

            await _send({'type': 'error', 'error': f'Unsupported message type: {msg_type or "unknown"}'})
    except WebSocketDisconnect:
        pass
    finally:
        db.close()
