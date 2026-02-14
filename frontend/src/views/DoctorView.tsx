import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/apiClient';
import { useRealtimeState } from '../store/realtimeState';
import type { ReportStatsResponse } from '../types/api';

export function DoctorView() {
  const { apiClient, residents, notify } = useRealtimeState();
  const [selectedResidentId, setSelectedResidentId] = useState<string>('');
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportLoading, setReportLoading] = useState(false);
  const [stats, setStats] = useState<ReportStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [zoomLoading, setZoomLoading] = useState<string | null>(null);

  const effectiveResidentId = selectedResidentId || (residents[0]?.residentId ?? '');

  useEffect(() => {
    if (residents.length && !selectedResidentId) {
      setSelectedResidentId(residents[0].residentId);
    }
  }, [residents, selectedResidentId]);

  const loadStats = useCallback(async () => {
    if (!effectiveResidentId) return;
    setStatsLoading(true);
    try {
      const data = await apiClient.getReportStats(effectiveResidentId, 7);
      setStats(data);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to load health stats', 'error');
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [apiClient, effectiveResidentId, notify]);

  useEffect(() => {
    if (effectiveResidentId) loadStats();
  }, [effectiveResidentId, loadStats]);

  const loadSuggestions = useCallback(async () => {
    if (!effectiveResidentId) return;
    setSuggestionsLoading(true);
    try {
      const data = await apiClient.getExerciseSuggestions(effectiveResidentId, 7);
      setSuggestions(data.suggestions);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to load AI suggestions', 'error');
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [apiClient, effectiveResidentId, notify]);

  useEffect(() => {
    if (effectiveResidentId) loadSuggestions();
  }, [effectiveResidentId, loadSuggestions]);

  const handleGenerateReport = async () => {
    if (!effectiveResidentId) return;
    setReportLoading(true);
    try {
      const reportId = await apiClient.generateDailyReport(effectiveResidentId, reportDate);
      if (reportId) {
        const url = apiClient.getDailyReportDownloadUrl(reportId);
        window.open(url, '_blank');
        notify('Report generated. Download opened.', 'info');
      } else {
        notify('Report generation did not return an ID.', 'warn');
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to generate report', 'error');
    } finally {
      setReportLoading(false);
    }
  };

  const sendZoomInvite = (contactLabel: string) => {
    setZoomLoading(contactLabel);
    const phrase = `Zoom my ${contactLabel}`;
    apiClient
      .requestZoomInvite({ phrase })
      .then((res) => {
        notify(`Sent Zoom link to ${res.sentTo}.`, 'info');
      })
      .catch((err) => {
        const message =
          err instanceof ApiError && typeof err.details === 'object' && err.details && 'detail' in err.details
            ? String((err.details as { detail: unknown }).detail)
            : err instanceof Error ? err.message : 'Failed to send Zoom invite.';
        notify(message, 'error');
      })
      .finally(() => setZoomLoading(null));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <h3 className="text-lg font-semibold text-white">Patient selection</h3>
        <select
          value={selectedResidentId}
          onChange={(e) => setSelectedResidentId(e.target.value)}
          className="mt-2 w-full max-w-xs rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white"
        >
          {residents.length === 0 && (
            <option value="">No residents</option>
          )}
          {residents.map((r) => (
            <option key={r.residentId} value={r.residentId}>
              {r.name ?? r.residentId}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <h3 className="text-lg font-semibold text-white">Generate report</h3>
        <p className="mt-1 text-sm text-slate-400">Create a PDF of the patient’s daily report.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white"
          />
          <button
            type="button"
            disabled={reportLoading || !effectiveResidentId}
            onClick={() => void handleGenerateReport()}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {reportLoading ? 'Generating…' : 'Generate report'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <h3 className="text-lg font-semibold text-white">Health stats</h3>
        <p className="mt-1 text-sm text-slate-400">Summary of recent exercises and progress (last 7 days).</p>
        {statsLoading ? (
          <p className="mt-4 text-slate-400">Loading…</p>
        ) : stats ? (
          <div className="mt-4 space-y-2">
            {stats.daily.length === 0 ? (
              <p className="text-slate-400">No daily rollup data for this period.</p>
            ) : (
              <ul className="space-y-2">
                {stats.daily.map((d) => (
                  <li key={d.date} className="rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-sm">
                    <span className="font-medium text-white">{d.date}</span>
                    <span className="text-slate-400">
                      {' '}
                      · {d.samples} samples · {d.steps} steps max
                      {d.fallSuspected_count > 0 && ` · ${d.fallSuspected_count} fall-suspected`}
                      {d.tilt_spikes > 0 && ` · ${d.tilt_spikes} tilt spikes`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => void loadStats()}
              className="mt-2 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Refresh
            </button>
          </div>
        ) : (
          <p className="mt-4 text-slate-400">Select a patient to load stats.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <h3 className="text-lg font-semibold text-white">AI suggestions</h3>
        <p className="mt-1 text-sm text-slate-400">Exercise regimen suggestions from historical stats (Gemini).</p>
        {suggestionsLoading ? (
          <p className="mt-4 text-slate-400">Loading…</p>
        ) : suggestions.length > 0 ? (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-slate-200">
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-slate-400">No suggestions yet. Select a patient or refresh.</p>
        )}
        <button
          type="button"
          disabled={suggestionsLoading || !effectiveResidentId}
          onClick={() => void loadSuggestions()}
          className="mt-3 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Refresh suggestions
        </button>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <h3 className="text-lg font-semibold text-white">Check up + Zoom</h3>
        <p className="mt-1 text-sm text-slate-400">Send a Zoom invite to the patient’s physical therapist or family.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={zoomLoading !== null}
            onClick={() => sendZoomInvite('physical therapist')}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {zoomLoading === 'physical therapist' ? 'Sending…' : 'Zoom physical therapist'}
          </button>
          <button
            type="button"
            disabled={zoomLoading !== null}
            onClick={() => sendZoomInvite('daughter')}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {zoomLoading === 'daughter' ? 'Sending…' : 'Zoom family (daughter)'}
          </button>
        </div>
      </section>
    </div>
  );
}
