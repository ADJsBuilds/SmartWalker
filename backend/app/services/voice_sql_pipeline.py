import json
import re
import time
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings


_SCHEMA_CONTEXT = """
Dialect: PostgreSQL 16+

Tables:
- residents(id, name, created_at)
- clinician_documents(id, resident_id, filename, filepath, uploaded_at, extracted_text, source_type)
- document_chunks(id, doc_id, resident_id, chunk_index, text)
- walking_sessions(id, resident_id, start_ts, end_ts, summary_json)
- metric_samples(id, resident_id, ts, walker_json, vision_json, merged_json)
- ingest_events(id, resident_id, ts, event_type, severity, payload_json, created_at)
- hourly_metric_rollups(id, resident_id, bucket_start_ts, date, sample_count, steps_max, cadence_sum, cadence_count, step_var_sum, step_var_count, fall_count, tilt_spike_count, heavy_lean_count, inactivity_count, active_seconds, updated_at)
- daily_metric_rollups(id, resident_id, date, sample_count, steps_max, cadence_sum, cadence_count, step_var_sum, step_var_count, fall_count, tilt_spike_count, heavy_lean_count, inactivity_count, active_seconds, updated_at)
- exercise_metric_samples(
  id, resident_id, camera_id, ts, fall_suspected, fall_count, total_time_on_ground_seconds,
  posture_state, step_count, cadence_spm, avg_cadence_spm, step_time_cv, step_time_mean,
  activity_state, asymmetry_index, fall_risk_level, fall_risk_score, fog_status, fog_episodes,
  fog_duration_seconds, person_detected, confidence, source_fps, frame_id, steps_merged, tilt_deg, step_var, created_at
)

Epoch integer columns:
- walking_sessions.start_ts, walking_sessions.end_ts
- metric_samples.ts, ingest_events.ts
- hourly_metric_rollups.bucket_start_ts, exercise_metric_samples.ts
Never call DATE(...) directly on these integer columns.
Use to_timestamp(column)::date for date comparisons.
""".strip()

_SCHEMA_ACTIVITY = """
Tables:
- exercise_metric_samples(resident_id, ts, step_count, steps_merged, cadence_spm, step_var, fall_suspected, activity_state)
- daily_metric_rollups(resident_id, date, sample_count, steps_max, cadence_sum, cadence_count, fall_count)
""".strip()

_SCHEMA_SAFETY = """
Tables:
- ingest_events(resident_id, ts, event_type, severity, payload_json, created_at)
- hourly_metric_rollups(resident_id, bucket_start_ts, date, fall_count, tilt_spike_count, heavy_lean_count, inactivity_count)
- daily_metric_rollups(resident_id, date, fall_count, tilt_spike_count, heavy_lean_count, inactivity_count)
""".strip()

_SCHEMA_SESSION = """
Tables:
- walking_sessions(resident_id, start_ts, end_ts, summary_json)
- exercise_metric_samples(resident_id, ts, steps_merged, step_count, cadence_spm, activity_state, fall_suspected)
""".strip()

_SQL_CACHE: Dict[str, tuple[float, str]] = {}


def _extract_output_text(payload: Dict[str, Any]) -> str:
    direct = payload.get('output_text')
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    output = payload.get('output')
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get('content')
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                text_value = part.get('text') or part.get('output_text')
                if isinstance(text_value, str) and text_value.strip():
                    return text_value.strip()
    return ''


def _normalize_postgres_epoch_date_usage(sql: str) -> str:
    """
    Guardrail for common LLM SQL mistakes on epoch integer fields.
    Rewrites DATE(epoch_int_col) to to_timestamp(epoch_int_col)::date.
    """
    normalized = sql
    epoch_cols = [
        'start_ts',
        'end_ts',
        'ts',
        'bucket_start_ts',
    ]
    for col in epoch_cols:
        pattern = re.compile(rf'DATE\s*\(\s*([A-Za-z_][\w]*\.)?{col}\s*\)', re.IGNORECASE)
        normalized = pattern.sub(lambda m: f"to_timestamp({m.group(0)[m.group(0).find('(')+1:m.group(0).rfind(')')].strip()})::date", normalized)
    return normalized


def _normalize_question(question: str) -> str:
    return ' '.join(str(question or '').strip().lower().split())


def _classify_question_intent(question: str) -> str:
    q = _normalize_question(question)
    if any(k in q for k in ('fall', 'trip', 'tilt', 'risk', 'safe', 'safety', 'inactivity')):
        return 'safety'
    if any(k in q for k in ('session', 'walk duration', 'how long', 'workout')):
        return 'session'
    return 'activity'


def _schema_for_intent(intent: str) -> str:
    if intent == 'safety':
        return _SCHEMA_SAFETY
    if intent == 'session':
        return _SCHEMA_SESSION
    return _SCHEMA_ACTIVITY


def _template_sql(question: str, resident_id: str) -> Optional[str]:
    q = _normalize_question(question)
    esc_id = resident_id.replace("'", "''")
    asks_tilt_degree = 'tilt degree' in q or ('tilt' in q and any(k in q for k in ('what is', 'current', 'latest')))
    if asks_tilt_degree:
        if 'today' in q:
            return (
                "SELECT tilt_deg AS tilt_degree, ts "
                f"FROM exercise_metric_samples WHERE resident_id = '{esc_id}' "
                "AND tilt_deg IS NOT NULL AND to_timestamp(ts)::date = CURRENT_DATE "
                "ORDER BY ts DESC LIMIT 1"
            )
        return (
            "SELECT tilt_deg AS tilt_degree, ts "
            f"FROM exercise_metric_samples WHERE resident_id = '{esc_id}' "
            "AND tilt_deg IS NOT NULL "
            "ORDER BY ts DESC LIMIT 1"
        )
    if ('how many' in q or 'count' in q) and 'step' in q and 'today' in q:
        return (
            "SELECT "
            "COALESCE(MAX(steps_merged), MAX(step_count), 0) AS steps_today, "
            "COUNT(*) AS samples_today "
            f"FROM exercise_metric_samples WHERE resident_id = '{esc_id}' "
            "AND to_timestamp(ts)::date = CURRENT_DATE"
        )
    if 'fall' in q and 'today' in q:
        return (
            "SELECT "
            "COUNT(*) FILTER (WHERE fall_suspected) AS fall_suspected_samples_today, "
            "COALESCE(MAX(fall_count), 0) AS fall_count_today "
            f"FROM exercise_metric_samples WHERE resident_id = '{esc_id}' "
            "AND to_timestamp(ts)::date = CURRENT_DATE"
        )
    return None


class VoiceSqlPipeline:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.last_sql_prompt_chars = 0
        self.last_answer_prompt_chars = 0
        self.last_sql_intent = 'activity'
        self.last_sql_cache_hit = False
        self.last_sql_template_hit = False

    def _headers(self) -> Dict[str, str]:
        api_key = (self.settings.openai_api_key or '').strip()
        return {
            'Authorization': f'Bearer {api_key}',
        }

    def _base_url(self) -> str:
        return (self.settings.openai_base_url or 'https://api.openai.com/v1').rstrip('/')

    @staticmethod
    def _extract_http_error(exc: httpx.HTTPStatusError) -> str:
        status = exc.response.status_code
        body = (exc.response.text or '').strip()
        if len(body) > 1200:
            body = body[:1200] + '...'
        return f'OpenAI HTTP {status}: {body or "no response body"}'

    async def transcribe_audio(self, audio_bytes: bytes, mime_type: str = 'audio/webm') -> str:
        api_key = (self.settings.openai_api_key or '').strip()
        if not api_key:
            raise RuntimeError('OPENAI_API_KEY is not configured')
        if not audio_bytes:
            return ''

        model = (self.settings.openai_stt_model or 'gpt-4o-transcribe').strip()
        files = {'file': ('speech_input.webm', audio_bytes, mime_type)}
        data = {'model': model}
        url = f'{self._base_url()}/audio/transcriptions'
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            try:
                response = await client.post(url, headers=self._headers(), files=files, data=data)
                response.raise_for_status()
                payload = response.json()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(self._extract_http_error(exc)) from exc
        transcript = payload.get('text') if isinstance(payload, dict) else ''
        return str(transcript or '').strip()

    async def generate_sql(self, question: str, resident_id: str) -> str:
        api_key = (self.settings.openai_api_key or '').strip()
        if not api_key:
            raise RuntimeError('OPENAI_API_KEY is not configured')
        model = (self.settings.openai_sql_model or 'gpt-5-mini').strip()
        self.last_sql_cache_hit = False
        self.last_sql_template_hit = False
        self.last_sql_intent = _classify_question_intent(question)
        if self.settings.openai_enable_template_sql:
            templated = _template_sql(question, resident_id)
            if templated:
                self.last_sql_template_hit = True
                return _normalize_postgres_epoch_date_usage(templated)
        cache_key = f"{resident_id}:{_normalize_question(question)}:{self.last_sql_intent}"
        cache_ttl = max(0, int(self.settings.openai_sql_cache_ttl_seconds or 0))
        if cache_ttl > 0:
            cached = _SQL_CACHE.get(cache_key)
            now = time.time()
            if cached and (now - cached[0]) <= cache_ttl:
                self.last_sql_cache_hit = True
                return cached[1]
        instruction = (
            "You are a text-to-SQL generator. Output JSON only with shape "
            '{"sql":"...","summary":"..."}. '
            "Generate one SQL query for PostgreSQL using the provided schema. "
            "Prefer resident-filtered queries using resident_id when relevant. "
            "Use simple SQL structure first: single SELECT with straightforward WHERE/ORDER BY/LIMIT. "
            "Avoid deeply nested subqueries unless strictly necessary. "
            "Use PostgreSQL date/time syntax only (e.g., CURRENT_DATE, NOW(), DATE(column), column::date). "
            "Never use SQLite-specific functions like date('now', 'localtime')."
        )
        postgres_hints = (
            "PostgreSQL hints:\\n"
            "- Today filter: DATE(created_at) = CURRENT_DATE\\n"
            "- Recent window: ts >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')\\n"
            "- IMPORTANT: start_ts/end_ts/ts/bucket_start_ts are epoch INTEGERs. For date compare use to_timestamp(col)::date\\n"
            "- Do NOT write DATE(start_ts) or DATE(ts)\\n"
            "- Resident filter: resident_id = '<resident_id>'\\n"
            "- Keep output small with LIMIT 50 unless aggregate query."
        )
        user_text = (
            f"resident_id: {resident_id}\n"
            f"question: {question}\n\n"
            f"{postgres_hints}\n\n"
            f"schema:\n{_schema_for_intent(self.last_sql_intent)}"
        )
        self.last_sql_prompt_chars = len(user_text) + len(instruction)
        payload = {
            'model': model,
            'input': [
                {'role': 'system', 'content': instruction},
                {'role': 'user', 'content': user_text},
            ],
        }
        url = f'{self._base_url()}/responses'
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
            try:
                response = await client.post(url, headers={**self._headers(), 'Content-Type': 'application/json'}, json=payload)
                response.raise_for_status()
                raw = response.json()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(self._extract_http_error(exc)) from exc
        output_text = _extract_output_text(raw)
        if not output_text:
            raise RuntimeError('SQL generation returned empty output')

        parsed: Optional[Dict[str, Any]] = None
        try:
            parsed = json.loads(output_text)
        except json.JSONDecodeError:
            first = output_text.find('{')
            last = output_text.rfind('}')
            if first != -1 and last != -1 and last > first:
                parsed = json.loads(output_text[first : last + 1])
        if not isinstance(parsed, dict):
            raise RuntimeError('Unable to parse SQL generation response as JSON')
        sql = str(parsed.get('sql') or '').strip().rstrip(';')
        if not sql:
            raise RuntimeError('Generated SQL is empty')
        normalized_sql = _normalize_postgres_epoch_date_usage(sql)
        if cache_ttl > 0:
            _SQL_CACHE[cache_key] = (time.time(), normalized_sql)
        return normalized_sql

    def execute_sql(self, db: Session, sql: str, resident_id: Optional[str] = None) -> List[Dict[str, Any]]:
        sql = _normalize_postgres_epoch_date_usage(sql)
        lowered = sql.lower()
        if not lowered.strip().startswith('select'):
            raise RuntimeError('Only SELECT queries are allowed in voice pipeline')
        if resident_id:
            rid = str(resident_id).strip().replace("'", "''")
            if 'resident_id' not in lowered:
                raise RuntimeError('Generated SQL missing resident_id filter for single-resident mode')
            if f"'{rid.lower()}'" not in lowered:
                raise RuntimeError('Generated SQL does not target active resident_id')
        try:
            result = db.execute(text(sql))
        except SQLAlchemyError as exc:
            raise RuntimeError(f'SQL execution failed: {exc}') from exc

        if not result.returns_rows:
            db.commit()
            return [{'rows_affected': int(result.rowcount or 0)}]

        rows = result.fetchmany(max(1, int(self.settings.openai_max_rows_per_query or 30)))
        keys = list(result.keys())
        output: List[Dict[str, Any]] = []
        for row in rows:
            row_map = {}
            for key in keys:
                value = row._mapping.get(key)
                if isinstance(value, (str, int, float, bool)) or value is None:
                    row_map[str(key)] = value
                else:
                    row_map[str(key)] = str(value)
            output.append(row_map)
        return output

    async def generate_answer(
        self,
        *,
        question: str,
        resident_id: str,
        sql: str,
        rows: List[Dict[str, Any]],
        realtime_summary: Optional[Dict[str, Any]] = None,
    ) -> str:
        api_key = (self.settings.openai_api_key or '').strip()
        if not api_key:
            raise RuntimeError('OPENAI_API_KEY is not configured')
        model = (self.settings.openai_answer_model or 'gpt-5').strip()
        system = (
            "Hey! You are a concise but friendly physical therapy assistant for SmartWalker. "
            "Your job is to help people with their physical therapy treatments. "
            "Some questions require an Answer based on SQL results only, while others require more nuance."
            "Make sure that all data-based questions are only based on SQL results. "
            "If you see a trend in the data (especially one which is positive) say so! "
            "Be friendly and encouraging towards your users."
            "Doctor's Notes: If weight exceeds 30kg, say something, advise the user to try and put a little less weight."
            "If you detect a fall, alert the user that you have detected a fall. Ask if they are all right and if they need help"
            "If someone reaches their goal for the day, announce that and congradulate them"
        )
        bounded_rows = rows[: max(1, int(self.settings.openai_max_rows_per_query or 30))]
        user = (
            f"resident_id: {resident_id}\n"
            f"question: {question}\n"
            f"sql: {sql}\n"
            + (
                f"realtime_summary: {json.dumps(realtime_summary, ensure_ascii=True)}\n"
                if isinstance(realtime_summary, dict) and realtime_summary
                else ''
            )
            + f"rows: {json.dumps(bounded_rows, ensure_ascii=True)}\n\n"
            "Return 2-4 short sentences that are easy to speak aloud."
        )
        self.last_answer_prompt_chars = len(system) + len(user)
        payload = {
            'model': model,
            'input': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': user},
            ],
        }
        url = f'{self._base_url()}/responses'
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            try:
                response = await client.post(url, headers={**self._headers(), 'Content-Type': 'application/json'}, json=payload)
                response.raise_for_status()
                raw = response.json()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(self._extract_http_error(exc)) from exc
        answer = _extract_output_text(raw).strip()
        if not answer:
            return 'I could not find enough data to answer that confidently yet.'
        return answer

    async def stream_tts_pcm(self, text_value: str) -> AsyncIterator[bytes]:
        api_key = (self.settings.openai_api_key or '').strip()
        if not api_key:
            raise RuntimeError('OPENAI_API_KEY is not configured')
        model = (self.settings.openai_tts_model or 'gpt-4o-mini-tts').strip()
        voice = (self.settings.openai_tts_voice or 'nova').strip()
        payload = {
            'model': model,
            'voice': voice,
            'input': text_value,
            'response_format': 'pcm',
        }
        url = f'{self._base_url()}/audio/speech'
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            try:
                async with client.stream(
                    'POST',
                    url,
                    headers={**self._headers(), 'Content-Type': 'application/json'},
                    json=payload,
                ) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        if chunk:
                            yield chunk
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(self._extract_http_error(exc)) from exc
