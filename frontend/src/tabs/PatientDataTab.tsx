import { useEffect, useMemo, useState } from 'react';
import { ApiError, isNotImplementedError } from '../lib/apiClient';
import { useAppState } from '../state/AppStateContext';
import type { DocumentDetails, Resident, ResidentDocument } from '../types/api';

interface PatientDataTabProps {
  residentId: string;
  onResidentSelected: (residentId: string) => void;
}

export function PatientDataTab({ residentId, onResidentSelected }: PatientDataTabProps) {
  const { apiClient } = useAppState();
  const [residents, setResidents] = useState<Resident[]>([]);
  const [docs, setDocs] = useState<ResidentDocument[]>([]);
  const [docPreview, setDocPreview] = useState<DocumentDetails | null>(null);
  const [newResidentName, setNewResidentName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reportId, setReportId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [residentsSupported, setResidentsSupported] = useState(true);
  const [docsSupported, setDocsSupported] = useState(true);
  const [reportsSupported, setReportsSupported] = useState(true);

  const reportDownloadUrl = useMemo(() => (reportId ? apiClient.getDailyReportDownloadUrl(reportId) : ''), [apiClient, reportId]);

  useEffect(() => {
    const loadResidents = async () => {
      try {
        const list = await apiClient.listResidents();
        setResidents(list);
        setResidentsSupported(true);
      } catch (error) {
        if (isNotImplementedError(error)) {
          setResidentsSupported(false);
          setNotice('Residents endpoint not implemented yet.');
          return;
        }
        setNotice(error instanceof Error ? error.message : 'Failed to load residents.');
      }
    };
    loadResidents();
  }, [apiClient]);

  useEffect(() => {
    const loadDocs = async () => {
      if (!residentId) return;
      try {
        const list = await apiClient.listDocuments(residentId);
        setDocs(list);
        setDocsSupported(true);
      } catch (error) {
        if (isNotImplementedError(error)) {
          setDocsSupported(false);
          setNotice('Document endpoints not implemented yet.');
          return;
        }
        setNotice(error instanceof Error ? error.message : 'Failed to load documents.');
      }
    };
    loadDocs();
  }, [apiClient, residentId]);

  const createResident = async () => {
    try {
      const created = await apiClient.createResident({ residentId, name: newResidentName || undefined });
      setResidents((prev) => [created, ...prev.filter((item) => item.residentId !== created.residentId)]);
      setNotice(`Resident ${created.residentId} created/updated.`);
    } catch (error) {
      if (isNotImplementedError(error)) {
        setResidentsSupported(false);
        setNotice('Create resident not implemented yet.');
        return;
      }
      setNotice(error instanceof Error ? error.message : 'Failed to create resident.');
    }
  };

  const onFileUpload = async (file: File | null) => {
    if (!file) return;
    try {
      await apiClient.uploadDocument(residentId, file);
      setNotice(`Uploaded ${file.name}`);
      const list = await apiClient.listDocuments(residentId);
      setDocs(list);
    } catch (error) {
      if (isNotImplementedError(error)) {
        setDocsSupported(false);
        setNotice('Upload endpoint not implemented yet.');
        return;
      }
      setNotice(error instanceof Error ? error.message : 'Failed to upload file.');
    }
  };

  const onDocClick = async (docId: string) => {
    try {
      const details = await apiClient.getDocument(docId);
      setDocPreview(details);
    } catch (error) {
      if (isNotImplementedError(error)) {
        setDocsSupported(false);
        setNotice('Document detail endpoint not implemented yet.');
        return;
      }
      setNotice(error instanceof Error ? error.message : 'Failed to load document.');
    }
  };

  const generateReport = async () => {
    try {
      const id = await apiClient.generateDailyReport(residentId, date);
      if (id) {
        setReportId(id);
        setNotice(`Report created: ${id}`);
      } else {
        setNotice('Report endpoint responded without report ID.');
      }
      setReportsSupported(true);
    } catch (error) {
      if (isNotImplementedError(error)) {
        setReportsSupported(false);
        setNotice('Reports endpoint not implemented yet.');
        return;
      }
      if (error instanceof ApiError) {
        setNotice(`Report failed: ${error.message}`);
        return;
      }
      setNotice(error instanceof Error ? error.message : 'Report request failed.');
    }
  };

  return (
    <section className="space-y-5">
      {notice ? <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">{notice}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <h3 className="text-lg font-bold text-white">Resident Management</h3>
          {!residentsSupported ? <p className="mt-2 text-sm text-amber-300">Not implemented yet. Use manual resident ID in top bar.</p> : null}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              value={newResidentName}
              onChange={(event) => setNewResidentName(event.target.value)}
              placeholder="Optional resident name"
              className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white"
            />
            <button type="button" onClick={createResident} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">
              Create/Update Resident
            </button>
          </div>

          <div className="mt-4 max-h-48 space-y-2 overflow-auto rounded-lg bg-slate-950 p-2">
            {residents.length === 0 ? <p className="text-sm text-slate-400">No residents loaded.</p> : null}
            {residents.map((resident) => (
              <button
                key={resident.residentId}
                type="button"
                onClick={() => onResidentSelected(resident.residentId)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                  resident.residentId === residentId ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-200'
                }`}
              >
                {resident.residentId} {resident.name ? `- ${resident.name}` : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <h3 className="text-lg font-bold text-white">Daily Report</h3>
          {!reportsSupported ? <p className="mt-2 text-sm text-amber-300">Not implemented yet.</p> : null}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm text-slate-200">
              Date
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="mt-1 block rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white"
              />
            </label>
            <button type="button" onClick={generateReport} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">
              Generate Daily Report
            </button>
            {reportId ? (
              <a className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white" href={reportDownloadUrl} target="_blank" rel="noreferrer">
                Download Report
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <h3 className="text-lg font-bold text-white">PDF Documents</h3>
        {!docsSupported ? <p className="mt-2 text-sm text-amber-300">Not implemented yet.</p> : null}
        <div className="mt-3">
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => onFileUpload(event.target.files?.[0] || null)}
            className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h4 className="text-sm font-bold uppercase tracking-wide text-slate-300">Uploaded docs</h4>
            <div className="max-h-56 space-y-2 overflow-auto rounded-lg bg-slate-950 p-2">
              {docs.length === 0 ? <p className="text-sm text-slate-400">No documents found.</p> : null}
              {docs.map((doc) => (
                <button
                  type="button"
                  key={doc.docId}
                  onClick={() => onDocClick(doc.docId)}
                  className="w-full rounded-lg bg-slate-800 px-3 py-2 text-left text-sm text-white hover:bg-slate-700"
                >
                  {doc.filename}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-bold uppercase tracking-wide text-slate-300">Preview</h4>
            <div className="min-h-[220px] rounded-lg bg-slate-950 p-3 text-sm text-slate-200">
              {docPreview ? docPreview.textPreview.slice(0, 1000) : 'Click a document to preview first 1000 chars.'}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
