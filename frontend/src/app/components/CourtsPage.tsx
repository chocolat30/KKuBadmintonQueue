import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, History, Trash2, ExternalLink, Trophy } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { translations } from '../i18n/translations';

export function CourtsPage() {
  const { state, lang, setLang, addCourt, deleteCourt } = useApp();
  const t = translations[lang];
  const navigate = useNavigate();
  const [courtName, setCourtName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleAdd = () => {
    const name = courtName.trim();
    if (!name) return;
    addCourt(name);
    setCourtName('');
  };

  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) {
      deleteCourt(id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-6 h-6 text-green-600" />
            <h1 className="text-gray-900">{t.courts}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/history')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm transition-colors"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">{t.viewAllHistory}</span>
            </button>
            <div className="flex rounded-lg overflow-hidden border border-gray-200">
              <button
                onClick={() => setLang('th')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${lang === 'th' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >TH</button>
              <button
                onClick={() => setLang('en')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${lang === 'en' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >EN</button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Add Court Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={courtName}
              onChange={e => setCourtName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder={t.courtNamePlaceholder}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
            />
            <button
              onClick={handleAdd}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
            >
              <Plus className="w-4 h-4" />
              {t.addCourt}
            </button>
          </div>
        </div>

        {/* Courts Grid */}
        {state.courts.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{t.noCourts}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {state.courts.map(court => {
              const cd = state.courtData[court.id];
              const hasActive = cd?.activeMatch != null;
              return (
                <div key={court.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <h3 className="text-gray-900 truncate">{court.name}</h3>
                      {hasActive && (
                        <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          {lang === 'th' ? 'กำลังเล่น' : 'Playing'}
                        </span>
                      )}
                    </div>
                    {cd && (
                      <p className="text-sm text-gray-400 mt-0.5">
                        {lang === 'th' ? `คิว: ${cd.queue.length} คู่` : `Queue: ${cd.queue.length} pairs`}
                      </p>
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-2">
                    <button
                      onClick={() => navigate(`/court/${court.id}`)}
                      className="flex items-center justify-center gap-1.5 w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                    >
                      <ExternalLink className="w-4 h-4" />
                      {t.open}
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/court/${court.id}/history`)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg transition-colors text-sm"
                      >
                        <History className="w-3.5 h-3.5" />
                        {t.viewHistory}
                      </button>
                      <button
                        onClick={() => handleDelete(court.id)}
                        className={`flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg transition-colors text-sm ${
                          confirmDeleteId === court.id
                            ? 'bg-red-600 text-white'
                            : 'border border-red-200 text-red-600 hover:bg-red-50'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {confirmDeleteId === court.id ? t.confirmDelete : t.deleteCourt}
                      </button>
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
