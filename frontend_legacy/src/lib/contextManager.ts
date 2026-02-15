export interface PatientProfile {
  name?: string;
  age?: number;
  summary?: string;
  risk?: 'low' | 'moderate' | 'high' | string;
}

export interface DeviceState {
  battery_pct?: number;
  connectivity?: 'online' | 'offline' | 'unstable' | string;
}

export interface WalkerMetrics {
  steps_today?: number;
  cadence_spm?: number;
  gait_asymmetry?: number;
  tilt_deg?: number;
  tilt_warning?: boolean;
  fall_risk?: 'low' | 'moderate' | 'high' | string;
}

export interface UiState {
  screen?: string;
  exercise_phase?: string;
}

export interface Goals {
  target_steps?: number;
}

interface LiveState {
  patient_profile: PatientProfile;
  device_state: DeviceState;
  walker_metrics: WalkerMetrics;
  ui_state: UiState;
  goals: Goals;
}

interface ContextManagerOptions {
  throttleMs?: number;
  sendUpdateText: (text: string) => void;
}

const DEFAULT_THROTTLE_MS = 2000;

export class ContextManager {
  private readonly throttleMs: number;
  private readonly sendUpdateText: (text: string) => void;
  private readonly state: LiveState = {
    patient_profile: {},
    device_state: {},
    walker_metrics: {},
    ui_state: {},
    goals: {},
  };
  private lastSentSnapshot: LiveState | null = null;
  private lastSentDigestHash = '';
  private flushTimer: number | null = null;
  private pendingCriticalLine: string | null = null;

  constructor(options: ContextManagerOptions) {
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.sendUpdateText = options.sendUpdateText;
  }

  setPatientProfile(profile: PatientProfile): void {
    this.state.patient_profile = { ...this.state.patient_profile, ...profile };
    this.scheduleFlush();
  }

  setDeviceState(deviceState: DeviceState): void {
    this.state.device_state = { ...this.state.device_state, ...deviceState };
    this.scheduleFlush();
  }

  setGoals(goals: Goals): void {
    this.state.goals = { ...this.state.goals, ...goals };
    this.scheduleFlush();
  }

  updateMetrics(partialMetrics: Partial<WalkerMetrics>): void {
    const prevTiltWarning = Boolean(this.state.walker_metrics.tilt_warning);
    this.state.walker_metrics = { ...this.state.walker_metrics, ...partialMetrics };

    const tiltWarningFlippedOn = !prevTiltWarning && Boolean(this.state.walker_metrics.tilt_warning);
    const fallRiskHigh = String(this.state.walker_metrics.fall_risk || '').toLowerCase() === 'high';
    if (tiltWarningFlippedOn || fallRiskHigh) {
      this.flushNow();
      return;
    }
    this.scheduleFlush();
  }

  updateUiState(partialUi: Partial<UiState>): void {
    this.state.ui_state = { ...this.state.ui_state, ...partialUi };
    this.scheduleFlush();
  }

  emitCriticalEvent(eventName: string, details?: Record<string, unknown>): void {
    const detailsText = details
      ? Object.entries(details)
          .map(([key, value]) => `${key}=${formatValue(value)}`)
          .join(', ')
      : 'no details';
    this.pendingCriticalLine = `- ${eventName}: ${detailsText} (CRITICAL)`;
    this.flushNow();
  }

  flushNow(): void {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushInternal();
  }

  dispose(): void {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flushInternal();
    }, this.throttleMs);
  }

  private flushInternal(): void {
    const snapshot = cloneState(this.state);
    const updateText = this.buildUpdateText(snapshot, this.lastSentSnapshot, this.pendingCriticalLine);
    this.pendingCriticalLine = null;
    if (!updateText) return;

    const digestHash = simpleHash(updateText);
    if (digestHash === this.lastSentDigestHash) return;

    this.sendUpdateText(updateText);
    this.lastSentDigestHash = digestHash;
    this.lastSentSnapshot = snapshot;
  }

  private buildUpdateText(next: LiveState, prev: LiveState | null, criticalLine: string | null): string | null {
    if (!prev) {
      return [
        'STATE UPDATE:',
        `- Patient: ${formatPatient(next.patient_profile)}`,
        `- Exercise phase: ${fallbackText(next.ui_state.exercise_phase)}`,
        `- Walker: ${formatWalkerMetrics(next.walker_metrics)}`,
        `- Goal today: ${formatGoal(next.goals)}`,
        `- UI: ${fallbackText(next.ui_state.screen)}`,
      ].join('\n');
    }

    const deltas = computeDeltaLines(prev, next);
    if (criticalLine) deltas.unshift(criticalLine);
    if (!deltas.length) return null;
    return ['STATE UPDATE (delta):', ...deltas].join('\n');
  }
}

function computeDeltaLines(prev: LiveState, next: LiveState): string[] {
  const deltas: string[] = [];
  const checks: Array<[string, unknown, unknown]> = [
    ['steps_today', prev.walker_metrics.steps_today, next.walker_metrics.steps_today],
    ['cadence_spm', prev.walker_metrics.cadence_spm, next.walker_metrics.cadence_spm],
    ['gait_asymmetry', prev.walker_metrics.gait_asymmetry, next.walker_metrics.gait_asymmetry],
    ['tilt_deg', prev.walker_metrics.tilt_deg, next.walker_metrics.tilt_deg],
    ['tilt_warning', prev.walker_metrics.tilt_warning, next.walker_metrics.tilt_warning],
    ['fall_risk', prev.walker_metrics.fall_risk, next.walker_metrics.fall_risk],
    ['exercise_phase', prev.ui_state.exercise_phase, next.ui_state.exercise_phase],
    ['screen', prev.ui_state.screen, next.ui_state.screen],
    ['target_steps', prev.goals.target_steps, next.goals.target_steps],
  ];

  for (const [label, oldValue, newValue] of checks) {
    if (!isDifferent(oldValue, newValue)) continue;
    const direction = metricDirection(label, oldValue, newValue);
    const directionSuffix = direction ? ` (${direction})` : '';
    deltas.push(`- ${label}: ${formatValue(oldValue)} -> ${formatValue(newValue)}${directionSuffix}`);
  }
  return deltas;
}

function metricDirection(label: string, oldValue: unknown, newValue: unknown): string | null {
  if (typeof oldValue !== 'number' || typeof newValue !== 'number') return null;
  if (label === 'gait_asymmetry' || label === 'tilt_deg') return newValue > oldValue ? 'worse' : 'better';
  if (label === 'cadence_spm' || label === 'steps_today') return newValue > oldValue ? 'better' : 'worse';
  return null;
}

function formatPatient(profile: PatientProfile): string {
  const name = profile.name || 'Unknown';
  const age = profile.age !== undefined ? String(profile.age) : '?';
  const summary = profile.summary || 'no profile summary';
  const risk = profile.risk || 'unknown';
  return `${name} (${age}), ${summary}, risk=${risk}`;
}

function formatWalkerMetrics(metrics: WalkerMetrics): string {
  return [
    `steps_today=${formatValue(metrics.steps_today)}`,
    `cadence=${formatValue(metrics.cadence_spm)} spm`,
    `gait_asymmetry=${formatValue(metrics.gait_asymmetry)}`,
    `tilt_deg=${formatValue(metrics.tilt_deg)}`,
    `fall_risk=${formatValue(metrics.fall_risk)}`,
  ].join(', ');
}

function formatGoal(goals: Goals): string {
  if (goals.target_steps === undefined) return 'not set';
  return `${formatValue(goals.target_steps)} steps`;
}

function fallbackText(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || 'unknown';
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (value === undefined || value === null || String(value).trim() === '') return 'n/a';
  return String(value);
}

function isDifferent(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Number(a.toFixed(2)) !== Number(b.toFixed(2));
  return String(a) !== String(b);
}

function cloneState(state: LiveState): LiveState {
  return {
    patient_profile: { ...state.patient_profile },
    device_state: { ...state.device_state },
    walker_metrics: { ...state.walker_metrics },
    ui_state: { ...state.ui_state },
    goals: { ...state.goals },
  };
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

