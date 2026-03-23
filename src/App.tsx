import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { Send, User, Users, LogOut, MessageSquare, Pencil, Eraser, Trash2, Trophy, Clock, Settings, Play, ThumbsUp, ThumbsDown, UserMinus, Droplets, Circle, Square, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';

// Sound URLs (using public placeholders)
const SOUNDS = {
  JOIN: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
  GUESS: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
  TURN: 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3',
  WIN: 'https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3',
};

const playSound = (url: string) => {
  const audio = new Audio(url);
  audio.volume = 0.4;
  audio.play().catch(() => {}); // Ignore autoplay blocks
};

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

interface UserData {
  id: string;
  username: string;
  score: number;
  color: string;
  avatar?: string;
  votesCount?: number;
}

interface GameState {
  gameActive: boolean;
  currentDrawer: string | null;
  drawerName: string | null;
  round: number;
  maxRounds: number;
  timeLeft: number;
  word: string | null;
  category: string | null;
  hint: string | null;
}

const COLORS = [
  '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#FFA500', '#800080', '#A52A2A', '#808080', '#FFFFFF'
];

const BRUSH_SIZES = [2, 5, 10, 20];

export default function App() {
  const [username, setUsername] = useState<string>('');
  const [userColor, setUserColor] = useState<string>(COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [isJoined, setIsJoined] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<UserData[]>([]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarBrushSize, setAvatarBrushSize] = useState(5);
  const [feedback, setFeedback] = useState({ likes: 0, dislikes: 0 });
  const [tool, setTool] = useState<'pencil' | 'eraser' | 'fill'>('pencil');
  const avatarCanvasRef = useRef<HTMLCanvasElement>(null);
  const avatarLastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Initialize high-DPI canvas for avatar
  useEffect(() => {
    const canvas = avatarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    // Set initial canvas state
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [isJoined]); // Re-run if we go back to join screen

  const handleAvatarDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = avatarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (avatarLastPosRef.current) {
      ctx.strokeStyle = userColor;
      ctx.lineWidth = avatarBrushSize * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(avatarLastPosRef.current.x, avatarLastPosRef.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.fillStyle = userColor;
      ctx.beginPath();
      ctx.arc(x, y, avatarBrushSize, 0, Math.PI * 2);
      ctx.fill();
    }
    
    avatarLastPosRef.current = { x, y };
    setAvatar(canvas.toDataURL());
  };

  const startAvatarDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = avatarCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    avatarLastPosRef.current = { x, y };
    
    // Draw a single dot on click
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = userColor;
      ctx.beginPath();
      ctx.arc(x, y, avatarBrushSize, 0, Math.PI * 2);
      ctx.fill();
      setAvatar(canvas.toDataURL());
    }
  };

  const stopAvatarDrawing = () => {
    avatarLastPosRef.current = null;
  };
  const [gameState, setGameState] = useState<GameState>({
    gameActive: false,
    currentDrawer: null,
    drawerName: null,
    round: 0,
    maxRounds: 3,
    timeLeft: 0,
    word: null,
    category: null,
    hint: null
  });
  const [gameSettings, setGameSettings] = useState({ rounds: 3, time: 60 });
  const [showSettings, setShowSettings] = useState(false);
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [brushStyle, setBrushStyle] = useState<'round' | 'square' | 'glow'>('round');
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize high-DPI canvas for game
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isJoined) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    // Set internal resolution
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    // Scale context to match CSS pixels
    ctx.scale(dpr, dpr);
    
    // Set initial canvas state
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }, [isJoined]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('message', (msg: Message) => {
      setMessages((prev) => [...prev, msg]);
    });

    socketRef.current.on('history', (history: Message[]) => {
      setMessages(history);
    });

    socketRef.current.on('users', (users: UserData[]) => {
      setOnlineUsers(users);
    });

    socketRef.current.on('new-round', (data) => {
      playSound(SOUNDS.TURN);
      setGameState(prev => ({
        ...prev,
        gameActive: true,
        currentDrawer: data.drawerId,
        drawerName: data.drawer,
        round: data.round,
        maxRounds: data.maxRounds,
        timeLeft: data.timeLeft,
        category: data.category,
        hint: data.hint,
        word: null // Reset word for non-drawers
      }));
      clearCanvasLocal();
    });

    socketRef.current.on('hint-update', (hint: string) => {
      setGameState(prev => ({ ...prev, hint }));
    });

    socketRef.current.on('your-word', (word: string) => {
      setGameState(prev => ({ ...prev, word }));
    });

    socketRef.current.on('timer-update', (time: number) => {
      setGameState(prev => ({ ...prev, timeLeft: time }));
    });

    socketRef.current.on('turn-ended', (data) => {
      setGameState(prev => ({ ...prev, word: data.word }));
      // Show word reveal for a few seconds
    });

    socketRef.current.on('game-over', (results: UserData[]) => {
      playSound(SOUNDS.WIN);
      setGameState(prev => ({ ...prev, gameActive: false }));
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 }
      });
    });

    socketRef.current.on('draw-line', (data) => {
      drawLineLocal(data.start, data.end, data.color, data.size, data.style);
    });

    socketRef.current.on('fill-canvas', (data) => {
      fillCanvasLocal(data.pos, data.color);
    });

    socketRef.current.on('drawing-feedback', (data) => {
      setFeedback(data);
    });

    socketRef.current.on('kicked', () => {
      alert('You have been kicked from the game.');
      window.location.reload();
    });

    socketRef.current.on('clear-canvas', () => {
      clearCanvasLocal();
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const drawLineLocal = (start: { x: number; y: number }, end: { x: number; y: number }, color: string, size: number, style: string = 'round') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    
    // Reset effects
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    
    if (style === 'square') {
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
    } else if (style === 'glow') {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = size;
      ctx.shadowColor = color;
    } else {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }

    ctx.beginPath();
    if (start.x === end.x && start.y === end.y) {
      // Single point
      ctx.arc(start.x, start.y, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    ctx.closePath();
    
    // Reset shadow for next operations
    ctx.shadowBlur = 0;
  };

  const fillCanvasLocal = (pos: { x: number; y: number }, color: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const internalX = Math.floor(pos.x * dpr);
    const internalY = Math.floor(pos.y * dpr);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const targetColor = getPixelColor(imageData, internalX, internalY);
    const fillColor = hexToRgb(color);

    if (colorsMatch(targetColor, fillColor)) return;

    const pixelsToCheck = [internalX, internalY];
    while (pixelsToCheck.length > 0) {
      const y = pixelsToCheck.pop()!;
      const x = pixelsToCheck.pop()!;

      const currentColor = getPixelColor(imageData, x, y);
      if (colorsMatch(currentColor, targetColor)) {
        setPixelColor(imageData, x, y, fillColor);

        if (x > 0) pixelsToCheck.push(x - 1, y);
        if (x < canvas.width - 1) pixelsToCheck.push(x + 1, y);
        if (y > 0) pixelsToCheck.push(x, y - 1);
        if (y < canvas.height - 1) pixelsToCheck.push(x, y + 1);
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const getPixelColor = (img: ImageData, x: number, y: number) => {
    const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  };

  const setPixelColor = (img: ImageData, x: number, y: number, color: number[]) => {
    const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
    img.data[i] = color[0];
    img.data[i + 1] = color[1];
    img.data[i + 2] = color[2];
    img.data[i + 3] = 255;
  };

  const colorsMatch = (c1: number[], c2: number[]) => {
    return c1[0] === c2[0] && c1[1] === c2[1] && c1[2] === c2[2];
  };

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
  };

  const clearCanvasLocal = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Save current transform, reset to clear everything, then restore
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      playSound(SOUNDS.JOIN);
      socketRef.current?.emit('join', { username: username.trim(), color: userColor, avatar });
      setIsJoined(true);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      socketRef.current?.emit('chatMessage', message.trim());
      setMessage('');
    }
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState.currentDrawer !== socketRef.current?.id) return;
    const pos = getPos(e);
    if (tool === 'fill') {
      fillCanvasLocal(pos, brushColor);
      socketRef.current?.emit('fill-canvas', { pos, color: brushColor });
      return;
    }
    setIsDrawing(true);
    lastPosRef.current = pos;
    
    // Draw a single dot on click
    const color = tool === 'eraser' ? '#FFFFFF' : brushColor;
    const style = tool === 'eraser' ? 'round' : brushStyle;
    drawLineLocal(pos, pos, color, brushSize, style);
    socketRef.current?.emit('draw-line', { start: pos, end: pos, color, size: brushSize, style });
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || gameState.currentDrawer !== socketRef.current?.id || tool === 'fill') return;
    const pos = getPos(e);
    const color = tool === 'eraser' ? '#FFFFFF' : brushColor;
    const style = tool === 'eraser' ? 'round' : brushStyle;
    drawLineLocal(lastPosRef.current, pos, color, brushSize, style);
    socketRef.current?.emit('draw-line', { start: lastPosRef.current, end: pos, color, size: brushSize, style });
    lastPosRef.current = pos;
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    // Map client coordinates to canvas CSS coordinates
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const handleStartGame = () => {
    socketRef.current?.emit('start-game', gameSettings);
    setShowSettings(false);
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-3xl shadow-sm border border-black/5 w-full max-w-md"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mb-4">
              <Pencil className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Skribbl Clone</h1>
            <p className="text-gray-500 text-sm mt-1">Draw and guess with friends</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 ml-1">
                Choose Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. Picasso"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 ml-1">
                Draw Your Avatar
              </label>
              <div className="relative bg-gray-50 rounded-xl overflow-hidden cursor-crosshair border border-gray-200">
                <canvas
                  ref={avatarCanvasRef}
                  width={150}
                  height={150}
                  onMouseDown={startAvatarDrawing}
                  onMouseMove={(e) => e.buttons === 1 && handleAvatarDraw(e)}
                  onMouseUp={stopAvatarDrawing}
                  onMouseLeave={stopAvatarDrawing}
                  onTouchStart={startAvatarDrawing}
                  onTouchMove={handleAvatarDraw}
                  onTouchEnd={stopAvatarDrawing}
                  className="w-full h-40"
                />
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                  <div className="bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg border border-black/5 pointer-events-auto flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Size</span>
                    <input 
                      type="range" 
                      min="1" 
                      max="20" 
                      value={avatarBrushSize} 
                      onChange={(e) => setAvatarBrushSize(parseInt(e.target.value))}
                      className="w-16 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const canvas = avatarCanvasRef.current;
                      if (!canvas) return;
                      const ctx = canvas.getContext('2d');
                      if (!ctx) return;
                      ctx.save();
                      ctx.setTransform(1, 0, 0, 1, 0, 0);
                      ctx.clearRect(0, 0, canvas.width, canvas.height);
                      ctx.restore();
                      setAvatar(null);
                    }}
                    className="p-2 bg-white/80 hover:bg-white rounded-lg text-gray-500 shadow-sm transition-colors pointer-events-auto"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 ml-1">
                Choose Color
              </label>
              <div className="grid grid-cols-6 gap-2">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setUserColor(c)}
                    className={`w-full aspect-square rounded-lg border-2 transition-all ${userColor === c ? 'border-black scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-black text-white font-medium py-3 rounded-xl hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
            >
              Enter Lobby
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  const isDrawer = gameState.currentDrawer === socketRef.current?.id;

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-black/5 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
            <Pencil className="text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-gray-900">Skribbl Clone</h1>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
              <span className="text-xs text-gray-500 font-medium">{onlineUsers.length} online</span>
            </div>
          </div>
        </div>

        {gameState.gameActive && (
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Round</span>
              <span className="text-lg font-bold text-gray-900">{gameState.round}/{gameState.maxRounds}</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Time</span>
              <div className="flex items-center gap-1 text-lg font-bold text-gray-900">
                <Clock className="w-4 h-4" />
                {gameState.timeLeft}s
              </div>
            </div>
            <div className="flex flex-col items-center min-w-[120px]">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{isDrawer ? 'Word' : 'Hint'}</span>
              <span className="text-lg font-bold text-black tracking-[0.2em]">
                {isDrawer ? gameState.word : gameState.hint || '_ '.repeat(gameState.word?.length || 5)}
              </span>
              <span className="text-[10px] text-gray-400 font-medium">({gameState.category})</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4">
          {!gameState.gameActive && onlineUsers.length >= 2 && (
            <button 
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-800 transition-all"
            >
              <Play className="w-4 h-4" /> Start Game
            </button>
          )}
          <div className="hidden sm:flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-lg border border-black/5">
            {avatar ? (
              <img src={avatar} alt="avatar" className="w-6 h-6 rounded-md bg-white border border-black/10" />
            ) : (
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: userColor }}></div>
            )}
            <span className="text-sm font-medium text-gray-700">{username}</span>
          </div>
          <button onClick={() => window.location.reload()} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden max-w-[1600px] mx-auto w-full p-4 gap-4">
        {/* Left Sidebar - Scoreboard */}
        <aside className="w-64 flex flex-col gap-4">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-black/5 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 text-gray-400 mb-4 px-1">
              <Trophy className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Scoreboard</span>
            </div>
            <div className="space-y-3">
              {onlineUsers.sort((a, b) => b.score - a.score).map((user) => (
                <div key={user.id} className={`flex items-center justify-between p-2 rounded-xl transition-all ${gameState.currentDrawer === user.id ? 'bg-black/5 ring-1 ring-black/10' : ''}`}>
                  <div className="flex items-center gap-3">
                    {user.avatar ? (
                      <img src={user.avatar} alt="avatar" className="w-8 h-8 rounded-lg bg-white border border-black/10" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: user.color }}>
                        {user.username[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-gray-800 leading-tight">{user.username}</span>
                      <span className="text-[10px] font-medium text-gray-400">{user.score} pts</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.id !== socketRef.current?.id && (
                      <button
                        onClick={() => socketRef.current?.emit('vote-kick', user.id)}
                        className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                        title={`Vote to kick (${user.votesCount || 0}/${Math.ceil(onlineUsers.length / 2)})`}
                      >
                        <UserMinus size={14} />
                      </button>
                    )}
                    {gameState.currentDrawer === user.id && <Pencil className="w-3 h-3 text-black" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Center - Canvas Area */}
        <div className="flex-1 flex flex-col gap-4 relative">
          <div className="bg-white rounded-3xl shadow-sm border border-black/5 flex-1 relative overflow-hidden group">
            {!gameState.gameActive ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50/50 backdrop-blur-[2px] z-20">
                <div className="w-20 h-20 bg-white rounded-3xl shadow-sm border border-black/5 flex items-center justify-center mb-4">
                  <Pencil className="w-10 h-10 text-gray-300" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Waiting for players...</h2>
                <p className="text-gray-500 text-sm mt-1">At least 2 players needed to start</p>
              </div>
            ) : !isDrawer && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-black/80 backdrop-blur-md text-white px-6 py-2 rounded-full text-sm font-bold shadow-xl">
                {gameState.drawerName} is drawing...
              </div>
            )}
            
            {/* Feedback Buttons */}
            {gameState.gameActive && !isDrawer && (
              <div className="absolute bottom-6 left-6 flex gap-2 z-30">
                <button
                  onClick={() => socketRef.current?.emit('feedback', 'like')}
                  className="flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-md hover:bg-emerald-50 text-emerald-600 rounded-full shadow-lg border border-black/5 transition-all active:scale-95 font-bold text-sm"
                >
                  <ThumbsUp size={16} />
                  <span>{feedback.likes}</span>
                </button>
                <button
                  onClick={() => socketRef.current?.emit('feedback', 'dislike')}
                  className="flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-md hover:bg-red-50 text-red-600 rounded-full shadow-lg border border-black/5 transition-all active:scale-95 font-bold text-sm"
                >
                  <ThumbsDown size={16} />
                  <span>{feedback.dislikes}</span>
                </button>
              </div>
            )}
            
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className={`w-full h-full object-contain bg-white ${isDrawer ? 'cursor-crosshair' : 'cursor-default'}`}
            />

            {isDrawer && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-white/90 backdrop-blur-md p-3 rounded-2xl shadow-2xl border border-black/5 z-30">
                <div className="flex gap-2 border-r border-black/5 pr-4">
                  <button
                    onClick={() => setTool('pencil')}
                    className={`p-2 rounded-lg transition-all ${tool === 'pencil' ? 'bg-black text-white' : 'text-gray-400 hover:bg-gray-100'}`}
                    title="Pencil"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setTool('eraser')}
                    className={`p-2 rounded-lg transition-all ${tool === 'eraser' ? 'bg-black text-white' : 'text-gray-400 hover:bg-gray-100'}`}
                    title="Eraser"
                  >
                    <Eraser className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setTool('fill')}
                    className={`p-2 rounded-lg transition-all ${tool === 'fill' ? 'bg-black text-white' : 'text-gray-400 hover:bg-gray-100'}`}
                    title="Fill"
                  >
                    <Droplets className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex gap-1.5 border-r border-black/5 pr-4">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setBrushColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${brushColor === c ? 'border-black scale-125' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-1 border-r border-black/5 pr-4">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Size</span>
                  <input 
                    type="range" 
                    min="1" 
                    max="50" 
                    value={brushSize} 
                    onChange={(e) => setBrushSize(parseInt(e.target.value))}
                    className="w-24 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
                  />
                </div>
                <div className="flex gap-1 border-r border-black/5 pr-4">
                  <button
                    onClick={() => setBrushStyle('round')}
                    className={`p-1.5 rounded-lg transition-all ${brushStyle === 'round' ? 'bg-black text-white' : 'text-gray-400 hover:bg-gray-100'}`}
                    title="Round Brush"
                  >
                    <Circle size={16} />
                  </button>
                  <button
                    onClick={() => setBrushStyle('square')}
                    className={`p-1.5 rounded-lg transition-all ${brushStyle === 'square' ? 'bg-black text-white' : 'text-gray-400 hover:bg-gray-100'}`}
                    title="Square Brush"
                  >
                    <Square size={16} />
                  </button>
                  <button
                    onClick={() => setBrushStyle('glow')}
                    className={`p-1.5 rounded-lg transition-all ${brushStyle === 'glow' ? 'bg-black text-white' : 'text-gray-400 hover:bg-gray-100'}`}
                    title="Glow Brush"
                  >
                    <Sparkles size={16} />
                  </button>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => socketRef.current?.emit('clear-canvas')} 
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 transition-colors font-bold text-sm" 
                    title="Clear Canvas"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Erase All</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar - Chat & Guesses */}
        <aside className="w-80 flex flex-col bg-white rounded-2xl shadow-sm border border-black/5 overflow-hidden">
          <div className="p-4 border-b border-black/5 flex items-center justify-between bg-gray-50/50">
            <div className="flex items-center gap-2 text-gray-500">
              <MessageSquare className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Chat & Guesses</span>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex flex-col ${msg.isSystem ? 'items-center' : 'items-start'}`}
                >
                  {msg.isSystem ? (
                    <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                      {msg.text}
                    </span>
                  ) : (
                    <div className="flex flex-col max-w-full">
                      <span className="text-[10px] font-bold text-gray-400 mb-0.5 px-1 uppercase tracking-tight">
                        {msg.user}
                      </span>
                      <div className="px-3 py-2 rounded-xl bg-gray-100 text-gray-800 text-xs leading-relaxed break-words">
                        {msg.text}
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 border-t border-black/5">
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={isDrawer ? "You are drawing..." : "Type your guess..."}
                disabled={isDrawer}
                className="flex-1 px-4 py-2.5 rounded-xl bg-gray-100 border-transparent focus:bg-white focus:border-black focus:ring-0 transition-all text-xs disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!message.trim() || isDrawer}
                className="bg-black text-white p-2.5 rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </aside>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-3xl p-8 shadow-2xl border border-black/5 w-full max-w-md"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center">
                  <Settings className="text-white w-6 h-6" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Game Settings</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Number of Rounds</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[3, 5, 8, 10].map(r => (
                      <button
                        key={r}
                        onClick={() => setGameSettings(prev => ({ ...prev, rounds: r }))}
                        className={`py-2 rounded-xl text-sm font-bold transition-all ${gameSettings.rounds === r ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Time per Round (sec)</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[30, 60, 90, 120].map(t => (
                      <button
                        key={t}
                        onClick={() => setGameSettings(prev => ({ ...prev, time: t }))}
                        className={`py-2 rounded-xl text-sm font-bold transition-all ${gameSettings.time === t ? 'bg-black text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="flex-1 bg-gray-100 text-gray-900 font-bold py-3 rounded-2xl hover:bg-gray-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleStartGame}
                    className="flex-1 bg-black text-white font-bold py-3 rounded-2xl hover:bg-gray-800 transition-all shadow-lg shadow-black/10"
                  >
                    Start Game
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
