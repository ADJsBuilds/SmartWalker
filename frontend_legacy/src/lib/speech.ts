declare global {
  interface Window {
    webkitSpeechRecognition?: {
      new (): SpeechRecognitionLike;
    };
    SpeechRecognition?: {
      new (): SpeechRecognitionLike;
    };
  }
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

export function speakText(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function getSpeechRecognitionCtor():
  | {
      new (): SpeechRecognitionLike;
    }
  | null {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
