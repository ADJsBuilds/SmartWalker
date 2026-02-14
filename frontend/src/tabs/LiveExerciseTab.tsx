import { useMemo, useRef, useState } from 'react';
import { isNotImplementedError } from '../lib/apiClient';
import { getSpeechRecognitionCtor, type SpeechRecognitionLike, speakText } from '../lib/speech';
import { MetricCard } from '../components/MetricCard';
import { useAppState } from '../state/AppStateContext';
import type { AgentAskResponse, MergedState } from '../types/api';

interface LiveExerciseTabProps {
  residentId: string;
  mergedState?: MergedState;
}

export function LiveExerciseTab({ residentId, mergedState }: LiveExerciseTabProps) {
  const { apiClient } = useAppState();
  const [isExercising, setExercising] = useState(false);
  const [motivationText, setMotivationText] = useState('You are doing great. Keep a steady pace and breathe smoothly.');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentAnswer, setAgentAnswer] = useState<AgentAskResponse | null>(null);
  const [agentNotice, setAgentNotice] = useState<string | null>(null);
  const [isListening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const metrics = mergedState?.metrics || {};
  const steps = Number(metrics.steps || 0);
  const fall = Boolean(metrics.fallSuspected);

  const speechSupported = Boolean(getSpeechRecognitionCtor());

  const exerciseHeader = useMemo(
    () => (isExercising ? 'During Exercise' : 'Not Exercising'),
    [isExercising],
  );

  const onPlayMotivation = async () => {
    try {
      await apiClient.heygenSpeak({ text: motivationText, residentId });
    } catch {
      speakText(motivationText);
      setAgentNotice('HeyGen unavailable. Used browser speech fallback.');
    }
  };

  const onStartListening = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      setAgentPrompt(transcript);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  const onSubmitPrompt = async () => {
    setAgentNotice(null);
    try {
      const response = await apiClient.askAgent({ residentId, question: agentPrompt });
      setAgentAnswer(response);
      const textToSpeak = response.heygen?.textToSpeak || response.answer;
      try {
        await apiClient.heygenSpeak({ text: textToSpeak, residentId });
      } catch {
        speakText(textToSpeak);
      }
    } catch (error) {
      if (isNotImplementedError(error)) {
        setAgentNotice('Agent endpoint not implemented yet. Showing manual fallback response.');
        const fallback = {
          answer: `Manual fallback: ${agentPrompt || 'No prompt provided'}`,
          citations: [],
        };
        setAgentAnswer(fallback);
        speakText(fallback.answer);
        return;
      }
      setAgentNotice(error instanceof Error ? error.message : 'Agent request failed.');
      const fallback = {
        answer: `Local fallback response: Please continue exercise safely. Question was: ${agentPrompt}`,
        citations: [],
      };
      setAgentAnswer(fallback);
      speakText(fallback.answer);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-2xl font-black text-white">{exerciseHeader}</h3>
          <button
            type="button"
            onClick={() => setExercising((prev) => !prev)}
            className={`rounded-xl px-6 py-3 text-lg font-extrabold text-white ${isExercising ? 'bg-rose-600' : 'bg-emerald-600'}`}
          >
            {isExercising ? 'Stop Exercise' : 'Start Exercise'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Step Count" value={steps} accent="good" />
          <MetricCard label="Cadence SPM" value={numberOrDash((mergedState?.vision as Record<string, unknown> | undefined)?.cadenceSpm)} />
          <MetricCard label="Step Var" value={numberOrDash((mergedState?.vision as Record<string, unknown> | undefined)?.stepVar)} />
          <MetricCard label="Tilt Deg" value={numberOrDash(metrics.tiltDeg)} accent={Number(metrics.tiltDeg || 0) > 25 ? 'warn' : 'normal'} />
          <MetricCard label="Balance" value={numberOrDash(metrics.balance)} accent={fall ? 'danger' : 'normal'} />
        </div>

        <div className={`mt-4 rounded-xl px-4 py-3 text-xl font-black ${fall ? 'bg-rose-700 text-white' : 'bg-emerald-700 text-white'}`}>
          {fall ? 'FALL ALERT - ASSIST IMMEDIATELY' : 'No fall currently detected'}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <h4 className="text-lg font-bold text-white">Motivational Panel</h4>
          <textarea
            value={motivationText}
            onChange={(event) => setMotivationText(event.target.value)}
            className="mt-3 h-28 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"
          />
          <button type="button" onClick={onPlayMotivation} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">
            Play Motivation
          </button>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <h4 className="text-lg font-bold text-white">Speak to Chat</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!speechSupported}
              onClick={onStartListening}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {isListening ? 'Listening...' : 'Start Voice Input'}
            </button>
            {!speechSupported ? <p className="text-sm text-amber-300">SpeechRecognition unavailable, use text input fallback.</p> : null}
          </div>

          <textarea
            value={agentPrompt}
            onChange={(event) => setAgentPrompt(event.target.value)}
            placeholder="Ask the coach or agent..."
            className="mt-3 h-24 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100"
          />
          <button type="button" onClick={onSubmitPrompt} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">
            Send to Agent
          </button>

          {agentNotice ? <p className="mt-3 rounded-lg bg-slate-800 p-2 text-sm text-amber-300">{agentNotice}</p> : null}
          {agentAnswer ? (
            <div className="mt-3 rounded-lg bg-slate-950 p-3">
              <p className="text-sm text-slate-100">{agentAnswer.answer}</p>
              {agentAnswer.citations?.length ? (
                <ul className="mt-2 list-disc pl-6 text-xs text-slate-400">
                  {agentAnswer.citations.map((citation, idx) => (
                    <li key={`${citation}-${idx}`}>{citation}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function numberOrDash(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num * 100) / 100) : '-';
}
