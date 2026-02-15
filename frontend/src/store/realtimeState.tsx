import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, isNetworkError, isNotImplementedError } from '../lib/apiClient';
import { getDefaultApiBaseUrl, getStoredApiBaseUrl, normalizeBaseUrl } from '../lib/storage';
import { SmartWalkerWsClient } from '../lib/wsClient';
import type { ApiStatus, AppMode, EventLogEntry, MergedState, Resident, ToastMessage, WsStatus } from '../types/api';

interface RealtimeStateContextShape {
  apiBaseUrl: string;
  setApiBaseUrl: (next: string) => void;
  apiStatus: ApiStatus;
  wsStatus: WsStatus;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  mockMode: boolean;
  activeResidentId: string;
  setActiveResidentId: (residentId: string) => void;
  residentInput: string;
  setResidentInput: (value: string) => void;
  residents: Resident[];
  residentsSupported: boolean;
  latestMergedByResidentId: Record<string, MergedState>;
  lastUpdatedByResidentId: Record<string, number>;
  lastWalkerTsByResidentId: Record<string, number>;
  lastVisionTsByResidentId: Record<string, number>;
  lastMergedTsByResidentId: Record<string, number>;
  eventLog: EventLogEntry[];
  simulateFall: boolean;
  setSimulateFall: (value: boolean) => void;
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  notify: (message: string, level?: ToastMessage['level']) => void;
  refreshResidentState: (residentId?: string) => Promise<void>;
  sendTestWalkerPacket: () => Promise<void>;
  sendTestVisionPacket: () => Promise<void>;
  apiClient: ApiClient;
}

const RealtimeStateContext = createContext<RealtimeStateContextShape | null>(null);
const DEFAULT_RESIDENT = 'r1';

export function RealtimeStateProvider({ children }: { children: React.ReactNode }) {
  const [apiBaseUrl, setApiBaseUrlState] = useState(() => normalizeBaseUrl(getStoredApiBaseUrl()));
  const [apiStatus, setApiStatus] = useState<ApiStatus>('offline');
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const [mode, setMode] = useState<AppMode>('judge');
  const [mockMode, setMockMode] = useState(false);
  const [activeResidentId, setActiveResidentId] = useState(DEFAULT_RESIDENT);
  const [residentInput, setResidentInput] = useState(DEFAULT_RESIDENT);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentsSupported, setResidentsSupported] = useState(true);
  const [latestMergedByResidentId, setLatestMergedByResidentId] = useState<Record<string, MergedState>>({});
  const [lastUpdatedByResidentId, setLastUpdatedByResidentId] = useState<Record<string, number>>({});
  const [lastWalkerTsByResidentId, setLastWalkerTsByResidentId] = useState<Record<string, number>>({});
  const [lastVisionTsByResidentId, setLastVisionTsByResidentId] = useState<Record<string, number>>({});
  const [lastMergedTsByResidentId, setLastMergedTsByResidentId] = useState<Record<string, number>>({});
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [simulateFall, setSimulateFall] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const wsRef = useRef<SmartWalkerWsClient | null>(null);
  const apiClient = useMemo(() => new ApiClient(apiBaseUrl), [apiBaseUrl]);

  const addToast = useCallback((message: string, level: ToastMessage['level'] = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [{ id, level, message }, ...prev].slice(0, 5));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushEvent = useCallback((entry: Omit<EventLogEntry, 'id' | 'time'>) => {
    const next: EventLogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      time: new Date().toLocaleTimeString(),
    };
    setEventLog((prev) => [next, ...prev].slice(0, 80));
  }, []);

  const updateResidentData = useCallback(
    (merged: MergedState, source: EventLogEntry['source']) => {
      const residentId = merged.residentId;
      const prev = latestMergedByResidentId[residentId];
      const changedFields = getChangedFields(prev, merged);

      setLatestMergedByResidentId((old) => ({ ...old, [residentId]: merged }));
      setLastUpdatedByResidentId((old) => ({ ...old, [residentId]: Date.now() }));
      setLastMergedTsByResidentId((old) => ({ ...old, [residentId]: Number(merged.ts || 0) }));

      const walkerTs = Number((merged.walker as Record<string, unknown> | undefined)?.ts || 0);
      const visionTs = Number((merged.vision as Record<string, unknown> | undefined)?.ts || 0);
      if (walkerTs) setLastWalkerTsByResidentId((old) => ({ ...old, [residentId]: walkerTs }));
      if (visionTs) setLastVisionTsByResidentId((old) => ({ ...old, [residentId]: visionTs }));

      pushEvent({
        residentId,
        source,
        changedFields: changedFields.length ? changedFields : ['(no delta)'],
      });
    },
    [latestMergedByResidentId, pushEvent],
  );

  const injectMockTick = useCallback(() => {
    const residentId = activeResidentId;
    const prev = latestMergedByResidentId[residentId];
    const steps = Number(prev?.metrics.steps || 0) + 1 + Math.floor(Math.random() * 3);
    const tilt = simulateFall ? 67 : 3 + Math.random() * 6;
    const fall = simulateFall || tilt >= 60;
    const fsrLeft = 15 + Math.floor(Math.random() * 15);
    const fsrRight = 15 + Math.floor(Math.random() * 15);
    const nowTs = Math.floor(Date.now() / 1000);
    updateResidentData(
      {
        residentId,
        ts: nowTs,
        walker: { residentId, ts: nowTs, fsrLeft, fsrRight, tiltDeg: tilt, steps },
        vision: { residentId, ts: nowTs, cadenceSpm: 85 + Math.random() * 15, stepVar: 6 + Math.random() * 6, fallSuspected: fall },
        metrics: {
          steps,
          tiltDeg: tilt,
          reliance: fsrLeft + fsrRight,
          balance: (fsrLeft - fsrRight) / Math.max(fsrLeft + fsrRight, 1),
          fallSuspected: fall,
        },
      },
      'mock',
    );
  }, [activeResidentId, latestMergedByResidentId, simulateFall, updateResidentData]);

  const refreshResidentState = useCallback(
    async (residentId?: string) => {
      const target = residentId || activeResidentId;
      try {
        const state = await apiClient.getState(target);
        if (!state || (state as unknown as Record<string, unknown>).error) return;
        setApiStatus('connected');
        setMockMode(false);
        updateResidentData(state, 'manual_refresh');
      } catch (error) {
        if (isNetworkError(error)) {
          setApiStatus('offline');
          setMockMode(true);
          addToast('API unreachable. Mock mode enabled for demo continuity.', 'warn');
          injectMockTick();
          return;
        }
        if (isNotImplementedError(error)) {
          setApiStatus('degraded');
          addToast('State endpoint is not implemented yet.', 'warn');
          return;
        }
        addToast(error instanceof Error ? error.message : 'Failed to refresh state.', 'error');
      }
    },
    [activeResidentId, addToast, apiClient, injectMockTick, updateResidentData],
  );

  const sendTestWalkerPacket = useCallback(async () => {
    const residentId = activeResidentId;
    const prev = latestMergedByResidentId[residentId];
    const nextSteps = Number(prev?.metrics.steps || 0) + 2;
    const payload = {
      residentId,
      fsrLeft: 19 + Math.floor(Math.random() * 10),
      fsrRight: 18 + Math.floor(Math.random() * 10),
      tiltDeg: simulateFall ? 65 : 4 + Math.random() * 5,
      steps: nextSteps,
    };
    try {
      await apiClient.postWalker(payload);
      pushEvent({ residentId, source: 'test_walker', changedFields: ['walker payload sent'] });
      setApiStatus('connected');
      refreshResidentState(residentId);
    } catch (error) {
      addToast('Failed to send walker test packet. Using mock fallback update.', 'warn');
      injectMockTick();
      if (isNetworkError(error)) {
        setApiStatus('offline');
        setMockMode(true);
      }
    }
  }, [activeResidentId, addToast, apiClient, injectMockTick, latestMergedByResidentId, pushEvent, refreshResidentState, simulateFall]);

  const sendTestVisionPacket = useCallback(async () => {
    const residentId = activeResidentId;
    const payload = {
      residentId,
      fallSuspected: simulateFall,
      cadenceSpm: 88 + Math.random() * 10,
      stepVar: 7 + Math.random() * 5,
    };
    try {
      await apiClient.postVision(payload);
      pushEvent({ residentId, source: 'test_vision', changedFields: ['vision payload sent'] });
      setApiStatus('connected');
      refreshResidentState(residentId);
    } catch (error) {
      addToast('Failed to send vision test packet. Using mock fallback update.', 'warn');
      injectMockTick();
      if (isNetworkError(error)) {
        setApiStatus('offline');
        setMockMode(true);
      }
    }
  }, [activeResidentId, addToast, apiClient, injectMockTick, pushEvent, refreshResidentState, simulateFall]);

  useEffect(() => {
    localStorage.setItem('smartwalker.apiBaseUrl', normalizeBaseUrl(apiBaseUrl));
  }, [apiBaseUrl]);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const result = await apiClient.health();
        if (result.ok) {
          setApiStatus('connected');
          setMockMode(false);
        } else {
          setApiStatus('degraded');
        }
      } catch (error) {
        if (isNetworkError(error)) {
          const fallbackApiBaseUrl = normalizeBaseUrl(getDefaultApiBaseUrl());
          if (normalizeBaseUrl(apiBaseUrl) !== fallbackApiBaseUrl) {
            setApiBaseUrlState(fallbackApiBaseUrl);
            addToast('Saved API URL was unreachable. Reset to the deployed backend URL.', 'warn');
            return;
          }
          setApiStatus('offline');
          setMockMode(true);
          addToast('Backend unreachable. Running in mock mode.', 'warn');
          injectMockTick();
          return;
        }
        setApiStatus('degraded');
      }
    };
    checkHealth();
  }, [addToast, apiClient, injectMockTick]);

  useEffect(() => {
    const loadResidents = async () => {
      try {
        const result = await apiClient.listResidents();
        setResidents(result);
        setResidentsSupported(true);
      } catch (error) {
        if (isNotImplementedError(error)) {
          setResidentsSupported(false);
          return;
        }
      }
    };
    loadResidents();
  }, [apiClient]);

  useEffect(() => {
    wsRef.current?.close();
    const ws = new SmartWalkerWsClient({
      baseUrl: apiBaseUrl,
      onStatus: setWsStatus,
      onMessage: (payload) => {
        if (payload.type === 'snapshot' && Array.isArray(payload.data)) {
          const snapshot = payload.data as MergedState[];
          snapshot.forEach((item) => updateResidentData(item, 'snapshot'));
          return;
        }
        if (payload.type === 'merged_update' && payload.data && typeof payload.data === 'object' && 'residentId' in payload.data) {
          updateResidentData(payload.data as MergedState, 'merged_update');
        }
      },
    });
    ws.connect();
    wsRef.current = ws;
    return () => ws.close();
  }, [apiBaseUrl, updateResidentData]);

  useEffect(() => {
    refreshResidentState(activeResidentId);
  }, [activeResidentId, refreshResidentState]);

  useEffect(() => {
    if (!mockMode) return;
    const timer = window.setInterval(() => injectMockTick(), 2200);
    return () => window.clearInterval(timer);
  }, [injectMockTick, mockMode]);

  const setApiBaseUrl = useCallback((next: string) => {
    setApiBaseUrlState(normalizeBaseUrl(next));
    setMockMode(false);
  }, []);

  const value = useMemo<RealtimeStateContextShape>(
    () => ({
      apiBaseUrl,
      setApiBaseUrl,
      apiStatus,
      wsStatus,
      mode,
      setMode,
      mockMode,
      activeResidentId,
      setActiveResidentId,
      residentInput,
      setResidentInput,
      residents,
      residentsSupported,
      latestMergedByResidentId,
      lastUpdatedByResidentId,
      lastWalkerTsByResidentId,
      lastVisionTsByResidentId,
      lastMergedTsByResidentId,
      eventLog,
      simulateFall,
      setSimulateFall,
      toasts,
      dismissToast,
      notify: addToast,
      refreshResidentState,
      sendTestWalkerPacket,
      sendTestVisionPacket,
      apiClient,
    }),
    [
      activeResidentId,
      apiBaseUrl,
      apiClient,
      apiStatus,
      dismissToast,
      eventLog,
      lastMergedTsByResidentId,
      lastUpdatedByResidentId,
      lastVisionTsByResidentId,
      lastWalkerTsByResidentId,
      latestMergedByResidentId,
      mockMode,
      mode,
      refreshResidentState,
      residentInput,
      residents,
      residentsSupported,
      sendTestVisionPacket,
      sendTestWalkerPacket,
      addToast,
      setApiBaseUrl,
      simulateFall,
      toasts,
      wsStatus,
    ],
  );

  return <RealtimeStateContext.Provider value={value}>{children}</RealtimeStateContext.Provider>;
}

export function useRealtimeState(): RealtimeStateContextShape {
  const context = useContext(RealtimeStateContext);
  if (!context) throw new Error('useRealtimeState must be used inside RealtimeStateProvider');
  return context;
}

function getChangedFields(prev: MergedState | undefined, next: MergedState): string[] {
  if (!prev) return ['initial snapshot'];
  const keys = ['steps', 'tiltDeg', 'reliance', 'balance', 'fallSuspected', 'cadenceSpm', 'stepVar'];
  const changed: string[] = [];
  const prevVision = prev.vision as Record<string, unknown> | undefined;
  const nextVision = next.vision as Record<string, unknown> | undefined;
  keys.forEach((key) => {
    const prevValue = (prev.metrics as Record<string, unknown>)[key] ?? prevVision?.[key];
    const nextValue = (next.metrics as Record<string, unknown>)[key] ?? nextVision?.[key];
    if (String(prevValue) !== String(nextValue)) changed.push(key);
  });
  return changed;
}
