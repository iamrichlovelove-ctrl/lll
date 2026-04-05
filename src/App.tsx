import React, { useEffect, useRef, useState } from 'react';
import { Engine } from './game/Engine';
import { HandTracker, GestureType } from './game/HandTracker';
import { audioManager } from './game/AudioManager';

type GameState = 'START' | 'INSTRUCTIONS' | 'PLAYING' | 'END';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);

  const [gameState, setGameState] = useState<GameState>('START');
  const [kills, setKills] = useState(0);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
  const [wave, setWave] = useState(1);
  const waveRef = useRef(1);
  const [waveTimeLeft, setWaveTimeLeft] = useState(30);
  const [specialEvent, setSpecialEvent] = useState<string | null>(null);
  const specialEventRef = useRef<string | null>(null);
  const [waveFlash, setWaveFlash] = useState(false);
  const killsInLastWaveRef = useRef(0);
  const baseSpawnRateRef = useRef(1500);
  const [currentGesture, setCurrentGesture] = useState<GestureType>('NONE');
  const [rawGesture, setRawGesture] = useState<GestureType>('NONE');
  const [extendedCount, setExtendedCount] = useState<any>({ thumb: false, index: false, middle: false, ring: false, pinky: false, isPalmInward: false });
  const [handDetected, setHandDetected] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  const [mouseMode, setMouseMode] = useState(false);
  const [confirmFailCount, setConfirmFailCount] = useState(0);
  const [showMousePrompt, setShowMousePrompt] = useState(false);
  const [actionPrompt, setActionPrompt] = useState('');
  const [calibrationPrompt, setCalibrationPrompt] = useState('');
  
  const lastHandDetectedTimeRef = useRef(Date.now());
  const lastValidGestureTimeRef = useRef(Date.now());

  // Confirmation state
  const [thunderHoldTime, setThunderHoldTime] = useState(0);
  const lastThunderRef = useRef(0);
  const wasThunderRef = useRef(false);

  const [hp, setHp] = useState(5);
  const [damageFlash, setDamageFlash] = useState(false);
  const [overpopulationWarning, setOverpopulationWarning] = useState(false);
  const skillPenaltyRef = useRef(0);
  
  const [gameMode, setGameMode] = useState<'EASY' | 'HARD'>('EASY');

  useEffect(() => {
    if (!canvasRef.current || !videoRef.current) return;

    // Init Engine
    engineRef.current = new Engine(canvasRef.current);
    engineRef.current.onKill = (points: number) => {
      setKills(k => k + points);
      killsInLastWaveRef.current += points;
      audioManager.playMonsterDeath();
    };
    engineRef.current.onPlayerHit = (amount: number) => {
      setHp(h => {
        const newHp = Math.max(0, h - amount);
        if (newHp <= 0) {
          handleEndGame();
        }
        return newHp;
      });
    };
    engineRef.current.onDamageFlash = () => {
      setDamageFlash(true);
      setTimeout(() => setDamageFlash(false), 200);
      // audioManager.playPlayerHit(); // Assuming there's a hit sound
    };
    engineRef.current.onOverpopulation = (isOver: boolean) => {
      setOverpopulationWarning(isOver);
    };
    engineRef.current.onSkillPenalty = (extraCd: number) => {
      skillPenaltyRef.current = extraCd;
      setTimeout(() => {
        skillPenaltyRef.current = 0;
      }, 2000); // Penalty lasts for 2 seconds
    };

    // Init Tracker
    trackerRef.current = new HandTracker(videoRef.current);
    trackerRef.current.setOnResults((gesture, results, raw, extCount) => {
      const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
      setHandDetected(hasHand);
      setCurrentGesture(gesture);
      setRawGesture(raw);
      setExtendedCount(extCount);
      
      const now = Date.now();
      if (hasHand) {
        lastHandDetectedTimeRef.current = now;
      }
      if (gesture !== 'NONE') {
        lastValidGestureTimeRef.current = now;
      }

      // Draw debug landmarks
      const canvas = debugCanvasRef.current;
      if (canvas && results.multiHandLandmarks) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          for (const landmarks of results.multiHandLandmarks) {
            ctx.fillStyle = '#0f0';
            for (const lm of landmarks) {
              ctx.beginPath();
              ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
        }
      }
    });

    trackerRef.current.start().catch(err => {
      setErrorMsg(`摄像头启动失败: ${err.message || '请检查权限'}`);
    });

    return () => {
      engineRef.current?.stop();
      trackerRef.current?.stop();
    };
  }, []);

  // Handle game loop and spawning
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    engineRef.current?.start();
    
    // Reset wave state on start
    setWave(1);
    waveRef.current = 1;
    setWaveTimeLeft(30);
    setSpecialEvent(null);
    specialEventRef.current = null;
    engineRef.current?.setSpecialEvent(null);
    killsInLastWaveRef.current = 0;
    baseSpawnRateRef.current = 1500;

    // Initial spawn
    for(let i=0; i<5; i++) engineRef.current?.spawnMonster();

    let isSpawning = true;
    const spawnLoop = () => {
      if (!isSpawning) return;

      const currentWave = waveRef.current;
      const event = specialEventRef.current;

      const rand = Math.random();
      let loc: 'normal' | 'close' | 'back' = 'normal';
      if (rand > 0.9) loc = 'back';
      else if (rand > 0.7) loc = 'close';

      let isElite = false;
      if (currentWave >= 7 && Math.random() < 0.15 + (currentWave - 7) * 0.05) {
        isElite = true;
      }

      engineRef.current?.spawnMonster(isElite, loc);

      let rate = baseSpawnRateRef.current;
      if (event === '生成速度翻倍') rate /= 2;

      setTimeout(spawnLoop, rate + Math.random() * 300);
    };
    spawnLoop();

    const timerInterval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          isSpawning = false;
          clearInterval(timerInterval);
          setGameState('END');
          audioManager.playEnd();
          return 0;
        }
        if (t <= 10) audioManager.playTick();
        return t - 1;
      });

      setWaveTimeLeft(wt => {
        if (wt <= 1) {
          // Next wave
          const nextWave = waveRef.current + 1;
          if (nextWave <= 10) {
            setWave(nextWave);
            waveRef.current = nextWave;
            
            const kills = killsInLastWaveRef.current;
            killsInLastWaveRef.current = 0;
            
            let newRate = 1500 - (nextWave * 100); 
            if (kills > 20) newRate *= 0.85;
            else if (kills < 10) newRate *= 1.15;
            baseSpawnRateRef.current = Math.max(300, newRate);

            if (Math.random() < 0.1) {
              const events = ['怪物减速', '自动杀怪', '技能冷却减半', '怪物半透明', '生成速度翻倍'];
              const ev = events[Math.floor(Math.random() * events.length)];
              setSpecialEvent(ev);
              specialEventRef.current = ev;
              engineRef.current?.setSpecialEvent(ev);
            } else {
              setSpecialEvent(null);
              specialEventRef.current = null;
              engineRef.current?.setSpecialEvent(null);
            }

            setWaveFlash(true);
            setTimeout(() => setWaveFlash(false), 1000);
          }
          return 30;
        }
        return wt - 1;
      });
    }, 1000);

    return () => {
      isSpawning = false;
      clearInterval(timerInterval);
      engineRef.current?.stop();
    };
  }, [gameState]);

  const lastCastTimeRef = useRef(0);

  // Confirmation state machine
  const [confirmState, setConfirmState] = useState(0); // 0: wait THUNDER, 1: wait FIST
  const confirmStateTimeRef = useRef(0);

  // Keyboard simulation
  useEffect(() => {
    if (!mouseMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      let gesture: GestureType = 'NONE';
      switch (e.key) {
        case '1': gesture = 'THUNDER'; break;
        case '2': gesture = 'FIST'; break;
        case '3': gesture = 'THUMB_UP'; break;
        case '4': gesture = 'FIRE'; break;
        case '5': gesture = 'WIND'; break;
        case '6': gesture = 'SHADOW'; break;
        case '7': gesture = 'ALL'; break;
        default: return;
      }
      
      setCurrentGesture(gesture);
      setRawGesture(gesture);
      lastValidGestureTimeRef.current = Date.now();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['1', '2', '3', '4', '5', '6', '7'].includes(e.key)) {
        setCurrentGesture('NONE');
        setRawGesture('NONE');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [mouseMode]);

  // Handle gestures
  useEffect(() => {
    const now = Date.now();
    
    if (gameState === 'START' || gameState === 'INSTRUCTIONS' || gameState === 'END') {
      if (confirmState === 0) {
        if (currentGesture === 'THUNDER') {
          setConfirmState(1);
          confirmStateTimeRef.current = now;
          setActionPrompt('已识别张开，请握拳');
        } else {
          setActionPrompt('');
        }
      } else if (confirmState === 1) {
        if (now - confirmStateTimeRef.current > 1500) {
          // Timeout
          setConfirmState(0);
          setActionPrompt('');
          if (gameState !== 'END') {
            setConfirmFailCount(c => {
              if (c + 1 >= 3) setShowMousePrompt(true);
              return c + 1;
            });
          }
        } else if (currentGesture === 'FIST' || currentGesture === 'THUMB_UP') {
          // Success
          setConfirmState(0);
          setActionPrompt('');
          if (gameState !== 'END') setConfirmFailCount(0);
          
          if (gameState === 'END') {
            handleRestart();
          } else {
            handleConfirm();
          }
        } else if (currentGesture !== 'THUNDER' && currentGesture !== 'NONE') {
          // Other gesture, reset
          setConfirmState(0);
          setActionPrompt('');
        } else if (currentGesture === 'THUNDER' && now - confirmStateTimeRef.current > 500) {
           setActionPrompt('请快速握拳或合上四指');
        }
      }
    } else if (gameState === 'PLAYING') {
      if (['THUNDER', 'FIRE', 'WIND', 'SHADOW', 'ALL'].includes(currentGesture)) {
        let cooldown = specialEventRef.current === '技能冷却减半' ? 250 : 500;
        cooldown += skillPenaltyRef.current;
        if (now - lastCastTimeRef.current > cooldown) {
          lastCastTimeRef.current = now;
          const hits = engineRef.current?.castSpell(currentGesture);
          if (hits !== undefined) {
            audioManager.playSpell();
          }
        }
      }
    }
  }, [currentGesture, gameState, confirmState]);

  // Calibration prompt
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (!handDetected && now - lastHandDetectedTimeRef.current > 3000) {
        setCalibrationPrompt('未检测到手部，请将手背朝向摄像头，保持光线充足');
      } else if (handDetected && currentGesture === 'NONE' && now - lastValidGestureTimeRef.current > 5000) {
        setCalibrationPrompt('请尝试张开五指 → 握拳 来开始游戏');
      } else {
        setCalibrationPrompt('');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [handDetected, currentGesture]);

  const handleConfirm = (mode: 'EASY' | 'HARD' = 'EASY') => {
    audioManager.init();
    audioManager.playClick();
    if (gameState === 'START') setGameState('INSTRUCTIONS');
    else if (gameState === 'INSTRUCTIONS') {
      setGameMode(mode);
      if (engineRef.current) {
        engineRef.current.enableSkills = mode === 'HARD';
      }
      setKills(0);
      setTimeLeft(300);
      setHp(5);
      engineRef.current?.reset();
      setGameState('PLAYING');
    }
  };

  const handleRestart = () => {
    audioManager.playClick();
    setKills(0);
    setTimeLeft(300);
    setHp(5);
    if (engineRef.current) {
      engineRef.current.enableSkills = gameMode === 'HARD';
    }
    engineRef.current?.reset();
    setGameState('PLAYING');
  };

  const handleHome = () => {
    audioManager.playClick();
    engineRef.current?.reset();
    setGameState('START');
  };

  const handleEndGame = () => {
    audioManager.playClick();
    audioManager.playEnd();
    setGameState('END');
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const gestureNames: Record<string, string> = {
    'NONE': '未结印',
    'THUNDER': '雷诀',
    'FIRE': '火诀',
    'WIND': '风诀',
    'SHADOW': '阴诀',
    'FIST': '握拳',
    'ALL': '双手合十'
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black text-white font-sans">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      
      {/* Hidden Video for HandTracker */}
      <video ref={videoRef} className="opacity-0 absolute pointer-events-none w-1 h-1" playsInline muted />
      <canvas ref={debugCanvasRef} width={320} height={240} className="hidden" />

      {/* Mouse Mode Fallback */}
      {mouseMode && gameState === 'PLAYING' && (
        <div className="absolute inset-0 pointer-events-auto z-40">
          <button onClick={() => engineRef.current?.castSpell('THUNDER')} className="absolute top-0 left-0 w-32 h-32 bg-blue-500/10 hover:bg-blue-500/30 flex items-center justify-center text-blue-300 font-bold border border-blue-500/30">雷诀</button>
          <button onClick={() => engineRef.current?.castSpell('FIRE')} className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 hover:bg-red-500/30 flex items-center justify-center text-red-300 font-bold border border-red-500/30">火诀</button>
          <button onClick={() => engineRef.current?.castSpell('WIND')} className="absolute bottom-0 left-0 w-32 h-32 bg-green-500/10 hover:bg-green-500/30 flex items-center justify-center text-green-300 font-bold border border-green-500/30">风诀</button>
          <button onClick={() => engineRef.current?.castSpell('SHADOW')} className="absolute bottom-0 right-0 w-32 h-32 bg-purple-500/10 hover:bg-purple-500/30 flex items-center justify-center text-purple-300 font-bold border border-purple-500/30">阴诀</button>
          <button onClick={() => engineRef.current?.castSpell('ALL')} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-yellow-500/10 hover:bg-yellow-500/30 flex items-center justify-center text-yellow-300 font-bold border border-yellow-500/30 rounded-full">双手合十</button>
        </div>
      )}

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none flex flex-col">
        
        {/* Real-time Gesture Feedback Panel */}
        <div className="absolute bottom-6 right-6 bg-black/50 p-4 rounded-lg border border-white/20 text-sm font-mono flex flex-col gap-1 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${handDetected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-gray-600'}`} />
            <span>{handDetected ? '手部已检测' : '未检测到手部'}</span>
          </div>
          <div className="text-gray-300 mt-2">
            原始: <span className="text-white">{gestureNames[rawGesture] || rawGesture}</span>
          </div>
          <div className="text-gray-300">
            稳定: <span className="text-white">{gestureNames[currentGesture] || currentGesture}</span>
          </div>
          <div className="text-gray-300">
            伸直: <span className="text-white">拇:{extendedCount.thumb?1:0} 食:{extendedCount.index?1:0} 中:{extendedCount.middle?1:0} 无:{extendedCount.ring?1:0} 小:{extendedCount.pinky?1:0}</span>
          </div>
          <div className="text-gray-300">
            掌心向内: <span className="text-white">{extendedCount.isPalmInward ? 'True' : 'False'}</span>
          </div>
        </div>

        {/* Calibration & Action Prompts */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 pointer-events-none z-50">
          {actionPrompt && (
            <div className="bg-blue-600/80 text-white px-6 py-3 rounded-full text-xl font-bold shadow-[0_0_15px_rgba(37,99,235,0.8)] animate-bounce">
              {actionPrompt}
            </div>
          )}
          {calibrationPrompt && (
            <div className="bg-yellow-600/80 text-white px-6 py-3 rounded-full text-lg font-bold shadow-[0_0_15px_rgba(202,138,4,0.8)]">
              {calibrationPrompt}
            </div>
          )}
          {currentGesture === 'ALL' && gameState === 'PLAYING' && (
            <div className="bg-yellow-500/90 text-white px-8 py-4 rounded-full text-3xl font-bold shadow-[0_0_30px_rgba(234,179,8,1)] animate-ping">
              双手合十 · 全屏秒杀
            </div>
          )}
        </div>

        {/* Damage Flash */}
        {damageFlash && (
          <div className="absolute inset-0 bg-red-600/30 pointer-events-none z-40 animate-pulse" />
        )}

        {/* Overpopulation Warning */}
        {overpopulationWarning && (
          <div className="absolute inset-0 pointer-events-none z-40">
            <div className="absolute inset-0 border-8 border-red-600/50 animate-pulse" />
            <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-red-900/80 text-red-100 px-6 py-2 rounded-full text-xl font-bold border border-red-500 shadow-[0_0_20px_rgba(220,38,38,0.8)] animate-bounce">
              ⚠️ 妖气过载！⚠️
            </div>
          </div>
        )}

        {/* Mouse Mode Prompt */}
        {showMousePrompt && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center pointer-events-auto z-50">
            <div className="bg-gray-900 p-8 rounded-xl border border-white/20 max-w-md text-center">
              <h3 className="text-2xl font-bold mb-4 text-yellow-400">手势识别困难？</h3>
              <p className="text-gray-300 mb-8">
                检测到您连续多次确认失败。是否切换到鼠标模式？<br/>
                （点击确定后，您可以使用鼠标点击屏幕四角释放技能）
              </p>
              <div className="flex justify-center gap-4">
                <button 
                  onClick={() => setShowMousePrompt(false)}
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                >
                  继续尝试手势
                </button>
                <button 
                  onClick={() => {
                    setMouseMode(true);
                    setShowMousePrompt(false);
                    handleConfirm();
                  }}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors font-bold"
                >
                  切换鼠标模式
                </button>
              </div>
            </div>
          </div>
        )}

        {/* HUD */}
        {gameState === 'PLAYING' && (
          <>
            <div className="flex justify-between p-6 pointer-events-auto">
              <div className="flex flex-col gap-2 pointer-events-none">
                <div className="text-2xl font-bold text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.8)]">
                  {gestureNames[currentGesture] || '结印中...'} | 击杀: {kills}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-red-400 font-bold">HP:</span>
                  <div className="flex gap-1">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className={`w-6 h-6 rounded-full ${i < Math.ceil(hp) ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-gray-800 border border-gray-600'}`} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-6">
                  <div className="text-3xl font-mono font-bold text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.8)] pointer-events-none">
                    {formatTime(timeLeft)}
                  </div>
                  <button
                    onClick={handleEndGame}
                    className="px-4 py-2 bg-red-600/20 border border-red-500 text-red-400 rounded hover:bg-red-600/40 transition-colors font-bold"
                  >
                    结束游戏
                  </button>
                </div>
                <div className="text-lg font-bold text-blue-400 drop-shadow-[0_0_5px_rgba(96,165,250,0.8)] pointer-events-none">
                  第 {wave}/10 波 | 下一波: {waveTimeLeft}s
                </div>
                {specialEvent && (
                  <div className="text-md font-bold text-purple-400 drop-shadow-[0_0_5px_rgba(192,132,252,0.8)] pointer-events-none animate-pulse">
                    特殊事件: {specialEvent}
                  </div>
                )}
              </div>
            </div>
            <div className="absolute bottom-6 left-6 text-xl text-green-400/70">
              结印中...
            </div>
          </>
        )}

        {/* Wave Flash */}
        {waveFlash && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
            <h1 className="text-8xl font-bold text-white drop-shadow-[0_0_20px_rgba(255,255,255,1)] animate-ping">
              第 {wave} 波
            </h1>
          </div>
        )}

        {/* Start Screen */}
        {gameState === 'START' && (
          <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-b from-[#02111f] to-black pointer-events-auto">
            <h1 className="text-6xl font-bold mb-12 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400 drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">
              结印·阴阳师
            </h1>
            <button 
              onClick={handleConfirm}
              className="px-12 py-4 text-2xl font-bold rounded-full bg-blue-600/20 border-2 border-blue-400 hover:bg-blue-600/40 transition-all shadow-[0_0_20px_rgba(96,165,250,0.5)] relative overflow-hidden"
            >
              开始
              {thunderHoldTime > 0 && (
                <div 
                  className="absolute bottom-0 left-0 h-1 bg-blue-400" 
                  style={{ width: `${Math.min(100, (thunderHoldTime / 3000) * 100)}%` }}
                />
              )}
            </button>
            <p className="mt-6 text-gray-400 text-center">
              操作方式：<br/>
              1. 鼠标点击按钮<br/>
              2. 手掌(雷诀)悬停 3 秒<br/>
              3. 先手掌(雷诀)后握拳
            </p>
          </div>
        )}

        {/* Instructions Screen */}
        {gameState === 'INSTRUCTIONS' && (
          <div className="flex-1 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto p-8">
            <h2 className="text-4xl font-bold mb-8 text-blue-300">玩法说明</h2>
            <div className="grid grid-cols-2 gap-8 mb-12 max-w-4xl">
              <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                <h3 className="text-xl font-bold text-blue-400 mb-2">雷诀·掌心引雷</h3>
                <p className="text-gray-300 mb-2">五指自然张开，掌心朝前</p>
                <p className="text-sm text-gray-400">发射直线贯穿射线</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                <h3 className="text-xl font-bold text-red-400 mb-2">火诀·炎魂弹</h3>
                <p className="text-gray-300 mb-2">拇指与食指捏合(OK印)，其余三指弯曲</p>
                <p className="text-sm text-gray-400">发射追踪火球</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                <h3 className="text-xl font-bold text-green-400 mb-2">风诀·岚旋阵</h3>
                <p className="text-gray-300 mb-2">五指张开，掌心向内(手腕内翻)</p>
                <p className="text-sm text-gray-400">释放球形AOE冲击波</p>
              </div>
              <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                <h3 className="text-xl font-bold text-purple-400 mb-2">阴诀·幽玄破</h3>
                <p className="text-gray-300 mb-2">剑指：食指中指并拢伸直，其余弯曲</p>
                <p className="text-sm text-gray-400">发射无限长直线射线</p>
              </div>
            </div>
            <div className="flex gap-8">
              <button 
                onClick={() => handleConfirm('EASY')}
                className="px-8 py-4 rounded-2xl bg-green-600/20 border-2 border-green-400 hover:bg-green-600/40 transition-all relative overflow-hidden flex flex-col items-center justify-center text-center w-64"
              >
                <h3 className="text-2xl font-bold text-green-400 mb-2">气场模式 (简易)</h3>
                <p className="text-gray-300 text-sm">展开气场，无视妖怪除了<br/>靠近以外的其他攻击</p>
                {thunderHoldTime > 0 && (
                  <div 
                    className="absolute bottom-0 left-0 h-1 bg-green-400" 
                    style={{ width: `${Math.min(100, (thunderHoldTime / 3000) * 100)}%` }}
                  />
                )}
              </button>
              <button 
                onClick={() => handleConfirm('HARD')}
                className="px-8 py-4 rounded-2xl bg-red-600/20 border-2 border-red-400 hover:bg-red-600/40 transition-all relative overflow-hidden flex flex-col items-center justify-center text-center w-64"
              >
                <h3 className="text-2xl font-bold text-red-400 mb-2">独身模式 (困难)</h3>
                <p className="text-gray-300 text-sm">独自面对群妖，怪物将<br/>使用各种致命技能</p>
              </button>
            </div>
          </div>
        )}

        {/* End Screen */}
        {gameState === 'END' && (
          <div className="flex-1 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md pointer-events-auto">
            <h2 className="text-6xl font-bold mb-4 text-red-500 tracking-widest">时间到</h2>
            <div className="text-4xl font-bold mb-4 text-white">总击杀: {kills}</div>
            <div className="text-2xl mb-12 text-yellow-400">
              {kills < 80 ? '见习阴阳师' : kills <= 160 ? '驱魔使者' : '结印宗师'}
            </div>
            <div className="flex gap-6">
              <button 
                onClick={handleRestart}
                className="px-8 py-3 text-xl font-bold rounded-full bg-green-600/20 border-2 border-green-400 hover:bg-green-600/40 transition-all"
              >
                再次开始
              </button>
              <button 
                onClick={handleHome}
                className="px-8 py-3 text-xl font-bold rounded-full bg-gray-600/20 border-2 border-gray-400 hover:bg-gray-600/40 transition-all"
              >
                返回首页
              </button>
            </div>
            <p className="mt-6 text-gray-400 text-center">
              也可以张开手掌后握拳来再次开始
            </p>
          </div>
        )}

        {/* Error Modal */}
        {errorMsg && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50 pointer-events-auto">
            <div className="bg-gray-900 p-8 rounded-xl border border-red-500/50 max-w-md text-center">
              <p className="text-red-400 text-xl mb-6">{errorMsg}</p>
              <button 
                onClick={() => {
                  setErrorMsg('');
                  setMouseMode(true);
                  setHandDetected(true);
                }}
                className="px-6 py-2 bg-red-500/20 border border-red-500 rounded hover:bg-red-500/40"
              >
                使用键盘模拟 (1-7数字键)
              </button>
            </div>
          </div>
        )}

        {/* Status Indicator */}
        <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
          {mouseMode && (
            <div className="bg-black/50 px-4 py-2 rounded-lg border border-white/10 text-sm text-gray-300 text-right">
              键盘模拟模式:<br/>
              1: 雷诀 (张开)<br/>
              2: 握拳<br/>
              3: 点赞 (合上四指)<br/>
              4: 火诀<br/>
              5: 风诀<br/>
              6: 阴诀<br/>
              7: 双手
            </div>
          )}
          <div className="flex items-center gap-3 bg-black/50 px-4 py-2 rounded-full border border-white/10">
            <span className="text-sm text-gray-300">手势检测</span>
            <div className={`w-3 h-3 rounded-full ${handDetected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-gray-600'}`} />
          </div>
        </div>

      </div>
    </div>
  );
}
