import { useMemo, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import { useRealtimeState } from '../store/realtimeState';
import type { MergedState } from '../types/api';

interface DebugModeProps {
  mergedState?: MergedState;
}

export function DebugMode({ mergedState }: DebugModeProps) {
  const { activeResidentId, eventLog, lastUpdatedByResidentId, lastWalkerTsByResidentId, lastVisionTsByResidentId, lastMergedTsByResidentId } =
    useRealtimeState();
  const [showClinician, setShowClinician] = useState(true);
  const walker = (mergedState?.walker || {}) as Record<string, unknown>;
  const vision = (mergedState?.vision || {}) as Record<string, unknown>;
  const metrics = mergedState?.metrics || {};
  const staleSeconds = Math.floor((Date.now() - (lastUpdatedByResidentId[activeResidentId] || 0)) / 1000);
  const stale = staleSeconds > 5;
  const rawJson = useMemo(() => JSON.stringify(mergedState || {}, null, 2), [mergedState]);
  const walkerJson = useMemo(() => JSON.stringify(walker || {}, null, 2), [walker]);
  const visionJson = useMemo(() => JSON.stringify(vision || {}, null, 2), [vision]);

  return (
    <section className="space-y-4 pb-28">
      <div className="rounded-2xl bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-white">Debug Dashboard (Separated Streams)</h3>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${stale ? 'bg-amber-700 text-white' : 'bg-emerald-700 text-white'}`}>
              {stale ? `Stale (${staleSeconds}s)` : 'Fresh'}
            </span>
            <button
              type="button"
              onClick={() => window.open(`/cv?residentId=${encodeURIComponent(activeResidentId)}`, 'cvWindow', 'width=1100,height=800')}
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-bold text-white"
            >
              Open CV Window
            </button>
          </div>
        </div>
        <div className="mt-3 rounded-xl bg-slate-950 p-3 text-xs text-slate-300">
          <p>Last walker ts: {formatTs(lastWalkerTsByResidentId[activeResidentId])}</p>
          <p>Last vision ts: {formatTs(lastVisionTsByResidentId[activeResidentId])}</p>
          <p>Last merged ts: {formatTs(lastMergedTsByResidentId[activeResidentId])}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">Sensor Data (Walker)</h3>
            <span className="rounded-full bg-indigo-700 px-3 py-1 text-xs font-semibold text-white">Pipeline A</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard label="FSR Left" value={disp(walker.fsrLeft)} />
            <MetricCard label="FSR Right" value={disp(walker.fsrRight)} />
            <MetricCard label="Steps" value={disp(walker.steps ?? metrics.steps)} accent="good" />
            <MetricCard label="Tilt Deg" value={disp(walker.tiltDeg ?? metrics.tiltDeg)} accent={Number(walker.tiltDeg ?? metrics.tiltDeg ?? 0) > 25 ? 'warn' : 'normal'} />
            <MetricCard label="Reliance" value={disp(metrics.reliance)} />
            <MetricCard label="Balance" value={disp(metrics.balance)} />
          </div>
          <pre className="mt-3 max-h-[240px] overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">{walkerJson}</pre>
        </div>

        <div className="rounded-2xl bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">Computer Vision Data</h3>
            <span className="rounded-full bg-teal-700 px-3 py-1 text-xs font-semibold text-white">Pipeline B</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard label="Fall Suspected" value={Boolean(vision.fallSuspected ?? metrics.fallSuspected) ? 'YES' : 'NO'} accent={Boolean(vision.fallSuspected ?? metrics.fallSuspected) ? 'danger' : 'good'} />
            <MetricCard label="Cadence SPM" value={disp(vision.cadenceSpm)} />
            <MetricCard label="Step Var" value={disp(vision.stepVar)} />
            <MetricCard label="Vision TS" value={disp(vision.ts)} />
            <MetricCard label="Resident" value={String(vision.residentId || activeResidentId)} />
            <MetricCard label="Source Camera" value={String(vision.cameraId || '-')} />
          </div>
          <pre className="mt-3 max-h-[240px] overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">{visionJson}</pre>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-slate-900 p-4">
          <h3 className="text-lg font-bold text-white">Event Log</h3>
          <div className="mt-3 max-h-[340px] overflow-auto rounded-lg bg-slate-950">
            <table className="w-full text-left text-xs text-slate-200">
              <thead className="sticky top-0 bg-slate-800 text-slate-100">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Changed fields</th>
                </tr>
              </thead>
              <tbody>
                {eventLog
                  .filter((item) => item.residentId === activeResidentId)
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
        </div>

        <div className="rounded-2xl bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">Raw JSON (Merged State)</h3>
            <button type="button" onClick={() => navigator.clipboard.writeText(rawJson)} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white">
              Copy
            </button>
          </div>
          <pre className="mt-3 max-h-[340px] overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">{rawJson}</pre>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-900 p-4">
        <button type="button" onClick={() => setShowClinician((prev) => !prev)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-bold text-white">
          {showClinician ? 'Hide' : 'Show'} Clinician Panel (optional)
        </button>
        {showClinician ? <ClinicianPanel /> : null}
      </div>
    </section>
  );
}

function ClinicianPanel() {
  const { activeResidentId, apiClient, notify } = useRealtimeState();
  const [docs, setDocs] = useState<Array<{ docId: string; filename: string }>>([]);
  const [preview, setPreview] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [inlineNotice, setInlineNotice] = useState<string>('');

  const refreshDocs = async () => {
    try {
      const list = await apiClient.listDocuments(activeResidentId);
      setDocs(list);
    } catch {
      notify('Document endpoints not implemented yet.', 'warn');
      setInlineNotice('Document endpoints not implemented yet.');
    }
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    try {
      await apiClient.uploadDocument(activeResidentId, file);
      refreshDocs();
    } catch {
      notify('Document upload unavailable.', 'warn');
      setInlineNotice('Document upload endpoint not implemented yet.');
    }
  };

  const openDoc = async (docId: string) => {
    try {
      const details = await apiClient.getDocument(docId);
      setPreview(details.textPreview || '');
    } catch {
      notify('Document preview unavailable.', 'warn');
      setInlineNotice('Document preview endpoint not implemented yet.');
    }
  };

  const generateReport = async () => {
    try {
      const reportId = await apiClient.generateDailyReport(activeResidentId, date);
      if (reportId) setReportUrl(apiClient.getDailyReportDownloadUrl(reportId));
      else notify('Reports endpoint responded without report id.', 'warn');
    } catch {
      notify('Reports endpoint not implemented yet.', 'warn');
      setInlineNotice('Reports endpoints not implemented yet.');
    }
  };

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-xl bg-slate-950 p-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-300">Documents</h4>
        {inlineNotice ? <p className="rounded-lg bg-amber-900/40 p-2 text-xs text-amber-200">{inlineNotice}</p> : null}
        <input type="file" accept="application/pdf" onChange={(e) => onUpload(e.target.files?.[0] || null)} className="w-full text-sm text-slate-100" />
        <button type="button" onClick={refreshDocs} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white">
          Refresh Docs
        </button>
        <div className="max-h-40 space-y-2 overflow-auto">
          {docs.map((doc) => (
            <button key={doc.docId} type="button" onClick={() => openDoc(doc.docId)} className="block w-full rounded-lg bg-slate-800 px-3 py-2 text-left text-xs text-white">
              {doc.filename}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-xl bg-slate-950 p-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-300">Reports + Preview</h4>
        <div className="flex items-end gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" />
          <button type="button" onClick={generateReport} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">
            Generate
          </button>
          {reportUrl ? (
            <a href={reportUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">
              Download
            </a>
          ) : null}
        </div>
        <pre className="max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-200">{preview || 'No preview loaded.'}</pre>
      </div>
    </div>
  );
}

function disp(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '-';
}

function formatTs(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleTimeString();
}
