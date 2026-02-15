import type { RefObject } from 'react';

interface AvatarViewProps {
  status: string;
  errorText?: string | null;
  logLines: string[];
  onDisconnect: () => void;
  onInterrupt: () => void;
  onStartVoiceAgent: () => void;
  onStopVoiceAgent: () => void;
  onTalkToAgent: () => void;
  voiceAgentStatus: string;
  latestUserTranscript?: string;
  latestAgentResponse?: string;
  isListening?: boolean;
  videoHostRef: RefObject<HTMLDivElement>;
}

export function AvatarView({
  status,
  errorText,
  logLines,
  onDisconnect,
  onInterrupt,
  onStartVoiceAgent,
  onStopVoiceAgent,
  onTalkToAgent,
  voiceAgentStatus,
  latestUserTranscript,
  latestAgentResponse,
  isListening,
  videoHostRef,
}: AvatarViewProps) {
  return (
    <main className="fixed inset-0 flex flex-col bg-black text-white">
      <section className="relative flex-1 p-4 sm:p-6">
        <div ref={videoHostRef} className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-slate-900">
          <p className="text-sm text-slate-300">Status: {status}</p>
        </div>
        {errorText ? <p className="absolute left-8 right-8 top-8 rounded-md bg-rose-800/80 px-3 py-2 text-sm">{errorText}</p> : null}
      </section>
      <section className="space-y-3 px-6 pb-8 pt-2">
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onStartVoiceAgent} className="rounded-xl bg-emerald-600 px-4 py-2 font-bold">
            Start Voice Agent
          </button>
          <button type="button" onClick={onTalkToAgent} className="rounded-xl bg-sky-700 px-4 py-2 font-bold">
            {isListening ? 'Listening...' : 'Tap To Talk'}
          </button>
          <button type="button" onClick={onStopVoiceAgent} className="rounded-xl bg-amber-700 px-4 py-2 font-bold">
            Stop Voice Agent
          </button>
          <button type="button" onClick={onInterrupt} className="rounded-xl bg-rose-700 px-4 py-2 font-bold">
            Interrupt
          </button>
          <button type="button" onClick={onDisconnect} className="rounded-xl bg-slate-700 px-4 py-2 font-bold">
            Disconnect
          </button>
        </div>
        <div className="mx-auto max-h-32 w-full max-w-3xl overflow-auto rounded-xl bg-slate-900/80 p-3 text-xs text-slate-200">
          <p className="mb-1 text-slate-300">Voice Agent: {voiceAgentStatus}</p>
          <p className="mb-1 text-slate-300">You: {latestUserTranscript || '...'}</p>
          <p className="mb-2 text-slate-300">Agent: {latestAgentResponse || '...'}</p>
          {logLines.length ? logLines.map((line, idx) => <p key={`${idx}-${line}`}>{line}</p>) : <p>No events yet.</p>}
        </div>
      </section>
    </main>
  );
}

