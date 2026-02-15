export interface VoiceEndpointingOptions {
  frameMs?: number;
  rmsAlpha?: number;
  noiseWarmupMs?: number;
  noiseFloorDecay?: number;
  speechThresholdMultiplier?: number;
  absoluteMinRms?: number;
  silenceHangoverMs?: number;
  minSpeechMs?: number;
  maxUtteranceMs?: number;
  onSpeechStart?: () => void;
  onSpeechEndCandidate?: () => void;
  onEndpoint?: (reason: 'silence' | 'max_utterance') => void;
  onMetrics?: (metrics: EndpointingMetrics) => void;
}

export interface EndpointingMetrics {
  rms: number;
  emaRms: number;
  noiseFloor: number;
  threshold: number;
  speaking: boolean;
}

const DEFAULTS = {
  frameMs: 20,
  rmsAlpha: 0.25,
  noiseWarmupMs: 300,
  noiseFloorDecay: 0.995,
  speechThresholdMultiplier: 2.2,
  absoluteMinRms: 0.008,
  silenceHangoverMs: 320,
  minSpeechMs: 250,
  maxUtteranceMs: 8000,
} as const;

export class VoiceEndpointDetector {
  private readonly opts: Required<Omit<VoiceEndpointingOptions, 'onSpeechStart' | 'onSpeechEndCandidate' | 'onEndpoint' | 'onMetrics'>> &
    Pick<VoiceEndpointingOptions, 'onSpeechStart' | 'onSpeechEndCandidate' | 'onEndpoint' | 'onMetrics'>;

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private intervalId: number | null = null;
  private sampleBuffer: Float32Array | null = null;
  private startedAtMs = 0;
  private speechStartedAtMs = 0;
  private lastSpeechAtMs = 0;
  private silenceCandidateAtMs = 0;
  private noiseFloor = 0.0;
  private emaRms = 0.0;
  private speaking = false;
  private stopped = false;

  constructor(options: VoiceEndpointingOptions = {}) {
    this.opts = {
      frameMs: options.frameMs ?? DEFAULTS.frameMs,
      rmsAlpha: options.rmsAlpha ?? DEFAULTS.rmsAlpha,
      noiseWarmupMs: options.noiseWarmupMs ?? DEFAULTS.noiseWarmupMs,
      noiseFloorDecay: options.noiseFloorDecay ?? DEFAULTS.noiseFloorDecay,
      speechThresholdMultiplier: options.speechThresholdMultiplier ?? DEFAULTS.speechThresholdMultiplier,
      absoluteMinRms: options.absoluteMinRms ?? DEFAULTS.absoluteMinRms,
      silenceHangoverMs: options.silenceHangoverMs ?? DEFAULTS.silenceHangoverMs,
      minSpeechMs: options.minSpeechMs ?? DEFAULTS.minSpeechMs,
      maxUtteranceMs: options.maxUtteranceMs ?? DEFAULTS.maxUtteranceMs,
      onSpeechStart: options.onSpeechStart,
      onSpeechEndCandidate: options.onSpeechEndCandidate,
      onEndpoint: options.onEndpoint,
      onMetrics: options.onMetrics,
    };
  }

  async start(stream: MediaStream): Promise<void> {
    this.stopped = false;
    this.startedAtMs = performance.now();
    this.speechStartedAtMs = 0;
    this.lastSpeechAtMs = 0;
    this.silenceCandidateAtMs = 0;
    this.noiseFloor = 0.0;
    this.emaRms = 0.0;
    this.speaking = false;

    this.audioCtx = new AudioContext();
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this.sampleBuffer = new Float32Array(this.analyser.fftSize);
    this.intervalId = window.setInterval(() => this.tick(), this.opts.frameMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // best effort
      }
      this.source = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // best effort
      }
      this.analyser = null;
    }
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // best effort
      }
      this.audioCtx = null;
    }
    this.sampleBuffer = null;
  }

  private tick(): void {
    if (this.stopped || !this.analyser || !this.sampleBuffer) return;
    const nowMs = performance.now();
    const elapsedMs = nowMs - this.startedAtMs;

    this.analyser.getFloatTimeDomainData(this.sampleBuffer);
    const rms = this.computeRms(this.sampleBuffer);
    const alpha = this.opts.rmsAlpha;
    this.emaRms = this.emaRms <= 0 ? rms : alpha * rms + (1 - alpha) * this.emaRms;

    if (elapsedMs <= this.opts.noiseWarmupMs) {
      this.noiseFloor = this.noiseFloor <= 0 ? this.emaRms : Math.min(this.noiseFloor, this.emaRms);
    } else if (!this.speaking) {
      this.noiseFloor = this.noiseFloor <= 0 ? this.emaRms : this.noiseFloor * this.opts.noiseFloorDecay + this.emaRms * (1 - this.opts.noiseFloorDecay);
    }

    const threshold = Math.max(this.noiseFloor * this.opts.speechThresholdMultiplier, this.opts.absoluteMinRms);
    const isSpeech = this.emaRms > threshold;

    this.opts.onMetrics?.({
      rms,
      emaRms: this.emaRms,
      noiseFloor: this.noiseFloor,
      threshold,
      speaking: this.speaking,
    });

    if (isSpeech) {
      this.lastSpeechAtMs = nowMs;
      this.silenceCandidateAtMs = 0;
      if (!this.speaking) {
        this.speaking = true;
        this.speechStartedAtMs = nowMs;
        this.opts.onSpeechStart?.();
      }
    } else if (this.speaking) {
      if (!this.silenceCandidateAtMs) {
        this.silenceCandidateAtMs = nowMs;
        this.opts.onSpeechEndCandidate?.();
      }
      const spokenMs = this.lastSpeechAtMs > 0 && this.speechStartedAtMs > 0 ? this.lastSpeechAtMs - this.speechStartedAtMs : 0;
      const silenceMs = nowMs - this.silenceCandidateAtMs;
      const canEndpoint = spokenMs >= this.opts.minSpeechMs && silenceMs >= this.opts.silenceHangoverMs;
      if (canEndpoint) {
        this.opts.onEndpoint?.('silence');
        this.stopped = true;
        return;
      }
    }

    if (elapsedMs >= this.opts.maxUtteranceMs) {
      this.opts.onEndpoint?.('max_utterance');
      this.stopped = true;
    }
  }

  private computeRms(values: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      const sample = values[i];
      sum += sample * sample;
    }
    return Math.sqrt(sum / values.length);
  }
}
