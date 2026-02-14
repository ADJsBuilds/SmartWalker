import { useEffect, useMemo, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import { isNotImplementedError } from '../lib/apiClient';
import { useRealtimeState } from '../store/realtimeState';
import type { MergedState } from '../types/api';

interface ProofViewProps {
  mergedState?: MergedState;
}

type ProofTab = 'debug' | 'clinician';

export function ProofView({ mergedState }: ProofViewProps) {
  const { activeResidentId, residentInput, setResidentInput, setActiveResidentId, residents, residentsSupported } = useRealtimeState();
  const [tab, setTab] = useState<ProofTab>('debug');

  return (
    <section className="space-y-4 pb-24">
      <div className="rounded-2xl bg-slate-900 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-400">Resident</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {residentsSupported && residents.length ? (
            <select
              value={residentInput}
              onChange={(event) => setResidentInput(event.target.value)}
              className="rounded-lg bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {residents.map((r) => (
                <option key={r.residentId} value={r.residentId}>
                  {r.residentId}
                </option>
              ))}
            </select>
          ) : null}
          <input
            value={residentInput}
            onChange={(event) => setResidentInput(event.target.value)}
            className="rounded-lg bg-slate-950 px-3 py-2 text-sm text-white"
            placeholder="residentId"
          />
          <button type="button" onClick={() => setActiveResidentId(residentInput || activeResidentId)} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white">
            Set Active
          </button>
          <span className="text-sm text-slate-300">Active: {activeResidentId}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('debug')}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'debug' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200'}`}
        >
          Live Signals
        </button>
        <button
          type="button"
          onClick={() => setTab('clinician')}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'clinician' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200'}`}
        >
          Clinical Value
        </button>
      </div>
      {tab === 'debug' ? <DebugPanel mergedState={mergedState} /> : <ClinicianPanel />}
    </section>
  );
}

function DebugPanel({ mergedState }: { mergedState?: MergedState }) {
  const { activeResidentId, eventLog, lastUpdatedByResidentId, lastWalkerTsByResidentId, lastVisionTsByResidentId, lastMergedTsByResidentId } =
    useRealtimeState();
  const walker = (mergedState?.walker || {}) as Record<string, unknown>;
  const vision = (mergedState?.vision || {}) as Record<string, unknown>;
  const metrics = mergedState?.metrics || {};
  const [showRaw, setShowRaw] = useState(false);
  const staleSeconds = Math.floor((Date.now() - (lastUpdatedByResidentId[activeResidentId] || 0)) / 1000);
  const fresh = staleSeconds <= 5;
  const mergedJson = useMemo(() => JSON.stringify(mergedState || {}, null, 2), [mergedState]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-white">Live Signals</h3>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${fresh ? 'bg-emerald-700 text-white' : 'bg-amber-700 text-white'}`}>
            {fresh ? 'Fresh' : `Stale (${staleSeconds}s)`}
          </span>
        </div>
        <div className="mt-2 text-xs text-slate-300">
          <p>last walker ts: {fmtTs(lastWalkerTsByResidentId[activeResidentId])}</p>
          <p>last vision ts: {fmtTs(lastVisionTsByResidentId[activeResidentId])}</p>
          <p>last merged ts: {fmtTs(lastMergedTsByResidentId[activeResidentId])}</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-slate-900 p-4">
          <h4 className="text-base font-bold text-white">Walker Sensors</h4>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard label="FSR Left" value={fmt(walker.fsrLeft)} />
            <MetricCard label="FSR Right" value={fmt(walker.fsrRight)} />
            <MetricCard label="Steps" value={fmt(walker.steps ?? metrics.steps)} />
            <MetricCard label="Tilt Deg" value={fmt(walker.tiltDeg ?? metrics.tiltDeg)} />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-900 p-4">
          <h4 className="text-base font-bold text-white">Vision Model</h4>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard label="Fall Suspected" value={Boolean(vision.fallSuspected ?? metrics.fallSuspected) ? 'YES' : 'NO'} />
            <MetricCard label="Cadence SPM" value={fmt(vision.cadenceSpm)} />
            <MetricCard label="Step Var" value={fmt(vision.stepVar)} />
            <MetricCard label="Confidence" value={fmt(vision.confidence)} />
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-slate-900 p-4">
        <h4 className="text-base font-bold text-white">Event Log</h4>
        <div className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950">
          <table className="w-full text-left text-xs text-slate-200">
            <thead className="sticky top-0 bg-slate-800 text-slate-100">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Fields</th>
              </tr>
            </thead>
            <tbody>
              {eventLog
                .filter((e) => e.residentId === activeResidentId)
                .slice(0, 20)
                .map((item) => (
                  <tr key={item.id} className="border-t border-slate-800">
                    <td className="px-3 py-2">{item.time}</td>
                    <td className="px-3 py-2">{item.source}</td>
                    <td className="px-3 py-2">{item.changedFields.join(', ')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-base font-bold text-white">Raw JSON</h4>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowRaw((p) => !p)} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white">
              {showRaw ? 'Hide' : 'Show'}
            </button>
            <button type="button" onClick={() => navigator.clipboard.writeText(mergedJson)} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white">
              Copy
            </button>
          </div>
        </div>
        {showRaw ? <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">{mergedJson}</pre> : null}
      </section>
    </div>
  );
}

function ClinicianPanel() {
  const { activeResidentId, apiClient, notify } = useRealtimeState();
  const [docs, setDocs] = useState<Array<{ docId: string; filename: string }>>([]);
  const [preview, setPreview] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reports, setReports] = useState<Array<{ reportId: string; date: string }>>([]);
  const [notice, setNotice] = useState('');

  const refreshDocs = async () => {
    try {
      const list = await apiClient.listDocuments(activeResidentId);
      setDocs(list);
      setNotice('');
    } catch (error) {
      if (isNotImplementedError(error)) setNotice('Not implemented yet');
      else setNotice('Documents unavailable');
    }
  };

  useEffect(() => {
    refreshDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeResidentId]);

  const onUpload = async (file: File | null) => {
    if (!file) return;
    try {
      await apiClient.uploadDocument(activeResidentId, file);
      refreshDocs();
    } catch {
      setNotice('Not implemented yet');
      notify('Document upload unavailable.', 'warn');
    }
  };

  const openDoc = async (docId: string) => {
    try {
      const details = await apiClient.getDocument(docId);
      setPreview(details.textPreview || '');
    } catch {
      setNotice('Not implemented yet');
    }
  };

  const generateReport = async () => {
    try {
      const reportId = await apiClient.generateDailyReport(activeResidentId, date);
      if (!reportId) {
        setNotice('Not implemented yet');
        return;
      }
      setReports((prev) => [{ reportId, date }, ...prev].slice(0, 10));
    } catch {
      setNotice('Not implemented yet');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl bg-slate-900 p-4">
        <h4 className="text-base font-bold text-white">Documents</h4>
        {notice ? <p className="mt-2 rounded-lg bg-amber-900/40 p-2 text-xs text-amber-200">{notice}</p> : null}
        <input type="file" accept="application/pdf" onChange={(e) => onUpload(e.target.files?.[0] || null)} className="mt-3 w-full text-sm text-slate-100" />
        <div className="mt-3 max-h-48 space-y-2 overflow-auto">
          {docs.map((doc) => (
            <button key={doc.docId} type="button" onClick={() => openDoc(doc.docId)} className="block w-full rounded-lg bg-slate-800 px-3 py-2 text-left text-xs text-white">
              {doc.filename}
            </button>
          ))}
        </div>
        <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">{preview || 'No preview loaded.'}</pre>
      </section>

      <section className="rounded-2xl bg-slate-900 p-4">
        <h4 className="text-base font-bold text-white">Daily Report</h4>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg bg-slate-950 px-3 py-2 text-sm text-white" />
          <button type="button" onClick={generateReport} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white">
            Generate
          </button>
        </div>
        <div className="mt-3 max-h-56 space-y-2 overflow-auto">
          {reports.map((item) => (
            <a
              key={`${item.reportId}-${item.date}`}
              href={apiClient.getDailyReportDownloadUrl(item.reportId)}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg bg-slate-800 px-3 py-2 text-xs text-white"
            >
              {item.date} - Download report
            </a>
          ))}
          {!reports.length ? <p className="text-xs text-slate-400">No generated reports yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

function fmt(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '-';
}

function fmtTs(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleTimeString();
}
