import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { get, set, keys, del } from 'idb-keyval';
import { 
  Upload, 
  Link as LinkIcon, 
  Settings, 
  Zap, 
  Download, 
  Trash2, 
  FileVideo, 
  History, 
  Loader2, 
  CheckCircle2,
  AlertCircle,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface CompressedVideo {
  id: string;
  name: string;
  originalSize: number;
  compressedSize: number;
  data: Blob;
  timestamp: number;
}

interface CompressionSettings {
  crf: number; // 0-51 (lower is better quality, 23-28 is standard)
  scale: string; // "1280:-1"
  preset: string; // "ultrafast", "medium", etc.
  startTime: string;
  endTime: string;
}

export default function App() {
  // --- State ---
  const [ffmpeg, setFfmpeg] = useState<FFmpeg | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const [inputVideo, setInputVideo] = useState<File | string | null>(null);
  const [inputPreview, setInputPreview] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  
  const [settings, setSettings] = useState<CompressionSettings>({
    crf: 28,
    scale: '1280:-1',
    preset: 'medium',
    startTime: '00:00:00',
    endTime: ''
  });
  
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  
  const [compressedHistory, setCompressedHistory] = useState<CompressedVideo[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const ffmpegRef = useRef<FFmpeg>(new FFmpeg());

  // --- Effects ---
  useEffect(() => {
    loadFFmpeg();
    loadHistory();
  }, []);

  // --- Logic ---
  const loadFFmpeg = async () => {
    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      const ffmpeg = ffmpegRef.current;
      
      ffmpeg.on('log', ({ message }) => {
        console.log(message);
      });
      
      ffmpeg.on('progress', ({ progress }) => {
        setProgress(Math.round(progress * 100));
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      
      setFfmpeg(ffmpeg);
      setIsLoaded(true);
    } catch (err) {
      console.error('Failed to load FFmpeg:', err);
      setError('FFmpeg could not be loaded. Please check if your browser supports SharedArrayBuffer.');
    }
  };

  const loadHistory = async () => {
    const allKeys = await keys();
    const history: CompressedVideo[] = [];
    for (const key of allKeys) {
      if (typeof key === 'string' && key.startsWith('video_')) {
        const item = await get(key);
        if (item) history.push(item);
      }
    }
    setCompressedHistory(history.sort((a, b) => b.timestamp - a.timestamp));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log('File detected:', file.name, '| Size:', formatSize(file.size), '| Type:', file.type);
      setInputVideo(file);
      setInputPreview(URL.createObjectURL(file));
      setError(null);
      // Reset cutting points
      setSettings(prev => ({ ...prev, startTime: '00:00:00', endTime: '' }));
    }
  };

  const handleUrlLoad = () => {
    if (!urlInput) return;
    console.log('Attempting to load remote URL:', urlInput);
    setInputVideo(urlInput);
    setInputPreview(urlInput);
    setUrlInput('');
    setError(null);
    // Reset cutting points
    setSettings(prev => ({ ...prev, startTime: '00:00:00', endTime: '' }));
  };

  const onVideoLoad = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const duration = e.currentTarget.duration;
    setVideoDuration(duration);
    console.log('Video duration detected:', duration, 'seconds');
    // Set default end time if not set
    if (!settings.endTime) {
      const hours = Math.floor(duration / 3600).toString().padStart(2, '0');
      const mins = Math.floor((duration % 3600) / 60).toString().padStart(2, '0');
      const secs = Math.floor(duration % 60).toString().padStart(2, '0');
      setSettings(prev => ({ ...prev, endTime: `${hours}:${mins}:${secs}` }));
    }
  };

  const compressVideo = async () => {
    console.log('>>> EXECUTE TASKS INITIATED');
    if (!ffmpeg) {
      console.error('FFmpeg not initialized');
      setError('FFmpeg is not initialized yet.');
      return;
    }
    if (!inputVideo) {
      console.error('No input video selected');
      setError('Please select a video first.');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setError(null);

    const inputName = typeof inputVideo === 'string' ? 'input.mp4' : inputVideo.name;
    const outputName = `compressed_${Date.now()}.mp4`;

    // Filter args: only add -ss and -to if they are valid
    const args = [];
    
    if (settings.startTime && settings.startTime !== '00:00:00') {
      args.push('-ss', settings.startTime);
    }
    
    args.push('-i', inputName);
    
    if (settings.endTime) {
      args.push('-to', settings.endTime);
    }

    args.push(
      '-vcodec', 'libx264',
      '-crf', settings.crf.toString(),
      '-preset', settings.preset,
      '-vf', `scale=${settings.scale}`,
      outputName
    );

    console.log('Command Arguments:', args.join(' '));

    try {
      console.log('Writing file to virtual FS...');
      const fileData = await fetchFile(inputVideo);
      await ffmpeg.writeFile(inputName, fileData);
      console.log('Write complete. Executing command...');

      const result = await ffmpeg.exec(args);
      console.log('FFmpeg execution result code:', result);

      if (result !== 0) {
        throw new Error(`FFmpeg exited with code ${result}`);
      }

      console.log('Reading output file...');
      const data = await ffmpeg.readFile(outputName) as Uint8Array;
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      
      console.log('Compression successful. Blob size:', formatSize(blob.size));
      
      const originalSize = typeof inputVideo === 'string' ? 0 : inputVideo.size;
      
      const newVideo: CompressedVideo = {
        id: `video_${Date.now()}`,
        name: outputName,
        originalSize,
        compressedSize: blob.size,
        data: blob,
        timestamp: Date.now()
      };

      await set(newVideo.id, newVideo);
      setCompressedHistory(prev => [newVideo, ...prev]);
      
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
      console.log('Cleaned up virtual FS.');
      
      setIsProcessing(false);
    } catch (err) {
      console.error('CRITICAL ERROR DURING COMPRESSION:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Compression failed: ${errorMsg}`);
      setIsProcessing(false);
    }
  };

  const downloadVideo = (video: CompressedVideo) => {
    const url = URL.createObjectURL(video.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = video.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const deleteFromHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await del(id);
    setCompressedHistory(prev => prev.filter(v => v.id !== id));
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // --- UI Components ---
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0c0d0f] text-[#e0e0e0] font-sans selection:bg-[#00ff66]/20">
      {/* Header Bar */}
      <header className="h-14 border-b border-ui flex items-center justify-between px-6 bg-card shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-accent rounded flex items-center justify-center">
            <Zap className="text-black w-5 h-5 fill-black" />
          </div>
          <h1 className="text-sm font-bold tracking-tight uppercase flex items-center gap-2">
            WASM-FFMPEG <span className="text-[10px] font-mono opacity-50 bg-black/40 px-1.5 py-0.5 rounded border border-ui">v0.12.6-web</span>
          </h1>
        </div>
        
        <div className="hidden md:flex items-center gap-6 text-[10px] font-mono tracking-wider">
          <div className="flex items-center gap-2 uppercase">
            <span className={`w-2 h-2 rounded-full ${isLoaded ? 'bg-accent shadow-[0_0_8px_#00ff66]' : 'bg-red-500 shadow-[0_0_8px_red]'}`}></span> 
            SharedArrayBuffer: {window.SharedArrayBuffer ? 'ENABLED' : 'DISABLED'}
          </div>
          <div className="flex items-center gap-2 uppercase">
            <span className={`w-2 h-2 rounded-full ${isLoaded ? 'bg-accent shadow-[0_0_8px_#00ff66]' : 'bg-zinc-500'}`}></span>
            WASM_RUNTIME: {isLoaded ? 'ACTIVE' : 'IDLE'}
          </div>
          <div className="opacity-50 uppercase tracking-widest border-l border-ui pl-6">
            Status: {isProcessing ? 'BUSY' : 'READY'}
          </div>
        </div>
      </header>

      {/* Main Command Console */}
      <main className="flex-1 grid grid-cols-12 gap-px bg-[#2a2c31] overflow-hidden min-h-0">
        {/* Left Sidebar: Ingestion */}
        <section className="col-span-12 md:col-span-3 bg-card p-4 flex flex-col gap-6 overflow-y-auto border-r border-[#2a2c31]">
          <div className="space-y-6">
            <div>
              <label className="text-[10px] uppercase font-bold opacity-50 mb-3 block tracking-[0.2em]">Input Operations</label>
              <div className="relative group overflow-hidden">
                <input 
                  type="file" 
                  accept="video/*" 
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="border border-ui border-dashed rounded p-5 bg-black/20 hover:bg-black/40 transition-colors text-center">
                  <Upload className="w-5 h-5 mx-auto mb-2 text-accent/60 group-hover:text-accent transition-colors" />
                  <div className="text-[11px] font-bold uppercase tracking-tight mb-1">Inject Local Blob</div>
                  <div className="text-[9px] opacity-40 font-mono">MP4, MOV, WEBM, AVI</div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold opacity-50 mb-3 block tracking-[0.2em]">Remote Ingestion</label>
              <div className="flex">
                <input 
                  type="text" 
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://source-stream.mp4"
                  className="bg-black/40 border border-ui rounded-l px-3 py-1.5 text-[11px] font-mono flex-1 outline-none focus:border-accent/40"
                />
                <button 
                  onClick={handleUrlLoad}
                  className="bg-[#2a2c31] hover:bg-[#32353a] px-3 rounded-r text-[10px] font-black uppercase transition-colors"
                >
                  LOAD
                </button>
              </div>
            </div>
          </div>

          <div className="mt-auto p-4 border border-ui bg-black/20 rounded shadow-inner">
            <div className="text-[10px] uppercase font-black opacity-30 mb-3 tracking-widest flex items-center justify-between">
              Runtime Metadata
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            </div>
            <div className="space-y-2 text-[10px] font-mono">
              <div className="flex justify-between border-b border-ui/30 pb-1">
                <span className="opacity-40 uppercase">Mode</span>
                <span className="text-accent/80">Vort-X Gen2</span>
              </div>
              <div className="flex justify-between border-b border-ui/30 pb-1">
                <span className="opacity-40 uppercase">Input</span>
                <span className="truncate max-w-[120px]">
                  {typeof inputVideo === 'string' ? 'Remote' : (inputVideo?.name || 'Null')}
                </span>
              </div>
              <div className="flex justify-between border-b border-ui/30 pb-1">
                <span className="opacity-40 uppercase">Size</span>
                <span>{typeof inputVideo === 'string' ? "N/A" : formatSize(inputVideo?.size || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-40 uppercase">Format</span>
                <span>FF-{inputVideo ? 'DETECTED' : 'VOID'}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Center Section: Core Processing */}
        <section className="col-span-12 md:col-span-6 bg-[#090a0c] flex flex-col p-6 relative min-h-0">
          <div className="flex-1 rounded border border-ui flex items-center justify-center bg-black overflow-hidden relative shadow-inner">
            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#2a2c31 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
            
            {inputPreview ? (
              <video 
                src={inputPreview} 
                controls 
                onLoadedMetadata={onVideoLoad}
                className="max-h-full max-w-full z-10"
              />
            ) : (
              <div className="z-10 text-center space-y-4">
                <div className="w-16 h-16 rounded-full border border-ui flex items-center justify-center mx-auto bg-black/40">
                  <Play className="w-6 h-6 text-zinc-800" />
                </div>
                <div className="text-[10px] opacity-30 font-mono uppercase tracking-[0.4em]">Media Preview Node</div>
              </div>
            )}

            {isProcessing && (
              <div className="absolute inset-0 bg-black/60 z-20 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
                <div className="text-[10px] items-center text-accent font-mono uppercase tracking-[0.3em]">Processing Frame Buffer...</div>
              </div>
            )}
          </div>

          <div className="h-24 mt-6 flex gap-4 items-center shrink-0">
            <div className="flex-1 h-full bg-card rounded border border-ui p-4 flex flex-col justify-between shadow-sm">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] uppercase font-bold tracking-widest opacity-40 font-mono">Stream Transcode Progress</span>
                <span className="text-xs text-accent font-mono font-bold tracking-tighter">{progress}%</span>
              </div>
              <div className="h-1.5 w-full bg-black/50 rounded-full overflow-hidden border border-ui/20">
                <motion.div 
                  className="h-full bg-accent shadow-[0_0_12px_#00ff66]"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                />
              </div>
              <div className="text-[9px] opacity-30 font-mono uppercase tracking-widest truncate mt-2">
                FFMPEG RUNTIME: {isLoaded ? 'OK' : 'WAIT'} • THREADS: 0 • MEMORY: SHARED
              </div>
            </div>
            
            <button 
              disabled={!isLoaded || !inputVideo || isProcessing}
              onClick={compressVideo}
              className={`h-full px-10 font-black uppercase text-xs tracking-[0.2em] rounded shadow-[0_0_30px_rgba(0,255,102,0.15)] hover:shadow-[0_0_40px_rgba(0,255,102,0.25)] active:scale-95 transition-all disabled:opacity-30 disabled:grayscale flex items-center justify-center gap-3 ${isProcessing ? 'bg-zinc-800 text-accent cursor-wait' : 'bg-accent text-black'}`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                'Execute Tasks'
              )}
            </button>
          </div>
        </section>

        {/* Right Sidebar: Arguments / Parameters */}
        <section className="col-span-12 md:col-span-3 bg-card p-4 flex flex-col gap-6 overflow-y-auto border-l border-[#2a2c31]">
          <div className="space-y-4 flex-1 flex flex-col min-h-0">
            <label className="text-[10px] uppercase font-black tracking-[0.2em] opacity-40">FFMPEG CLI Schema</label>
            <div className="flex-1 bg-black/40 border border-ui rounded p-4 font-mono text-[11px] leading-relaxed text-accent/70 overflow-y-auto custom-scrollbar">
              <div className="opacity-40 font-bold mb-2">// Active Command Chain</div>
              -ss <span className="text-accent">{settings.startTime}</span><br />
              -i {typeof inputVideo === 'string' ? 'remote_url' : 'input.bin'}<br />
              -to <span className="text-accent">{settings.endTime}</span><br />
              -vcodec libx264<br />
              -crf <span className="text-accent">{settings.crf}</span><br />
              -preset {settings.preset}<br />
              -vf scale=<span className="text-accent">{settings.scale}</span><br />
              -threads 0<br />
              output_final.mp4
            </div>
          </div>

          <div className="space-y-6 pt-6 border-t border-ui shrink-0">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-zinc-500 font-mono block">Start Cut</label>
                  <input 
                    type="text" 
                    value={settings.startTime}
                    onChange={(e) => setSettings(prev => ({ ...prev, startTime: e.target.value }))}
                    className="w-full bg-black border border-ui text-[11px] px-2 py-1.5 rounded font-mono text-accent/80 focus:border-accent/40 outline-none"
                    placeholder="00:00:00"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-zinc-500 font-mono block">End Cut</label>
                  <input 
                    type="text" 
                    value={settings.endTime}
                    onChange={(e) => setSettings(prev => ({ ...prev, endTime: e.target.value }))}
                    className="w-full bg-black border border-ui text-[11px] px-2 py-1.5 rounded font-mono text-accent/80 focus:border-accent/40 outline-none"
                    placeholder="00:00:10"
                  />
                </div>
              </div>

              <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[11px] uppercase font-bold text-zinc-400 font-mono">Quality Gate</span>
                <span className="text-xs text-accent font-mono">{settings.crf}</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="51" 
                value={settings.crf}
                onChange={(e) => setSettings(prev => ({ ...prev, crf: parseInt(e.target.value) }))}
                className="w-full accent-accent h-1"
              />
            </div>

            <div className="space-y-3">
              <label className="text-[11px] uppercase font-bold text-zinc-400 font-mono block">Node Target Scale</label>
              <select 
                value={settings.scale}
                onChange={(e) => setSettings(prev => ({ ...prev, scale: e.target.value }))}
                className="w-full bg-black border border-ui text-[11px] px-3 py-2 rounded focus:outline-none focus:border-accent/40 font-mono text-accent/80"
              >
                <option value="1920:-1">NATIVE (1080p)</option>
                <option value="1280:-1">HD_LITE (720p)</option>
                <option value="854:-1">STD_DEF (480p)</option>
                <option value="640:-1">TINY_RES (360p)</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="text-[11px] uppercase font-bold text-zinc-400 font-mono block">Computational Preset</label>
              <select 
                value={settings.preset}
                onChange={(e) => setSettings(prev => ({ ...prev, preset: e.target.value }))}
                className="w-full bg-black border border-ui text-[11px] px-3 py-2 rounded focus:outline-none focus:border-accent/40 font-mono text-accent/80"
              >
                <option value="ultrafast">ULTRAFAST</option>
                <option value="veryfast">VERYFAST</option>
                <option value="medium">BALANCED</option>
                <option value="slower">DEEP_PROCESS</option>
              </select>
            </div>
          </div>
        </section>
      </main>

      {/* Footer: Vault / Archive */}
      <footer className="h-20 bg-[#0c0d0f] border-t border-ui px-6 flex items-center gap-6 shrink-0 z-10">
        <div className="text-[10px] uppercase font-black opacity-30 whitespace-nowrap tracking-[0.3em] flex items-center gap-2">
          <History className="w-3 h-3" />
          Archive Vault
        </div>
        
        <div className="flex gap-3 overflow-x-auto no-scrollbar py-2">
          {compressedHistory.length === 0 ? (
            <div className="text-[10px] opacity-20 font-mono uppercase tracking-widest italic flex items-center h-12">
              No historical data in local persistence
            </div>
          ) : (
            compressedHistory.map(item => (
              <div 
                key={item.id} 
                className="h-12 w-56 border border-ui rounded bg-card flex items-center px-3 gap-3 flex-shrink-0 group hover:border-accent transition-colors relative cursor-pointer shadow-sm"
                onClick={() => downloadVideo(item)}
              >
                <div className="w-8 h-8 bg-black/40 rounded flex items-center justify-center shrink-0">
                  <FileVideo className="w-4 h-4 text-accent/40 group-hover:text-accent transition-colors" />
                </div>
                <div className="flex-1 min-w-0 pr-6">
                  <div className="text-[9px] font-bold truncate uppercase tracking-tighter text-zinc-300">{item.name}</div>
                  <div className="text-[8px] opacity-40 font-mono uppercase">
                    {formatSize(item.compressedSize)} • {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <button 
                  onClick={(e) => deleteFromHistory(item.id, e)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="ml-auto hidden lg:block opacity-20 hover:opacity-100 transition-opacity">
          <Download className="w-4 h-4 text-accent" />
        </div>
      </footer>
    </div>
  );
}
