import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';

type SpeechRecognitionEventLike = Event & {
  results: {
    [index: number]: {
      [index: number]: { transcript: string };
      isFinal: boolean;
    };
    length: number;
  };
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const getSpeechRecognition = (): SpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
};

interface SpeechInputButtonProps {
  onTranscript: (transcript: string) => void;
  label: string;
  className?: string;
}

// Uses the device/browser microphone permission flow. It stays a small,
// reusable control so the home search and both planner fields behave alike.
export const SpeechInputButton: React.FC<SpeechInputButtonProps> = ({
  onTranscript,
  label,
  className = '',
}) => {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(() => Boolean(getSpeechRecognition()));

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const startListening = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'en-SG';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index][0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (transcript) onTranscript(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      // Browsers throw if start is tapped twice before the previous session ends.
      setIsListening(false);
    }
  };

  const unavailable = 'Speech input is not available in this browser. Try Chrome, Edge, or Safari and allow microphone access.';
  const title = !isSupported ? unavailable : isListening ? `Stop listening for ${label}` : `Speak ${label}`;

  return (
    <button
      type="button"
      onClick={startListening}
      disabled={!isSupported}
      aria-label={title}
      aria-pressed={isListening}
      title={title}
      className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
        isListening
          ? 'bg-error-container text-error animate-pulse'
          : 'text-primary hover:bg-primary-fixed/70'
      } disabled:text-outline disabled:hover:bg-transparent disabled:cursor-not-allowed ${className}`}
    >
      {isSupported ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
    </button>
  );
};
