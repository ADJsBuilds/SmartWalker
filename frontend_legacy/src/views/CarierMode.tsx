import { useRef, useState } from 'react';
import { ApiError } from '../lib/apiClient';
import { getSpeechRecognitionCtor, speakText, type SpeechRecognitionLike } from '../lib/speech';
import { useRealtimeState } from '../store/realtimeState';

const ZOOM_PHRASE_REGEX = /zoom\s+my\s+(.+)/i;

export function CarierMode() {
  const { apiClient, notify } = useRealtimeState();
  const [isListening, setListening] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<{ success: boolean; message: string } | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const speechSupported = Boolean(getSpeechRecognitionCtor());

  const startListening = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      notify('Speech recognition is not supported in this browser.', 'warn');
      return;
    }
    if (isLoading) return;
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() || '';
      setListening(false);
      if (!transcript) return;
      const match = transcript.match(ZOOM_PHRASE_REGEX);
      if (!match) {
        setLastResult({ success: false, message: `Say "Zoom my physical therapist" or "Zoom my daughter". You said: "${transcript}"` });
        notify('Say "Zoom my physical therapist" or "Zoom my daughter".', 'warn');
        return;
      }
      setLoading(true);
      setLastResult(null);
      apiClient
        .requestZoomInvite({ phrase: transcript })
        .then((res) => {
          const msg = `Sent Zoom link to ${res.sentTo}.`;
          setLastResult({ success: true, message: msg });
          notify(msg, 'info');
          speakText(msg);
        })
        .catch((err) => {
          const message = err instanceof ApiError && typeof err.details === 'object' && err.details && 'detail' in err.details
            ? String((err.details as { detail: unknown }).detail)
            : err instanceof Error ? err.message : 'Failed to send Zoom invite.';
          setLastResult({ success: false, message });
          notify(message, 'error');
          speakText(`Sorry, ${message}`);
        })
        .finally(() => setLoading(false));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    setLastResult(null);
    rec.start();
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
      <h2 className="text-lg font-semibold text-slate-100">Carier Mode</h2>
      <p className="mt-2 text-sm text-slate-400">
        Say &quot;Zoom my physical therapist&quot; or &quot;Zoom my daughter&quot; to send a meeting link to them.
      </p>
      <div className="mt-6 flex flex-col items-center gap-4">
        {speechSupported ? (
          <button
            type="button"
            onClick={startListening}
            disabled={isLoading}
            className={`rounded-xl px-6 py-4 text-base font-semibold transition ${
              isListening
                ? 'bg-amber-600 text-white'
                : isLoading
                  ? 'cursor-not-allowed bg-slate-700 text-slate-400'
                  : 'bg-sky-600 text-white hover:bg-sky-500'
            }`}
          >
            {isListening ? 'Listening…' : isLoading ? 'Sending…' : 'Hold to speak'}
          </button>
        ) : (
          <p className="text-sm text-amber-200">Speech recognition is not available in this browser.</p>
        )}
        {lastResult && (
          <p className={`max-w-md text-sm ${lastResult.success ? 'text-emerald-300' : 'text-rose-300'}`}>
            {lastResult.message}
          </p>
        )}
      </div>
    </section>
  );
}
