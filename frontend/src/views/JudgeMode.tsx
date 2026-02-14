import { useMemo, useRef, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import { isNotImplementedError } from '../lib/apiClient';
import { getSpeechRecognitionCtor, speakText, type SpeechRecognitionLike } from '../lib/speech';
import { useRealtimeState } from '../store/realtimeState';
import type { AgentAskResponse, MergedState } from '../types/api';

interface JudgeModeProps {
  mergedState?: MergedState;
}

export function JudgeMode({ mergedState }: JudgeModeProps) {
  const { activeResidentId, apiClient, notify } = useRealtimeState();
  const [isExercising, setIsExercising] = useState(false);
  const [coachText, setCoachText] = useState('Great posture. Keep a smooth pace and breathe steadily.');
  const [coachVideoUrl, setCoachVideoUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [agentResponse, setAgentResponse] = useState<AgentAskResponse | null>(null);
  const [isListening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const metrics = mergedState?.metrics || {};
  const vision = (mergedState?.vision || {}) as Record<string, unknown>;
  const fall = Boolean(metrics.fallSuspected);
  const speechSupported = Boolean(getSpeechRecognitionCtor());

  const suggestion = useMemo(() => {
    if (!isExercising) return 'Tap Start Walk when ready. Keep the walker close.';
    if (fall) return 'Pause and stabilize before continuing.';
    return 'Excellent! Keep cadence steady and take small controlled steps.';
  }, [fall, isExercising]);

  const playCoach = async (text: string) => {
    setCoachVideoUrl(null);
    try {
      const result = await apiClient.heygenSpeak({ text, residentId: activeResidentId });
      const maybeUrl = extractPlayableUrl(result);
      if (maybeUrl) {
        setCoachVideoUrl(maybeUrl);
      } else {
        speakText(text);
        notify('HeyGen returned no media URL, using browser voice fallback.', 'warn');
      }
    } catch {
      speakText(text);
      notify('HeyGen unavailable, using browser voice fallback.', 'warn');
    }
  };

  const startListening = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      setPrompt(transcript);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  const submitPrompt = async () => {
    const question = prompt.trim();
    if (!question) return;
    try {
      const response = await apiClient.askAgent({ residentId: activeResidentId, question });
      setAgentResponse(response);
      const speakable = response.heygen?.textToSpeak || response.answer;
      playCoach(speakable);
    } catch (error) {
      const fallback = isNotImplementedError(error)
        ? { answer: `Coach fallback: ${question}. Keep going safely!`, citations: [] }
        : { answer: `Temporary fallback response: ${question}`, citations: [] };
      setAgentResponse(fallback);
      speakText(fallback.answer);
      notify('Agent endpoint unavailable. Showing fallback response.', 'warn');
    }
  };

  return (
    <section className="space-y-4 pb-28">
      <div className="rounded-2xl bg-slate-900 p-4 sm:p-6">
        {!isExercising ? (
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-wider text-slate-300">Not Exercising</p>
            <h2 className="text-3xl font-black text-white sm:text-5xl">Ready for your walk?</h2>
            <button
              type="button"
              onClick={() => setIsExercising(true)}
              className="rounded-2xl bg-emerald-600 px-8 py-5 text-2xl font-black text-white shadow-lg"
            >
              Start Walk
            </button>
            <div className="rounded-xl bg-slate-800 p-4 text-slate-100">
              <p className="text-sm font-semibold">Daily Goal Progress</p>
              <p className="mt-1 text-lg font-bold">{Math.min(100, Math.round((Number(metrics.steps || 0) / 500) * 100))}% of 500-step target</p>
              <p className="mt-2 text-sm text-slate-300">{suggestion}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm uppercase tracking-wider text-slate-300">Exercising</p>
              <button type="button" onClick={() => setIsExercising(false)} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white">
                Stop Walk
              </button>
            </div>

            <div className="text-center">
              <p className="text-sm text-slate-300">Step Count</p>
              <p className="text-7xl font-black leading-none text-white sm:text-8xl">{display(metrics.steps)}</p>
            </div>

            <div className={`rounded-xl px-4 py-3 text-center text-xl font-black ${fall ? 'bg-rose-700 text-white' : 'bg-emerald-700 text-white'}`}>
              {fall ? 'Possible fall detected' : 'All good'}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Cadence" value={display(vision.cadenceSpm)} />
              <MetricCard label="StepVar" value={display(vision.stepVar)} />
              <MetricCard label="Tilt Deg" value={display(metrics.tiltDeg)} accent={Number(metrics.tiltDeg || 0) > 25 ? 'warn' : 'normal'} />
              <MetricCard label="Balance" value={display(metrics.balance)} />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-slate-900 p-4 sm:p-6">
        <h3 className="text-2xl font-black text-white">HeyGen Coach</h3>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex min-h-[180px] items-center justify-center rounded-xl border-2 border-dashed border-slate-600 bg-slate-950">
              {coachVideoUrl ? (
                <video src={coachVideoUrl} controls autoPlay className="max-h-[220px] w-full rounded-lg" />
              ) : (
                <p className="text-sm text-slate-400">Reserved avatar/video playback area</p>
              )}
            </div>
            <textarea
              value={coachText}
              onChange={(event) => setCoachText(event.target.value)}
              className="h-24 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"
            />
            <button type="button" onClick={() => playCoach(coachText)} className="w-full rounded-xl bg-sky-600 px-4 py-3 text-lg font-black text-white">
              Play Coach
            </button>
          </div>

          <div className="space-y-3">
            <h4 className="text-lg font-bold text-slate-100">Speak to Coach</h4>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!speechSupported}
                onClick={startListening}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {isListening ? 'Listening...' : 'Use Voice'}
              </button>
              {!speechSupported ? <p className="text-sm text-amber-300">Voice unavailable on this browser, use text input.</p> : null}
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask the coach a question..."
              className="h-24 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"
            />
            <button type="button" onClick={submitPrompt} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">
              Ask Coach
            </button>

            {agentResponse ? (
              <div className="rounded-lg bg-slate-950 p-3 text-sm text-slate-100">
                <p>{agentResponse.answer}</p>
                {agentResponse.citations?.length ? (
                  <p className="mt-2 text-xs text-slate-400">Citations: {agentResponse.citations.slice(0, 3).join(' | ')}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function display(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '-';
}

function extractPlayableUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.url === 'string') return obj.url;
  if (typeof obj.videoUrl === 'string') return obj.videoUrl;
  if (obj.raw && typeof obj.raw === 'object') {
    const nested = obj.raw as Record<string, unknown>;
    if (typeof nested.url === 'string') return nested.url;
    if (typeof nested.videoUrl === 'string') return nested.videoUrl;
    if (typeof nested.download_url === 'string') return nested.download_url;
  }
  return null;
}

