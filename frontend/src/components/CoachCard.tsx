import { useMemo, useRef, useState } from 'react';
import { getSpeechRecognitionCtor, speakText, type SpeechRecognitionLike } from '../lib/speech';
import { useRealtimeState } from '../store/realtimeState';

interface CoachCardProps {
  residentId: string;
  metrics: Record<string, unknown>;
  initialTalkOpen?: boolean;
}

export function CoachCard({ residentId, metrics, initialTalkOpen = false }: CoachCardProps) {
  const { apiClient, notify } = useRealtimeState();
  const [askText, setAskText] = useState('');
  const [answer, setAnswer] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [talkOpen, setTalkOpen] = useState(initialTalkOpen);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported = Boolean(getSpeechRecognitionCtor());

  const motivationalText = useMemo(() => {
    const steps = Number(metrics.steps || 0);
    const fall = Boolean(metrics.fallSuspected);
    if (fall) return 'Pause, take a breath, and make sure you are stable before the next step.';
    if (steps < 50) return 'Great start. Keep your steps smooth and steady.';
    if (steps < 200) return 'Excellent walking rhythm. Keep up this safe pace.';
    return 'Amazing progress. You are moving confidently and safely.';
  }, [metrics.fallSuspected, metrics.steps]);

  const playFromHeyGen = async (text: string): Promise<boolean> => {
    try {
      const response = await apiClient.heygenSpeak({ text, residentId });
      const media = extractPlayableUrl(response);
      if (media) {
        setVideoUrl(media);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handlePlayCoach = async () => {
    setVideoUrl(null);
    const ok = await playFromHeyGen(motivationalText);
    if (!ok) {
      speakText(motivationalText);
      notify('Coach fallback: browser voice used.', 'warn');
    }
  };

  const handleAskCoach = async () => {
    const question = askText.trim();
    if (!question) return;
    try {
      const result = await apiClient.askAgent({ residentId, question });
      const short = String(result.answer || '').slice(0, 360);
      setAnswer(short || 'Coach did not return text.');
      const speakable = result.heygen?.textToSpeak || short;
      const ok = await playFromHeyGen(speakable);
      if (!ok) speakText(speakable);
    } catch {
      const fallback = 'I am here with you. Keep your posture upright and pace controlled.';
      setAnswer(fallback);
      speakText(fallback);
      notify('Agent unavailable: using fallback coaching.', 'warn');
    }
  };

  const startVoiceInput = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      setAskText(event.results[0]?.[0]?.transcript || '');
      setIsListening(false);
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    setIsListening(true);
    rec.start();
  };

  return (
    <section className="rounded-3xl bg-slate-900/90 p-5">
      <h3 className="text-2xl font-black text-white">Coach</h3>
      <div className="mt-3 space-y-3">
        <div className="flex min-h-[170px] items-center justify-center rounded-2xl bg-slate-950">
          {videoUrl ? <video src={videoUrl} controls autoPlay className="w-full rounded-xl" /> : <p className="text-slate-400">Avatar area</p>}
        </div>

        <button type="button" onClick={handlePlayCoach} className="w-full rounded-2xl bg-sky-600 px-5 py-4 text-xl font-black text-white">
          Play Coach
        </button>

        <button type="button" onClick={() => setTalkOpen((p) => !p)} className="w-full rounded-2xl bg-indigo-600 px-5 py-4 text-xl font-black text-white">
          Talk to Coach
        </button>

        {talkOpen ? (
          <div className="space-y-2 rounded-2xl bg-slate-950 p-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startVoiceInput}
                disabled={!speechSupported}
                className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {isListening ? 'Listening...' : 'Use Voice'}
              </button>
              {!speechSupported ? <p className="text-xs text-amber-300">Voice unavailable, use text.</p> : null}
            </div>
            <textarea
              value={askText}
              onChange={(event) => setAskText(event.target.value)}
              placeholder="Ask the coach..."
              className="h-24 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
            />
            <button type="button" onClick={handleAskCoach} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
              Send
            </button>
            {answer ? <p className="rounded-lg bg-slate-900 p-3 text-sm text-slate-100">{answer}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function extractPlayableUrl(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const obj = response as Record<string, unknown>;
  if (typeof obj.videoUrl === 'string') return obj.videoUrl;
  if (typeof obj.video_url === 'string') return obj.video_url;
  if (typeof obj.url === 'string') return obj.url;
  if (obj.raw && typeof obj.raw === 'object') {
    const raw = obj.raw as Record<string, unknown>;
    if (typeof raw.videoUrl === 'string') return raw.videoUrl;
    if (typeof raw.video_url === 'string') return raw.video_url;
    if (typeof raw.url === 'string') return raw.url;
    if (raw.data && typeof raw.data === 'object') {
      const data = raw.data as Record<string, unknown>;
      if (typeof data.videoUrl === 'string') return data.videoUrl;
      if (typeof data.video_url === 'string') return data.video_url;
      if (typeof data.url === 'string') return data.url;
    }
  }
  return null;
}
