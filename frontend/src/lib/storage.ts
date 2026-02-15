const API_BASE_URL_KEY = 'smartwalker.apiBaseUrl';

export function getDefaultApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
}

export function getStoredApiBaseUrl(): string {
  const stored = localStorage.getItem(API_BASE_URL_KEY);
  const defaultUrl = getDefaultApiBaseUrl();
  if (!stored) return defaultUrl;
  if (shouldIgnoreStoredUrl(stored, defaultUrl)) return defaultUrl;
  return stored;
}

export function setStoredApiBaseUrl(value: string): void {
  localStorage.setItem(API_BASE_URL_KEY, value);
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function toWsBaseUrl(httpBaseUrl: string): string {
  if (httpBaseUrl.startsWith('https://')) {
    return httpBaseUrl.replace('https://', 'wss://');
  }
  if (httpBaseUrl.startsWith('http://')) {
    return httpBaseUrl.replace('http://', 'ws://');
  }
  return httpBaseUrl;
}

function shouldIgnoreStoredUrl(stored: string, defaultUrl: string): boolean {
  try {
    const storedUrl = new URL(stored);
    const defaultParsed = new URL(defaultUrl);
    const isLocalHost = storedUrl.hostname === 'localhost' || storedUrl.hostname === '127.0.0.1';
    const pageIsNonLocal = typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname);
    const mixedContent = typeof window !== 'undefined' && window.location.protocol === 'https:' && storedUrl.protocol !== 'https:';
    if (pageIsNonLocal && isLocalHost) return true;
    if (mixedContent) return true;
    // If the configured default is an onrender URL and stored points to a different host,
    // prefer the default in production to avoid stale legacy endpoints.
    if (
      pageIsNonLocal &&
      defaultParsed.hostname.endsWith('.onrender.com') &&
      storedUrl.hostname.endsWith('.onrender.com') &&
      storedUrl.hostname !== defaultParsed.hostname
    ) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}
