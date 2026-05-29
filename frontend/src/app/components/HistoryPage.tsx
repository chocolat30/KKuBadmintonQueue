import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Trash2, Trophy, Clock, Calendar } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { translations } from '../i18n/translations';

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatThaiDate(ts: number, lang: 'th' | 'en') {
  const d = new Date(ts);
  if (lang === 'th') {
    return d.toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function HistoryPage() {
  const { id: courtId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { state, lang, setLang, getCourtData, clearHistory } = useApp();
  const t = translations[lang];

  const court = courtId ? state.courts.find(c => c.id === courtId) : null;

  // Gather history: if courtId specified, only that court; else all courts
  const allHistory = courtId
    ? getCourtData(courtId).history.map(r => ({ ...r, courtName: court?.name ?? '' }))
    : state.courts.flatMap(c => {
        const cd = getCourtData(c.id);
        return cd.history.map(r => ({ ...r, courtName: c.name }));
      }).sort((a, b) => b.startedAt - a.startedAt);

  const handleClearHistory = () => {
    if (courtId) {
      clearHistory(courtId);
    } else {
      state.courts.forEach(c => clearHistory(c.id));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button onClick={() => navigate(courtId ? `/court/${courtId}` : '/')} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-gray-900 truncate">
              {t.matchHistory}{court ? ` — ${court.name}` : ''}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {allHistory.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t.clearHistory}
              </button>
            )}
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              <button onClick={() => setLang('th')} className={`px-2 py-1 text-xs font-medium ${lang === 'th' ? 'bg-green-600 text-white' : 'bg-white text-gray-600'}`}>TH</button>
              <button onClick={() => setLang('en')} className={`px-2 py-1 text-xs font-medium ${lang === 'en' ? 'bg-green-600 text-white' : 'bg-white text-gray-600'}`}>EN</button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-4">
        {allHistory.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{t.noHistory}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {allHistory.map(record => {
              const duration = record.endedAt - record.startedAt;
              return (
                <div key={record.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full text-xs font-bold">
                        {t.match}{record.matchNumber}
                      </span>
                      {!courtId && (
                        <span className="text-xs text-gray-500">{record.courtName}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDuration(duration)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatThaiDate(record.startedAt, lang)}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      {/* Team A */}
                      <div className={`flex-1 rounded-xl p-3 ${record.winner === 'A' ? 'bg-green-50 border-2 border-green-400' : 'bg-gray-50 border border-gray-200'}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`text-xs font-bold uppercase tracking-wide ${record.winner === 'A' ? 'text-green-700' : 'text-gray-500'}`}>
                            {t.teamA}
                          </span>
                          {record.winner === 'A' && (
                            <Trophy className="w-3.5 h-3.5 text-yellow-500" />
                          )}
                        </div>
                        <div className="font-semibold text-gray-800 text-sm truncate">{record.teamA}</div>
                        <div className={`text-lg font-bold mt-1 ${record.winner === 'A' ? 'text-green-600' : 'text-gray-400'}`}>
                          {record.teamAWins}
                        </div>
                      </div>

                      {/* VS */}
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-bold text-gray-400">{t.vs}</span>
                      </div>

                      {/* Team B */}
                      <div className={`flex-1 rounded-xl p-3 ${record.winner === 'B' ? 'bg-red-50 border-2 border-red-400' : 'bg-gray-50 border border-gray-200'}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`text-xs font-bold uppercase tracking-wide ${record.winner === 'B' ? 'text-red-700' : 'text-gray-500'}`}>
                            {t.teamB}
                          </span>
                          {record.winner === 'B' && (
                            <Trophy className="w-3.5 h-3.5 text-yellow-500" />
                          )}
                        </div>
                        <div className="font-semibold text-gray-800 text-sm truncate">{record.teamB}</div>
                        <div className={`text-lg font-bold mt-1 ${record.winner === 'B' ? 'text-red-600' : 'text-gray-400'}`}>
                          {record.teamBWins}
                        </div>
                      </div>
                    </div>

                    {/* Winner badge */}
                    <div className="mt-3 flex justify-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        record.winner === 'A' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {t.winner}: {record.winner === 'A' ? record.teamA : record.teamB}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
