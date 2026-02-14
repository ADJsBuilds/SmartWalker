import { useEffect, useMemo, useRef, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import { isNotImplementedError } from '../lib/apiClient';
import { LiveAgentController } from '../lib/liveAgent';
import { getSpeechRecognitionCtor, speakText, type SpeechRecognitionLike } from '../lib/speech';
import { useRealtimeState } from '../store/realtimeState';
import type { AgentAskResponse, MergedState } from '../types/api';

interface JudgeModeProps {
  mergedState?: MergedState;
}

export function JudgeMode({ mergedState }: JudgeModeProps) {
  const { activeResidentId, apiClient, notify } = useRealtimeState();
  const liveAgentIntro = 'Good morning! I am your AI physical therapist to walk you through your exercises.';
  const [isExercising, setIsExercising] = useState(false);
  const [coachText, setCoachText] = useState('Great posture. Keep a smooth pace and breathe steadily.');
  const [prompt, setPrompt] = useState('');
  const [agentResponse, setAgentResponse] = useState<AgentAskResponse | null>(null);
  const [isListening, setListening] = useState(false);
  const [liveAgentStatus, setLiveAgentStatus] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');
  const [liveAgentTranscript, setLiveAgentTranscript] = useState<string>('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const coachVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveAgentRef = useRef<LiveAgentController | null>(null);

  const metrics = mergedState?.metrics || {};
  const vision = (mergedState?.vision || {}) as Record<string, unknown>;
  const fall = Boolean(metrics.fallSuspected);
  const speechSupported = Boolean(getSpeechRecognitionCtor());

  const suggestion = useMemo(() => {
    if (!isExercising) return 'Tap Start Walk when ready. Keep the walker close.';
    if (fall) return 'Pause and stabilize before continuing.';
    return 'Excellent! Keep cadence steady and take small controlled steps.';
  }, [fall, isExercising]);

  useEffect(() => {
    liveAgentRef.current = new LiveAgentController(apiClient);
    return () => {
      liveAgentRef.current?.disconnect();
      liveAgentRef.current = null;
    };
  }, [apiClient]);

  const connectLiveAgent = async () => {
    if (!coachVideoRef.current) {
      notify('LiveAgent video element not ready yet.', 'warn');
      return;
    }
    try {
      const bootstrap = await apiClient.bootstrapLiveAgentSession({
        residentId: activeResidentId,
        mode: 'FULL',
        interactivityType: 'PUSH_TO_TALK',
        language: 'en',
      });
      if (!bootstrap.ok || !bootstrap.livekitUrl || !bootstrap.livekitClientToken) {
        notify(bootstrap.error || 'Failed to bootstrap LiveAgent session.', 'warn');
        return;
      }

      await liveAgentRef.current?.connectWithLiveKit(bootstrap.livekitUrl, bootstrap.livekitClientToken, coachVideoRef.current, {
        onStatus: setLiveAgentStatus,
        onAgentTranscript: (text, speaker) => setLiveAgentTranscript(`${speaker}: ${text}`),
        onError: (message) => notify(message, 'warn'),
      }, {
        sessionId: bootstrap.sessionId,
        sessionAccessToken: bootstrap.sessionAccessToken,
      });
      const introPlayed = await liveAgentRef.current?.speakText(liveAgentIntro);
      notify('LiveAgent connected.', 'info');
      if (!introPlayed) {
        notify('LiveAgent connected, but intro speech did not play.', 'warn');
      }
    } catch {
      notify('LiveAgent unavailable. Falling back to browser voice.', 'warn');
      setLiveAgentStatus('error');
    }
  };

  const disconnectLiveAgent = async () => {
    await liveAgentRef.current?.disconnect();
    setLiveAgentStatus('disconnected');
  };

  const playCoach = async (text: string) => {
    const cadence = Number(vision.cadenceSpm);
    const desiredGoal = fall ? 'safety_warning' : Number(metrics.tiltDeg || 0) > 20 ? 'correct_posture' : 'encourage';
    let coachScript = text.trim();
    try {
      const generated = await apiClient.generateCoachScript({
        residentId: activeResidentId,
        goal: desiredGoal,
        tone: fall ? 'calm' : 'energetic',
        userPrompt: text.trim() || undefined,
        context: {
          steps: Number(vision.stepCount ?? metrics.steps ?? 0),
          tiltDeg: Number(metrics.tiltDeg || 0),
          balance: Number(metrics.balance || 0),
          cadence: Number.isFinite(cadence) ? cadence : undefined,
          fallSuspected: fall,
          sessionPhase: isExercising ? 'walking' : 'idle',
        },
      });
      if (generated.script?.trim()) {
        coachScript = generated.script.trim();
        setCoachText(generated.script.trim());
      }
    } catch {
      // Keep manual text as fallback if script generation fails.
    }

    const usedLiveAvatar = await liveAgentRef.current?.speakText(coachScript);
    if (usedLiveAvatar) return;
    speakText(coachScript);
    if (!liveAgentRef.current?.isConnected || !usedLiveAvatar) {
      notify('LiveAgent not connected. Used browser voice fallback.', 'warn');
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
      const generated = await apiClient.generateCoachScript({
        residentId: activeResidentId,
        goal: 'answer_question',
        tone: 'calm',
        userPrompt: question,
        context: {
          steps: Number(vision.stepCount ?? metrics.steps ?? 0),
          tiltDeg: Number(metrics.tiltDeg || 0),
          balance: Number(metrics.balance || 0),
          cadence: Number(vision.cadenceSpm || 0),
          fallSuspected: fall,
          sessionPhase: isExercising ? 'walking' : 'idle',
        },
      });
      const speakable = generated.script || question;
      setAgentResponse({ answer: speakable, citations: [] });
      const usedLiveAvatar = await liveAgentRef.current?.speakText(speakable);
      if (!usedLiveAvatar) speakText(speakable);
    } catch (error) {
      try {
        const response = await apiClient.askAgent({ residentId: activeResidentId, question });
        setAgentResponse(response);
        const speakable = response.heygen?.textToSpeak || response.answer;
        const usedLiveAvatar = await liveAgentRef.current?.speakText(speakable);
        if (!usedLiveAvatar) speakText(speakable);
      } catch (secondaryError) {
        const fallback = isNotImplementedError(secondaryError)
          ? { answer: `Coach fallback: ${question}. Keep going safely!`, citations: [] }
          : { answer: `Temporary fallback response: ${question}`, citations: [] };
        setAgentResponse(fallback);
        const usedLiveAvatar = await liveAgentRef.current?.speakText(fallback.answer);
        if (!usedLiveAvatar) speakText(fallback.answer);
        notify('Agent endpoint unavailable. Showing fallback response.', 'warn');
      }
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
              <p className="mt-1 text-lg font-bold">{Math.min(100, Math.round((Number(vision.stepCount ?? metrics.steps ?? 0) / 500) * 100))}% of 500-step target</p>
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
              <p className="text-sm text-slate-300">Step Count (Camera)</p>
              <p className="text-7xl font-black leading-none text-white sm:text-8xl">{display(vision.stepCount ?? metrics.steps)}</p>
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
              <video ref={coachVideoRef} autoPlay playsInline controls muted={false} className="max-h-[220px] w-full rounded-lg bg-black" />
            </div>
            <p className="text-xs text-slate-300">LiveAgent status: <span className="font-bold">{liveAgentStatus}</span></p>
            {liveAgentTranscript ? <p className="text-xs text-slate-400">Last transcript: {liveAgentTranscript}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={connectLiveAgent} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
                Connect LiveAgent
              </button>
              <button type="button" onClick={disconnectLiveAgent} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-bold text-white">
                Disconnect
              </button>
              <button
                type="button"
                disabled={liveAgentStatus !== 'connected'}
                onMouseDown={() => liveAgentRef.current?.startListening()}
                onMouseUp={() => liveAgentRef.current?.stopListening()}
                onTouchStart={() => liveAgentRef.current?.startListening()}
                onTouchEnd={() => liveAgentRef.current?.stopListening()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Hold to Talk
              </button>
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

