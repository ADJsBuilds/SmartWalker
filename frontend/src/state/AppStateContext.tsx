import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, isNetworkError, isNotImplementedError } from '../lib/apiClient';
import { getStoredApiBaseUrl, normalizeBaseUrl } from '../lib/storage';
import { SmartWalkerWsClient } from '../lib/wsClient';
import type { ApiStatus, MergedState, WsStatus } from '../types/api';

interface AppStateContextShape {
  apiBaseUrl: string;
  setApiBaseUrl: (next: string) => void;
  apiStatus: ApiStatus;
  wsStatus: WsStatus;
  mockMode: boolean;
  latestMergedByResidentId: Record<string, MergedState>;
  selectedResidentId: string;
  setSelectedResidentId: (residentId: string) => void;
  refreshState: (residentId?: string) => Promise<void>;
  apiClient: ApiClient;
  friendlyError: string | null;
  setFriendlyError: (value: string | null) => void;
}

const AppStateContext = createContext<AppStateContextShape | null>(null);

const DEFAULT_RESIDENT_ID = 'r1';

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [apiBaseUrl, setApiBaseUrlState] = useState(() => normalizeBaseUrl(getStoredApiBaseUrl()));
  const [apiStatus, setApiStatus] = useState<ApiStatus>('offline');
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const [mockMode, setMockMode] = useState(false);
  const [friendlyError, setFriendlyError] = useState<string | null>(null);
  const [selectedResidentId, setSelectedResidentId] = useState(DEFAULT_RESIDENT_ID);
  const [latestMergedByResidentId, setLatestMergedByResidentId] = useState<Record<string, MergedState>>({});

  const wsRef = useRef<SmartWalkerWsClient | null>(null);
  const apiClient = useMemo(() => new ApiClient(apiBaseUrl), [apiBaseUrl]);

  const injectMockData = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    setLatestMergedByResidentId((prev) => ({
      ...prev,
      [selectedResidentId]: {
        residentId: selectedResidentId,
        ts: now,
        walker: { fsrLeft: 20, fsrRight: 17, steps: 143, tiltDeg: 4 },
        vision: { cadenceSpm: 89.5, stepVar: 7.8, fallSuspected: false },
        metrics: {
          steps: 143,
          tiltDeg: 4,
          reliance: 37,
          balance: 0.08,
          fallSuspected: false,
        },
      },
    }));
  }, [selectedResidentId]);

  const refreshState = useCallback(
    async (residentId?: string) => {
      const target = residentId || selectedResidentId;
      try {
        const state = await apiClient.getState(target);
        if (!state || (state as unknown as Record<string, unknown>).error) return;
        setLatestMergedByResidentId((prev) => ({ ...prev, [target]: state }));
      } catch (error) {
        if (isNetworkError(error)) {
          setApiStatus('offline');
          setMockMode(true);
          injectMockData();
        } else if (isNotImplementedError(error)) {
          setApiStatus('degraded');
        }
      }
    },
    [apiClient, injectMockData, selectedResidentId],
  );

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
          setApiStatus('offline');
          setMockMode(true);
          setFriendlyError('Backend unreachable. Using demo mock mode.');
          injectMockData();
        } else {
          setApiStatus('degraded');
        }
      }
    };
    checkHealth();
  }, [apiClient, injectMockData]);

  useEffect(() => {
    wsRef.current?.close();
    const ws = new SmartWalkerWsClient({
      baseUrl: apiBaseUrl,
      onStatus: (status) => setWsStatus(status),
      onMessage: (payload) => {
        if (payload.type === 'snapshot' && Array.isArray(payload.data)) {
          const snapshot = payload.data as MergedState[];
          setLatestMergedByResidentId((prev) => {
            const next = { ...prev };
            snapshot.forEach((item) => {
              next[item.residentId] = item;
            });
            return next;
          });
          return;
        }
        if (payload.type === 'merged_update' && payload.data && typeof payload.data === 'object' && 'residentId' in payload.data) {
          const merged = payload.data as unknown as MergedState;
          setLatestMergedByResidentId((prev) => ({ ...prev, [merged.residentId]: merged }));
        }
      },
    });
    ws.connect();
    wsRef.current = ws;
    return () => ws.close();
  }, [apiBaseUrl]);

  const setApiBaseUrl = useCallback((next: string) => {
    const normalized = normalizeBaseUrl(next);
    localStorage.setItem('smartwalker.apiBaseUrl', normalized);
    setApiBaseUrlState(normalized);
    setFriendlyError(null);
  }, []);

  const value = useMemo<AppStateContextShape>(
    () => ({
      apiBaseUrl,
      setApiBaseUrl,
      apiStatus,
      wsStatus,
      mockMode,
      latestMergedByResidentId,
      selectedResidentId,
      setSelectedResidentId,
      refreshState,
      apiClient,
      friendlyError,
      setFriendlyError,
    }),
    [
      apiBaseUrl,
      apiClient,
      apiStatus,
      friendlyError,
      latestMergedByResidentId,
      mockMode,
      refreshState,
      selectedResidentId,
      setApiBaseUrl,
      wsStatus,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextShape {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used inside AppStateProvider');
  }
  return context;
}
