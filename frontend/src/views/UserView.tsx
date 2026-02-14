import { useRef, useState } from 'react';
import { useRealtimeState } from '../store/realtimeState';
import { getSpeechRecognitionCtor } from '../lib/speech';
import type { SpeechRecognitionLike } from '../lib/speech';

function extractPlayableUrl(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const obj = response as Record<string, unknown>;
  
  // New format: direct video_url or url fields
  if (typeof obj.videoUrl === 'string') return obj.videoUrl;
  if (typeof obj.video_url === 'string') return obj.video_url;
  if (typeof obj.url === 'string') return obj.url;
  
  // Legacy format: nested in raw
  if (obj.raw && typeof obj.raw === 'object') {
    const nested = obj.raw as Record<string, unknown>;
    if (typeof nested.url === 'string') return nested.url;
    if (typeof nested.videoUrl === 'string') return nested.videoUrl;
    if (typeof nested.video_url === 'string') return nested.video_url;
    if (typeof nested.download_url === 'string') return nested.download_url;
    
    // Check nested data object
    if (nested.data && typeof nested.data === 'object') {
      const data = nested.data as Record<string, unknown>;
      if (typeof data.url === 'string') return data.url;
      if (typeof data.video_url === 'string') return data.video_url;
      if (typeof data.download_url === 'string') return data.download_url;
    }
  }
  
  return null;
}

export function UserView() {
  const { apiClient, activeResidentId } = useRealtimeState();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const startListening = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }

    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    
    rec.onresult = async (event) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      setIsListening(false);
      
      if (!transcript.trim()) return;
      
      // Process the user's question
      setIsProcessing(true);
      setVideoUrl(null);
      
      try {
        // Send to agent API
        const agentResponse = await apiClient.askAgent({
          residentId: activeResidentId,
          question: transcript,
        });
        
        // Get the text to speak from agent response
        const textToSpeak = agentResponse.heygen?.textToSpeak || agentResponse.answer;
        
        // Generate HeyGen video
        const heygenResponse = await apiClient.heygenSpeak({
          text: textToSpeak,
          residentId: activeResidentId,
        });
        
        const url = extractPlayableUrl(heygenResponse);
        if (url) {
          setVideoUrl(url);
        } else {
          alert('Failed to get video URL. Please try again.');
        }
      } catch (error) {
        console.error('Error processing speech:', error);
        alert('An error occurred. Please try again.');
      } finally {
        setIsProcessing(false);
      }
    };
    
    rec.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      if (event.error === 'not-allowed') {
        alert('Microphone permission denied. Please allow microphone access.');
      } else {
        alert('Speech recognition error. Please try again.');
      }
    };
    
    rec.onend = () => {
      setIsListening(false);
    };
    
    setIsListening(true);
    rec.start();
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      {/* Large video area - takes up almost all of the screen */}
      <div className="flex-1 flex items-center justify-center p-4">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            autoPlay
            className="w-full h-full object-contain rounded-lg"
            onEnded={() => setVideoUrl(null)}
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full bg-slate-900 rounded-lg">
            {isProcessing ? (
              <div className="text-white text-xl">Processing your question...</div>
            ) : (
              <div className="text-slate-400 text-lg">Ready to talk</div>
            )}
          </div>
        )}
      </div>

      {/* Orange "press to talk" button at the bottom */}
      <div className="p-6 flex justify-center">
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          disabled={isProcessing}
          className={`
            px-12 py-6 text-2xl font-bold text-white rounded-full
            transition-all duration-200
            ${isListening 
              ? 'bg-red-600 hover:bg-red-700 active:bg-red-800' 
              : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700'
            }
            ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            shadow-lg hover:shadow-xl active:shadow-md
            transform hover:scale-105 active:scale-95
          `}
        >
          {isListening ? 'Listening...' : isProcessing ? 'Processing...' : 'Press to Talk'}
        </button>
      </div>
    </div>
  );
}

