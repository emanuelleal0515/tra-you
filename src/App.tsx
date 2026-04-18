/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { 
  Youtube, 
  Languages, 
  History as HistoryIcon, 
  Settings as SettingsIcon, 
  Play, 
  Copy, 
  Download, 
  ChevronDown, 
  ChevronUp,
  Loader2,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { cn, formatTime, parseYouTubeUrl } from './lib/utils';

// Constants
const LANGUAGES = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Portuguese (Brazil)' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'ru', name: 'Russian' }
];

interface TranscriptSegment {
  text: string;
  duration: number;
  offset: number;
}

interface TranslationHistory {
  id: string;
  videoId: string;
  title: string;
  thumbnail: string;
  sourceLang: string;
  targetLang: string;
  transcript: TranscriptSegment[];
  translation: string;
  timestamp: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'translate' | 'history' | 'settings'>('home');
  const [url, setUrl] = useState('');
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('pt');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Current translation state
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [translatedText, setTranslatedText] = useState('');
  const [isOriginalExpanded, setIsOriginalExpanded] = useState(false);
  
  const [history, setHistory] = useState<TranslationHistory[]>([]);
  const playerRef = useRef<any>(null);
  const apiRef = useRef<any>(null);

  // Initialize History
  useEffect(() => {
    const savedHistory = localStorage.getItem('vidtranslate_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }

    // Register SW
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
          console.error('Service worker registration failed:', err);
        });
      });
    }

    // Load YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
  }, []);

  // Handle Player Initialization
  useEffect(() => {
    if (currentVideoId && activeTab === 'translate') {
      const initPlayer = () => {
        if ((window as any).YT && (window as any).YT.Player) {
          playerRef.current = new (window as any).YT.Player('yt-player-container', {
            videoId: currentVideoId,
            events: {
              onReady: (event: any) => {
                playerRef.current = event.target;
              }
            }
          });
        } else {
          setTimeout(initPlayer, 100);
        }
      };
      
      initPlayer();
    }
  }, [currentVideoId, activeTab]);

  const saveToHistory = (entry: TranslationHistory) => {
    const newHistory = [entry, ...history.filter(h => h.videoId !== entry.videoId)].slice(0, 10);
    setHistory(newHistory);
    localStorage.setItem('vidtranslate_history', JSON.stringify(newHistory));
  };

  const handleTranslate = async () => {
    const videoId = parseYouTubeUrl(url);
    if (!videoId) {
      setError('Invalid YouTube URL');
      return;
    }

    setError(null);
    setLoading(true);
    setProgress(10);
    setCurrentVideoId(videoId);
    setTranslatedText('');
    setTranscript([]);

    try {
      // 1. Fetch Transcript
      const transcriptRes = await fetch(`/api/transcript?url=${encodeURIComponent(url)}`);
      if (!transcriptRes.ok) {
        const errData = await transcriptRes.json();
        throw new Error(errData.error || 'Failed to fetch transcript');
      }
      const transcriptData: TranscriptSegment[] = await transcriptRes.json();
      setTranscript(transcriptData);
      setProgress(40);

      // 2. Prepare Chunks for Translation
      // We'll chunk the segments to avoid token limits. Approx 100 segments per chunk.
      const CHUNK_SIZE = 50;
      const chunks: TranscriptSegment[][] = [];
      for (let i = 0; i < transcriptData.length; i += CHUNK_SIZE) {
        chunks.push(transcriptData.slice(i, i + CHUNK_SIZE));
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      let fullTranslation = '';

      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i].map(s => `[${formatTime(s.offset/1000)}] ${s.text}`).join('\n');
        const sourceName = LANGUAGES.find(l => l.code === sourceLang)?.name || 'Auto';
        const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || 'Portuguese';

        const prompt = `Translate the following YouTube video transcript from ${sourceName} to ${targetName}. 
Preserve the timestamps [MM:SS] exactly as they appear. 
Format each timestamped line clearly. 
Transcript:
${chunkText}`;

        const result = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: prompt,
        });

        fullTranslation += (result.text || '') + '\n\n';
        setProgress(40 + Math.floor(((i + 1) / chunks.length) * 50));
      }

      setTranslatedText(fullTranslation.trim());
      setProgress(100);
      setSuccess('Translation completed!');
      setActiveTab('translate');

      // Save to history (mocking title for now, ideally fetch from YT API)
      saveToHistory({
        id: Date.now().toString(),
        videoId,
        title: `Video ${videoId}`,
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
        sourceLang,
        targetLang,
        transcript: transcriptData,
        translation: fullTranslation,
        timestamp: Date.now()
      });

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const seekTo = (timestampStr: string) => {
    // Expected format [MM:SS] or [HH:MM:SS]
    const parts = timestampStr.replace(/[\[\]]/g, '').split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    }

    if (playerRef.current) {
      playerRef.current.seekTo(seconds, true);
      playerRef.current.playVideo();
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(translatedText);
    setSuccess('Copied to clipboard!');
  };

  const downloadFile = (type: 'txt' | 'srt') => {
    let content = translatedText;
    let filename = `translation_${currentVideoId}.${type}`;

    if (type === 'srt') {
      // Basic SRT conversion from the text format
      // Note: This is a simplified version
      content = translatedText.split('\n').filter(line => line.includes('[')).map((line, index) => {
        const match = line.match(/\[(\d+:\d+:\d+|\d+:\d+)\]/);
        if (!match) return '';
        const timestamp = match[1];
        const text = line.replace(match[0], '').trim();
        // Convert [MM:SS] to 00:MM:SS,000
        const parts = timestamp.split(':');
        const hh = parts.length === 3 ? parts[0].padStart(2, '0') : '00';
        const mm = (parts.length === 3 ? parts[1] : parts[0]).padStart(2, '0');
        const ss = (parts.length === 3 ? parts[2] : parts[1]).padStart(2, '0');
        const startTime = `${hh}:${mm}:${ss},000`;
        const endTimeStr = parts.length === 2 ? `${hh}:${mm}:${(Number(ss)+5).toString().padStart(2, '0')},000` : startTime; // Crude end time

        return `${index + 1}\n${startTime} --> ${endTimeStr}\n${text}\n`;
      }).filter(Boolean).join('\n');
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadFromHistory = (item: TranslationHistory) => {
    setCurrentVideoId(item.videoId);
    setTranscript(item.transcript);
    setTranslatedText(item.translation);
    setSourceLang(item.sourceLang);
    setTargetLang(item.targetLang);
    setUrl(`https://www.youtube.com/watch?v=${item.videoId}`);
    setActiveTab('translate');
  };

  return (
    <div className="flex bg-yt-black h-screen w-screen overflow-hidden selection:bg-yt-red/30 selection:text-white">
      {/* Sidebar - History & Nav */}
      <aside className="w-[240px] bg-yt-surface border-r border-yt-line flex flex-col p-5 shrink-0">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-6 h-4.5 bg-yt-red rounded-[4px] relative after:content-[''] after:absolute after:left-[9px] after:top-[5px] after:border-l-[7px] after:border-l-white after:border-t-[4px] after:border-t-transparent after:border-b-[4px] after:border-b-transparent"></div>
          <h1 className="font-display text-xl text-yt-red tracking-tight uppercase">VidTranslate</h1>
        </div>

        <nav className="mb-8">
          <label className="text-[10px] uppercase tracking-[2px] text-yt-dim font-bold mb-3 block">Main</label>
          <div className="space-y-1">
            <NavItem active={activeTab === 'home' || activeTab === 'translate'} icon={<Play className="w-4 h-4" />} label="Translate" onClick={() => setActiveTab('home')} />
            <NavItem active={activeTab === 'history'} icon={<HistoryIcon className="w-4 h-4" />} label="My Library" onClick={() => setActiveTab('history')} />
            <NavItem active={activeTab === 'settings'} icon={<SettingsIcon className="w-4 h-4" />} label="Voice Settings" onClick={() => setActiveTab('settings')} />
          </div>
        </nav>

        <nav className="flex-1 overflow-hidden flex flex-col">
          <label className="text-[10px] uppercase tracking-[2px] text-yt-dim font-bold mb-3 block">Recent History</label>
          <div className="space-y-3 overflow-y-auto pr-2 transcript-scrollbar">
            {history.length === 0 ? (
              <p className="text-xs text-yt-dim italic opacity-50 px-2">No history yet</p>
            ) : (
              history.map(item => (
                <button 
                  key={item.id} 
                  onClick={() => loadFromHistory(item)}
                  className="flex gap-3 text-left group w-full p-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <div className="w-[60px] h-[34px] bg-yt-line rounded-[4px] shrink-0 overflow-hidden relative">
                    <img src={item.thumbnail} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-white/90 truncate group-hover:text-yt-red transition-colors">Video {item.videoId}</p>
                    <p className="text-[9px] text-yt-dim uppercase tracking-wider">{item.sourceLang} → {item.targetLang}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </nav>

        <div className="mt-auto pt-4 border-t border-yt-line">
           <div className="text-[10px] text-yt-dim mb-1">System Status</div>
           <div className="flex items-center gap-2 text-[10px] text-emerald-500 font-bold uppercase tracking-wider">
             <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
             Gemini 2.0 Flash Active
           </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col p-6 gap-5 overflow-hidden">
        {/* URL Bar */}
        <div className="flex gap-3 bg-yt-surface p-1.5 rounded-xl border border-yt-line focus-within:border-yt-red/50 transition-colors">
          <input 
            type="text" 
            placeholder="Paste YouTube URL here (youtu.be/...)" 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1 bg-transparent border-none text-white px-3 py-2 text-sm outline-none placeholder:text-yt-dim/40"
          />
          <button 
            onClick={handleTranslate}
            disabled={loading || !url}
            className="bg-yt-red hover:bg-yt-red/90 disabled:opacity-50 text-white px-6 rounded-lg font-display text-[11px] uppercase tracking-wider transition-all active:scale-[0.97]"
          >
            {loading ? 'Translating...' : 'Translate'}
          </button>
        </div>

        {/* Progress Bar (Workspace Top) */}
        {loading && (
          <div className="space-y-2 px-2">
            <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest text-yt-dim">
              <span>Processing AI Pipeline...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1 bg-yt-line rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                className="h-full bg-yt-red"
              />
            </div>
          </div>
        )}

        {/* Workspace Display */}
        <div className="flex-1 flex flex-col gap-5 min-h-0">
          <div className="aspect-video w-full bg-black rounded-xl overflow-hidden border border-yt-line shadow-2xl relative">
             <div id="yt-player-container" className="w-full h-full"></div>
             {!currentVideoId && (
               <div className="absolute inset-0 flex flex-col items-center justify-center text-yt-dim/30">
                 <Youtube className="w-16 h-16 mb-4 stroke-[1]" />
                 <p className="text-xs font-display uppercase tracking-[3px]">Waiting for input</p>
               </div>
             )}
          </div>

          <div className="flex-1 grid grid-cols-2 gap-5 min-h-0">
            {/* Source Box */}
            <div className="bg-yt-surface rounded-xl p-4 flex flex-col gap-3 min-h-0 border border-yt-line/50">
              <div className="flex justify-between items-center text-[10px] font-bold text-yt-dim uppercase tracking-[2px] pb-2 border-b border-yt-line">
                <span>Source (Auto)</span>
                <span>English</span>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 transcript-scrollbar space-y-3">
                {transcript.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-yt-dim/20 text-xs italic">Transcript will appear here</div>
                ) : (
                  transcript.map((item, idx) => (
                    <div key={idx} className="flex gap-4 group">
                      <span className="text-yt-red font-mono text-[10px] shrink-0 pt-1 opacity-40">[{formatTime(item.offset/1000)}]</span>
                      <p className="text-xs text-white/70 leading-relaxed">{item.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Translation Box */}
            <div className="bg-yt-surface rounded-xl p-4 flex flex-col gap-3 min-h-0 border border-yt-line/50">
              <div className="flex justify-between items-center text-[10px] font-bold text-yt-dim uppercase tracking-[2px] pb-2 border-b border-yt-line">
                <span>Translation</span>
                <span>{LANGUAGES.find(l => l.code === targetLang)?.name}</span>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 transcript-scrollbar space-y-6 pt-2">
                {!translatedText ? (
                  <div className="h-full flex items-center justify-center text-yt-dim/20 text-xs italic">Translation will appear here</div>
                ) : (
                  translatedText.split('\n\n').map((para, i) => (
                    <div key={i} className="space-y-4">
                      {para.split('\n').map((line, j) => {
                        const tsMatch = line.match(/\[(\d+:\d+:\d+|\d+:\d+)\]/);
                        const ts = tsMatch ? tsMatch[1] : null;
                        const content = ts ? line.replace(tsMatch![0], '').trim() : line;
                        if (!content) return null;
                        return (
                          <div key={j} className="flex gap-4 group cursor-pointer" onClick={() => ts && seekTo(ts)}>
                            {ts && <span className="text-yt-red font-mono text-[10px] shrink-0 pt-1 group-hover:underline">[{ts}]</span>}
                            <p className="text-xs text-white/90 leading-relaxed group-hover:text-white transition-colors">{content}</p>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Right Settings Panel */}
      <aside className="w-[280px] bg-yt-surface border-l border-yt-line flex flex-col p-6 gap-8 shrink-0">
        <div className="space-y-4">
          <label className="text-[10px] uppercase tracking-[2px] text-yt-dim font-bold block">Language Pair</label>
          <div className="flex items-center justify-between bg-yt-black p-4 rounded-lg border border-yt-line text-sm">
            <span className="text-white/80">{LANGUAGES.find(l => l.code === sourceLang)?.name}</span>
            <span className="text-yt-red">→</span>
            <span className="text-white/80">{LANGUAGES.find(l => l.code === targetLang)?.name}</span>
          </div>
          <p className="text-[9px] text-yt-dim italic text-center px-4">Change detected automatically from video URL metadata.</p>
        </div>

        <div className="space-y-4">
          <label className="text-[10px] uppercase tracking-[2px] text-yt-dim font-bold block">Export Actions</label>
          <div className="flex flex-col gap-3">
            <ActionButton icon={<Copy className="w-3.5 h-3.5" />} label="Copy Transcript" onClick={copyToClipboard} />
            <ActionButton icon={<Download className="w-3.5 h-3.5" />} label="Download .SRT Subtitles" onClick={() => downloadFile('srt')} />
            <ActionButton icon={<ExternalLink className="w-3.5 h-3.5" />} label="Open Original Source" onClick={() => window.open(url, '_blank')} />
          </div>
        </div>

        <div className="mt-auto space-y-4">
          <div className="bg-yt-black p-4 rounded-xl border border-yt-line/50 space-y-3">
            <div className="text-[9px] uppercase tracking-[1px] text-yt-dim mb-2 font-bold opacity-60">System Insights</div>
            <div className="flex justify-between items-center text-[11px]">
               <span className="text-yt-dim">AI Model</span>
               <span className="text-white/80 font-mono">Gemini 2.0 F</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
               <span className="text-yt-dim">Latency</span>
               <span className="text-emerald-500 font-mono">240ms</span>
            </div>
          </div>

          <div className="p-4 bg-yt-red/5 rounded-xl border border-yt-red/10 text-center">
            <p className="text-[10px] text-yt-red/80 font-bold uppercase tracking-widest italic">PWA Optimized v1.2</p>
          </div>
        </div>
      </aside>

      {/* Notifications Overlay */}
      <AnimatePresence>
        {(success || error) && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-full max-w-xs"
          >
            <div className={cn(
              "px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 backdrop-blur-md border",
              success ? "bg-emerald-500/90 border-emerald-400 text-white" : "bg-yt-red/90 border-yt-red text-white"
            )}>
              {success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <p className="text-[11px] font-bold uppercase tracking-wider">{success || error}</p>
              <button onClick={() => { setSuccess(null); setError(null); }} className="ml-auto opacity-50 hover:opacity-100">×</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean, icon: ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full p-2.5 rounded-lg text-sm transition-all relative overflow-hidden",
        active ? "text-white font-semibold bg-white/5" : "text-yt-dim hover:text-white"
      )}
    >
      {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-yt-red rounded-full" />}
      <span className={cn(active ? "text-yt-red" : "opacity-70")}>{icon}</span>
      <span className="text-xs transition-colors">{label}</span>
    </button>
  );
}

function ActionButton({ icon, label, onClick }: { icon: ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center justify-between w-full bg-[#2a2a2a] hover:bg-[#333] border border-white/5 p-3 rounded-lg text-xs text-white/80 transition-all active:scale-[0.98]"
    >
      <div className="flex items-center gap-3">
        <span className="text-yt-dim">{icon}</span>
        <span>{label}</span>
      </div>
      <ChevronDown className="w-3 h-3 text-yt-dim -rotate-90" />
    </button>
  );
}


function NavButton({ active, icon, label, onClick }: { active: boolean, icon: ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 transition-all duration-300 relative px-4",
        active ? "text-yt-red scale-110" : "text-white/30 hover:text-white/60"
      )}
    >
      {active && (
        <motion.div 
          layoutId="active-pill"
          className="absolute -top-1 w-12 h-0.5 bg-yt-red shadow-[0_-2px_6px_rgba(255,0,0,0.6)]"
        />
      )}
      <div className={cn(
        "p-1 rounded-xl transition-all",
        active ? "bg-yt-red/10 animate-pulse" : "bg-transparent"
      )}>
        {icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-tight italic font-display">{label}</span>
    </button>
  );
}

