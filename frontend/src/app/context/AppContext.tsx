import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { type Lang } from '../i18n/translations';

export type { Lang };

export interface Court {
  id: string;
  name: string;
}

export interface Pair {
  id: string;
  name: string;
  addedAt: number;
}

export interface ActiveMatch {
  teamA: Pair;
  teamB: Pair;
  teamAWins: number;
  teamBWins: number;
  startedAt: number;
  matchNumber: number;
}

export interface MatchRecord {
  id: string;
  courtId: string;
  teamA: string;
  teamB: string;
  teamAWins: number;
  teamBWins: number;
  winner: 'A' | 'B';
  startedAt: number;
  endedAt: number;
  matchNumber: number;
}

interface CourtData {
  queue: Pair[];
  activeMatch: ActiveMatch | null;
  history: MatchRecord[];
}

interface Snapshot {
  queue: Pair[];
  activeMatch: ActiveMatch | null;
  history: MatchRecord[];
}

interface AppState {
  courts: Court[];
  courtData: Record<string, CourtData>;
  undoStack: Record<string, Snapshot | null>;
}

interface AppContextType {
  state: AppState;
  lang: Lang;
  setLang: (lang: Lang) => void;
  addCourt: (name: string) => void;
  deleteCourt: (id: string) => void;
  getCourtData: (courtId: string) => CourtData;
  addPair: (courtId: string, name: string) => void;
  removePair: (courtId: string, pairId: string) => void;
  reorderQueue: (courtId: string, queue: Pair[]) => void;
  renamePair: (courtId: string, pairId: string, name: string) => void;
  startMatch: (courtId: string) => string | null;
  resetMatch: (courtId: string) => void;
  adjustWins: (courtId: string, team: 'A' | 'B', delta: number) => void;
  finishMatch: (courtId: string, winner: 'A' | 'B') => void;
  clearQueue: (courtId: string) => void;
  clearHistory: (courtId: string) => void;
  undo: (courtId: string) => void;
}

const defaultCourtData = (): CourtData => ({ queue: [], activeMatch: null, history: [] });

const STORAGE_KEY = 'kkubadminton_v1';

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { courts: [], courtData: {}, undoStack: {} };
}

function saveState(s: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const [lang, setLang] = useState<Lang>('th');

  useEffect(() => {
    saveState(state);
  }, [state]);

  const getCourtData = useCallback((courtId: string): CourtData => {
    return state.courtData[courtId] ?? defaultCourtData();
  }, [state.courtData]);

  const saveSnapshot = (s: AppState, courtId: string): AppState => {
    const cd = s.courtData[courtId] ?? defaultCourtData();
    return {
      ...s,
      undoStack: {
        ...s.undoStack,
        [courtId]: { queue: [...cd.queue], activeMatch: cd.activeMatch, history: [...cd.history] },
      },
    };
  };

  const updateCourtData = (courtId: string, updater: (cd: CourtData) => CourtData, withSnapshot = true) => {
    setState(prev => {
      let s = withSnapshot ? saveSnapshot(prev, courtId) : prev;
      const cd = s.courtData[courtId] ?? defaultCourtData();
      return { ...s, courtData: { ...s.courtData, [courtId]: updater(cd) } };
    });
  };

  const addCourt = (name: string) => {
    const id = Date.now().toString();
    setState(prev => ({ ...prev, courts: [...prev.courts, { id, name }] }));
  };

  const deleteCourt = (id: string) => {
    setState(prev => {
      const { [id]: _removed, ...rest } = prev.courtData;
      const { [id]: _u, ...undoRest } = prev.undoStack;
      return { ...prev, courts: prev.courts.filter(c => c.id !== id), courtData: rest, undoStack: undoRest };
    });
  };

  const addPair = (courtId: string, name: string) => {
    const pair: Pair = { id: Date.now().toString(), name, addedAt: Date.now() };
    updateCourtData(courtId, cd => ({ ...cd, queue: [...cd.queue, pair] }));
  };

  const removePair = (courtId: string, pairId: string) => {
    updateCourtData(courtId, cd => ({ ...cd, queue: cd.queue.filter(p => p.id !== pairId) }));
  };

  const reorderQueue = (courtId: string, queue: Pair[]) => {
    updateCourtData(courtId, cd => ({ ...cd, queue }), false);
  };

  const renamePair = (courtId: string, pairId: string, name: string) => {
    updateCourtData(courtId, cd => ({
      ...cd,
      queue: cd.queue.map(p => p.id === pairId ? { ...p, name } : p),
    }));
  };

  const startMatch = (courtId: string): string | null => {
    let errorMsg: string | null = null;
    setState(prev => {
      const cd = prev.courtData[courtId] ?? defaultCourtData();
      if (cd.queue.length < 2) { errorMsg = 'need2'; return prev; }
      const s = saveSnapshot(prev, courtId);
      const [teamA, teamB, ...rest] = cd.queue;
      const matchNumber = (cd.history.length + 1);
      const activeMatch: ActiveMatch = {
        teamA, teamB, teamAWins: 0, teamBWins: 0, startedAt: Date.now(), matchNumber,
      };
      return { ...s, courtData: { ...s.courtData, [courtId]: { ...cd, queue: rest, activeMatch } } };
    });
    return errorMsg;
  };

  const resetMatch = (courtId: string) => {
    updateCourtData(courtId, cd => {
      if (!cd.activeMatch) return cd;
      const { teamA, teamB } = cd.activeMatch;
      return { ...cd, queue: [teamA, teamB, ...cd.queue], activeMatch: null };
    });
  };

  const adjustWins = (courtId: string, team: 'A' | 'B', delta: number) => {
    updateCourtData(courtId, cd => {
      if (!cd.activeMatch) return cd;
      const am = { ...cd.activeMatch };
      if (team === 'A') am.teamAWins = Math.max(0, am.teamAWins + delta);
      else am.teamBWins = Math.max(0, am.teamBWins + delta);
      return { ...cd, activeMatch: am };
    }, false);
  };

  const finishMatch = (courtId: string, winner: 'A' | 'B') => {
    updateCourtData(courtId, cd => {
      if (!cd.activeMatch) return cd;
      const am = cd.activeMatch;
      const record: MatchRecord = {
        id: Date.now().toString(),
        courtId,
        teamA: am.teamA.name,
        teamB: am.teamB.name,
        teamAWins: am.teamAWins,
        teamBWins: am.teamBWins,
        winner,
        startedAt: am.startedAt,
        endedAt: Date.now(),
        matchNumber: am.matchNumber,
      };
      const winnerPair = winner === 'A' ? am.teamA : am.teamB;
      const loserPair = winner === 'A' ? am.teamB : am.teamA;
      return {
        ...cd,
        activeMatch: null,
        queue: [...cd.queue, loserPair, winnerPair],
        history: [record, ...cd.history],
      };
    });
  };

  const clearQueue = (courtId: string) => {
    updateCourtData(courtId, cd => ({ ...cd, queue: [] }));
  };

  const clearHistory = (courtId: string) => {
    updateCourtData(courtId, cd => ({ ...cd, history: [] }));
  };

  const undo = (courtId: string) => {
    setState(prev => {
      const snapshot = prev.undoStack[courtId];
      if (!snapshot) return prev;
      return {
        ...prev,
        courtData: {
          ...prev.courtData,
          [courtId]: { queue: snapshot.queue, activeMatch: snapshot.activeMatch, history: snapshot.history },
        },
        undoStack: { ...prev.undoStack, [courtId]: null },
      };
    });
  };

  return (
    <AppContext.Provider value={{
      state, lang, setLang,
      getCourtData, addCourt, deleteCourt,
      addPair, removePair, reorderQueue, renamePair,
      startMatch, resetMatch, adjustWins, finishMatch,
      clearQueue, clearHistory, undo,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
