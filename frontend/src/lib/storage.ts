const API_BASE_URL_KEY = 'smartwalker.apiBaseUrl';

export function getDefaultApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
}

export function getStoredApiBaseUrl(): string {
  const stored = localStorage.getItem(API_BASE_URL_KEY);
  return stored || getDefaultApiBaseUrl();
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
