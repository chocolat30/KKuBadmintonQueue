import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft, History, Plus, Play, RotateCcw, Trash2, ClockIcon,
  GripVertical, Pencil, X, QrCode, Check, AlertTriangle,
} from 'lucide-react';
import { useApp, type Pair } from '../context/AppContext';
import { translations } from '../i18n/translations';

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatEstWait(positionIndex: number, avgMs = 15 * 60 * 1000) {
  const ms = positionIndex * avgMs;
  const m = Math.round(ms / 60000);
  return m;
}

export function QueuePage() {
  const { id: courtId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state, lang, setLang, getCourtData, addPair, removePair, reorderQueue, renamePair, startMatch, resetMatch, adjustWins, finishMatch, clearQueue, clearHistory, undo } = useApp();
  const t = translations[lang];

  const court = state.courts.find(c => c.id === courtId);
  const cd = courtId ? getCourtData(courtId) : null;

  const [pairName, setPairName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [timer, setTimer] = useState(0);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Touch drag
  const touchDragIndex = useRef<number | null>(null);
  const touchStartY = useRef(0);

  useEffect(() => {
    if (!cd?.activeMatch) { setTimer(0); return; }
    const update = () => setTimer(Date.now() - cd.activeMatch!.startedAt);
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [cd?.activeMatch?.startedAt, cd?.activeMatch]);

  const handleAddPair = () => {
    if (!courtId) return;
    const name = pairName.trim();
    if (!name) return;
    addPair(courtId, name);
    setPairName('');
  };

  const handleStartMatch = () => {
    if (!courtId) return;
    const err = startMatch(courtId);
    if (err) setError(t.needTwoPairs);
    else setError(null);
  };

  const handleConfirmAction = (action: string) => {
    if (confirmAction === action) {
      if (action === 'clearQueue' && courtId) clearQueue(courtId);
      if (action === 'clearHistory' && courtId) clearHistory(courtId);
      if (action === 'resetMatch' && courtId) resetMatch(courtId);
      setConfirmAction(null);
    } else {
      setConfirmAction(action);
    }
  };

  const getPlayedRounds = useCallback((pairName: string) => {
    if (!cd) return 0;
    return cd.history.filter(r => r.teamA === pairName || r.teamB === pairName).length;
  }, [cd]);

  // HTML5 drag handlers
  const onDragStart = (index: number) => setDragIndex(index);
  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };
  const onDrop = (index: number) => {
    if (!courtId || dragIndex === null || dragIndex === index) { reset(); return; }
    const q = [...(cd?.queue ?? [])];
    const [moved] = q.splice(dragIndex, 1);
    q.splice(index, 0, moved);
    reorderQueue(courtId, q);
    reset();
  };
  const reset = () => { setDragIndex(null); setDragOverIndex(null); };

  // Touch drag handlers
  const onTouchStart = (e: React.TouchEvent, index: number) => {
    touchDragIndex.current = index;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent, index: number) => {
    if (!courtId || touchDragIndex.current === null) return;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dy) < 20) { touchDragIndex.current = null; return; }
    const q = [...(cd?.queue ?? [])];
    const from = touchDragIndex.current;
    const to = dy > 0 ? Math.min(from + 1, q.length - 1) : Math.max(from - 1, 0);
    if (from !== to) {
      const [moved] = q.splice(from, 1);
      q.splice(to, 0, moved);
      reorderQueue(courtId, q);
    }
    touchDragIndex.current = null;
  };

  const courtUrl = `${window.location.origin}/court/${courtId}`;

  if (!court || !cd) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">{lang === 'th' ? 'ไม่พบคอร์ด' : 'Court not found'}</p>
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-green-600 text-white rounded-lg">
            {t.back}
          </button>
        </div>
      </div>
    );
  }

  const canUndo = !!state.undoStack[courtId!];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h2 className="text-gray-900 truncate">{court.name}</h2>
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium shrink-0">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {t.live}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowQR(true)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600">
              <QrCode className="w-5 h-5" />
            </button>
            <button onClick={() => navigate(`/court/${courtId}/history`)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600">
              <History className="w-5 h-5" />
            </button>
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              <button onClick={() => setLang('th')} className={`px-2 py-1 text-xs font-medium ${lang === 'th' ? 'bg-green-600 text-white' : 'bg-white text-gray-600'}`}>TH</button>
              <button onClick={() => setLang('en')} className={`px-2 py-1 text-xs font-medium ${lang === 'en' ? 'bg-green-600 text-white' : 'bg-white text-gray-600'}`}>EN</button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Add Pair Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={pairName}
              onChange={e => setPairName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddPair()}
              placeholder={t.pairNamePlaceholder}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
            />
            <button
              onClick={handleAddPair}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
            >
              <Plus className="w-4 h-4" />
              {t.addPair}
            </button>
          </div>
          {error && (
            <div className="mt-2 flex items-center gap-1.5 text-amber-600 text-sm">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <button
            onClick={handleStartMatch}
            disabled={!!cd.activeMatch}
            className="col-span-1 sm:col-span-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium text-sm"
          >
            <Play className="w-4 h-4" />
            {t.startMatch}
          </button>
          <button
            onClick={() => handleConfirmAction('resetMatch')}
            disabled={!cd.activeMatch}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl transition-colors font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed ${
              confirmAction === 'resetMatch' ? 'bg-yellow-600 text-white' : 'bg-yellow-400 hover:bg-yellow-500 text-yellow-900'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            {confirmAction === 'resetMatch' ? t.confirmDelete : t.resetMatch}
          </button>
          <button
            onClick={() => handleConfirmAction('clearQueue')}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl transition-colors font-medium text-sm ${
              confirmAction === 'clearQueue' ? 'bg-red-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            {confirmAction === 'clearQueue' ? t.confirmClearQueue : t.clearQueue}
          </button>
          <button
            onClick={() => handleConfirmAction('clearHistory')}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl transition-colors font-medium text-sm ${
              confirmAction === 'clearHistory'
                ? 'border-2 border-red-700 text-red-700 bg-red-50'
                : 'border-2 border-red-400 text-red-600 bg-white hover:bg-red-50'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            {t.clearHistory}
          </button>
          <button
            onClick={() => courtId && undo(courtId)}
            disabled={!canUndo}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 border-2 border-gray-400 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors font-medium text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            {t.undo}
          </button>
        </div>

        {/* Active Match */}
        {cd.activeMatch && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between border-b border-gray-100">
              <span className="text-sm font-medium text-gray-700">{t.matchInProgress} — {t.match}{cd.activeMatch.matchNumber}</span>
              <span className="flex items-center gap-1.5 text-sm text-gray-500 font-mono">
                <ClockIcon className="w-4 h-4" />
                {formatDuration(timer)}
              </span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Team A */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-green-700 uppercase tracking-wide">{t.teamA}</div>
                  <div className="font-semibold text-gray-900 truncate">{cd.activeMatch.teamA.name}</div>
                  <div className="text-xs text-gray-500">
                    {t.playedRounds}: {getPlayedRounds(cd.activeMatch.teamA.name)}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => courtId && adjustWins(courtId, 'A', -1)}
                        className="w-8 h-8 rounded-lg border border-green-300 text-green-700 hover:bg-green-100 flex items-center justify-center font-bold"
                      >-1</button>
                      <span className="w-10 text-center font-bold text-lg text-green-700">{cd.activeMatch.teamAWins}</span>
                      <button
                        onClick={() => courtId && adjustWins(courtId, 'A', 1)}
                        className="w-8 h-8 rounded-lg border border-green-300 text-green-700 hover:bg-green-100 flex items-center justify-center font-bold"
                      >+1</button>
                    </div>
                  </div>
                  <button
                    onClick={() => courtId && finishMatch(courtId, 'A')}
                    className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {t.teamAWins}
                  </button>
                </div>

                {/* VS divider */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden" />

                {/* Team B */}
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-red-700 uppercase tracking-wide">{t.teamB}</div>
                  <div className="font-semibold text-gray-900 truncate">{cd.activeMatch.teamB.name}</div>
                  <div className="text-xs text-gray-500">
                    {t.playedRounds}: {getPlayedRounds(cd.activeMatch.teamB.name)}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => courtId && adjustWins(courtId, 'B', -1)}
                        className="w-8 h-8 rounded-lg border border-red-300 text-red-700 hover:bg-red-100 flex items-center justify-center font-bold"
                      >-1</button>
                      <span className="w-10 text-center font-bold text-lg text-red-700">{cd.activeMatch.teamBWins}</span>
                      <button
                        onClick={() => courtId && adjustWins(courtId, 'B', 1)}
                        className="w-8 h-8 rounded-lg border border-red-300 text-red-700 hover:bg-red-100 flex items-center justify-center font-bold"
                      >+1</button>
                    </div>
                  </div>
                  <button
                    onClick={() => courtId && finishMatch(courtId, 'B')}
                    className="w-full py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {t.teamBWins}
                  </button>
                </div>
              </div>

              {/* VS badge in middle */}
              <div className="flex justify-center mt-2">
                <span className="px-3 py-1 bg-gray-100 rounded-full text-xs font-bold text-gray-500 uppercase">{t.vs}</span>
              </div>
            </div>
          </div>
        )}

        {/* Queue */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-gray-700">{lang === 'th' ? 'คิว' : 'Queue'}</h3>
            <span className="text-sm text-gray-400">{cd.queue.length} {lang === 'th' ? 'คู่' : 'pairs'}</span>
          </div>
          {cd.queue.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">{t.noQueue}</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {cd.queue.map((pair, index) => (
                <li
                  key={pair.id}
                  draggable
                  onDragStart={() => onDragStart(index)}
                  onDragOver={e => onDragOver(e, index)}
                  onDrop={() => onDrop(index)}
                  onDragEnd={reset}
                  onTouchStart={e => onTouchStart(e, index)}
                  onTouchEnd={e => onTouchEnd(e, index)}
                  className={`flex items-center gap-2 px-4 py-3 transition-colors ${
                    dragOverIndex === index && dragIndex !== index ? 'bg-green-50 border-t-2 border-green-400' : 'hover:bg-gray-50'
                  } ${dragIndex === index ? 'opacity-50' : ''}`}
                >
                  <span className="text-gray-300 cursor-grab active:cursor-grabbing touch-none">
                    <GripVertical className="w-4 h-4" />
                  </span>
                  <span className="w-6 text-center text-sm font-bold text-gray-400">{index + 1}</span>

                  {editingId === pair.id ? (
                    <div className="flex-1 flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && courtId) { renamePair(courtId, pair.id, editingName.trim() || pair.name); setEditingId(null); }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="flex-1 px-2 py-1 text-sm rounded border border-gray-300 focus:outline-none focus:ring-1 focus:ring-green-500"
                      />
                      <button onClick={() => { if (courtId) renamePair(courtId, pair.id, editingName.trim() || pair.name); setEditingId(null); }} className="p-1 text-green-600 hover:text-green-700">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="flex-1 text-gray-800 text-sm truncate">{pair.name}</span>
                  )}

                  <span className="shrink-0 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs">
                    ~{formatEstWait(index + (cd.activeMatch ? 1 : 0))}{t.mins}
                  </span>

                  {editingId !== pair.id && (
                    <>
                      <button
                        onClick={() => { setEditingId(pair.id); setEditingName(pair.name); }}
                        className="p-1.5 text-gray-400 hover:text-blue-500 rounded hover:bg-blue-50"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => courtId && removePair(courtId, pair.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-50"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* QR Modal */}
      {showQR && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowQR(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-900">{t.qrCode}</h3>
              <button onClick={() => setShowQR(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-3">
              {/* Simple QR placeholder using CSS grid pattern */}
              <div className="w-40 h-40 bg-white border-2 border-gray-800 rounded-lg flex items-center justify-center relative overflow-hidden">
                <div className="grid grid-cols-8 gap-0.5 p-2">
                  {Array.from({ length: 64 }, (_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-sm ${
                        [0,1,2,3,4,5,6,8,14,16,22,24,28,30,32,36,38,40,46,48,54,56,57,58,59,60,61,62,63,9,17,25,33,41,49,7,15,23,31,39,47,55,10,18,26,34,42,50,11,19,27,35,43,51].includes(i)
                          ? 'bg-gray-900' : 'bg-white'
                      }`}
                    />
                  ))}
                </div>
                <QrCode className="absolute w-12 h-12 text-gray-900" />
              </div>
              <p className="text-xs text-gray-500 text-center break-all">{courtUrl}</p>
              <button
                onClick={() => { navigator.clipboard?.writeText(courtUrl); }}
                className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {lang === 'th' ? 'คัดลอกลิงก์' : 'Copy Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
