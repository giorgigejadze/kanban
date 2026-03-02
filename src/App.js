import React, { useRef, useState, useEffect } from 'react';
import './App.css';
import KanbanBoard from './components/KanbanBoard';
import ItemDetailModal from './components/ItemDetailModal';
import mondayService from './services/mondayService';

function App() {
  const [kanbanData, setKanbanData] = useState({ columns: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDemo, setIsDemo] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [savingItem, setSavingItem] = useState(false);
  const [appTheme, setAppTheme] = useState('dark');
  const hasContextListenerRef = useRef(false);
  const hasBoardEventsListenerRef = useRef(false);
  const activeBoardIdRef = useRef(null);
  const boardRefreshTimeoutRef = useRef(null);
  const skipBoardRefreshUntilRef = useRef(0);

  const normalizeMondayTheme = (themeCandidate) => {
    const value = String(themeCandidate || '').toLowerCase().trim();
    if (!value) return null;
    if (value.includes('dark') || value === 'black') return 'dark';
    if (value.includes('light')) return 'light';
    return null;
  };

  const extractThemeCandidate = (context) => {
    const candidates = [
      context?.theme?.name,
      context?.theme?.theme,
      context?.themeConfig?.name,
      context?.themeConfig?.theme,
      context?.themeConfig?.colorScheme,
      context?.user?.theme,
      context?.data?.theme?.name,
      context?.data?.theme,
      context?.data?.themeConfig?.name,
      context?.data?.themeConfig?.theme,
      context?.theme
    ];
    return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  };

  const applyThemeFromContext = (context) => {
    const normalizedTheme = normalizeMondayTheme(extractThemeCandidate(context));
    if (normalizedTheme) setAppTheme(normalizedTheme);
  };

  const handleColumnsChange = (nextColumns) => {
    setKanbanData((prev) => ({ ...prev, columns: nextColumns }));
    if (selectedItem) {
      const updatedSelected = (nextColumns || [])
        .flatMap((column) => column.items || [])
        .find((item) => String(item.id) === String(selectedItem.id));
      if (updatedSelected) setSelectedItem(updatedSelected);
    }
  };

  const loadDemo = () => {
    setLoading(true);
    setError(null);
    setIsDemo(true);
    const demoData = mondayService.getDemoKanbanData();
    setKanbanData(demoData || { columns: [] });
    setLoading(false);
  };

  const loadEmployeesFromBoard = async (boardId) => {
    if (!boardId) return;
    activeBoardIdRef.current = String(boardId);
    setLoading(true);
    setError(null);
    try {
      const boardData = await mondayService.fetchBoardItems(boardId);
      const transformed = mondayService.transformToKanbanByStatus(boardData);
      if (transformed.columns && transformed.columns.length) {
        setKanbanData(transformed);
        if (selectedItem) {
          const updated = transformed.columns
            .flatMap((column) => column.items || [])
            .find((it) => String(it.id) === String(selectedItem.id));
          if (updated) setSelectedItem(updated);
        }
        setIsDemo(false);
        console.log('[Kandan] loadEmployeesFromBoard – ბორდის მონაცემები ჩაირთო:', boardId, transformed);
      } else {
        loadDemo();
      }
    } catch (err) {
      console.error('[Kandan] loadEmployeesFromBoard შეცდომა:', err);
      setError(err.message);
      loadDemo();
    } finally {
      setLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    if (!mondayService.hasApi()) {
      await mondayService.waitForMondayApi(5000);
    }
    if (!mondayService.hasApi()) {
      console.log('[Kandan] API არ არის კონფიგურირებული – გამოიყენება დემო მონაცემები');
      loadDemo();
      return;
    }
    const monday = mondayService.getMondayApi?.() ?? (typeof window !== 'undefined' && window.monday);
    if (monday && typeof monday.listen === 'function') {
      if (!hasContextListenerRef.current) {
        hasContextListenerRef.current = true;
        mondayService.listenContext((context) => {
          applyThemeFromContext(context);
          const boardId = context?.boardId ?? context?.data?.boardId;
          if (boardId && String(boardId) !== String(activeBoardIdRef.current || '')) {
            loadEmployeesFromBoard(String(boardId));
          }
          // boardId-ის გარეშე (მაგ. prefetch_mf) არ ვიძახებთ loadDemo – ველოდებით ნამდვილ context-ს
        });
      }
      if (!hasBoardEventsListenerRef.current) {
        hasBoardEventsListenerRef.current = true;
        mondayService.listenBoardChanges(() => {
          const boardId = activeBoardIdRef.current;
          if (!boardId) return;
          if (Date.now() < skipBoardRefreshUntilRef.current) return;
          if (boardRefreshTimeoutRef.current) clearTimeout(boardRefreshTimeoutRef.current);
          boardRefreshTimeoutRef.current = setTimeout(() => {
            loadEmployeesFromBoard(boardId);
          }, 600);
        });
      }
      if (typeof monday.get === 'function') {
        try {
          const contextRes = await monday.get('context');
          applyThemeFromContext(contextRes?.data ?? contextRes);
        } catch (e) {
          // თუ context ვერ მოვიდა, ვტოვებთ ნაგულისხმევ თემას
        }
      }
      const boardId = await mondayService.getCurrentBoardId();
      if (boardId) loadEmployeesFromBoard(boardId);
      else setLoading(false);
      return;
    }
    try {
      let boardId = await mondayService.getCurrentBoardId();
      if (!boardId) {
        const boards = await mondayService.fetchBoards();
        if (!boards.length) {
          loadDemo();
          return;
        }
        boardId = boards[0].id;
      }
      await loadEmployeesFromBoard(boardId);
    } catch (err) {
      console.error('[Kandan] Monday API შეცდომა:', err);
      setError(err.message);
      loadDemo();
    } finally {
      setLoading(false);
    }
  };

  const handleSaveItem = async (item, updates) => {
    if (isDemo) {
      setError('Demo რეჟიმში Monday.com-ზე შენახვა შეუძლებელია');
      return;
    }
    setSavingItem(true);
    setError(null);
    try {
      await mondayService.updateItemDetails(item, updates);
      if (activeBoardIdRef.current) {
        try {
          await loadEmployeesFromBoard(activeBoardIdRef.current);
        } catch (refreshErr) {
          console.warn('[Kandan] save წარმატებულია, მაგრამ refresh ვერ შესრულდა:', refreshErr);
        }
      }
    } catch (e) {
      console.error('[Kandan] item update შეცდომა:', e);
      setError(e?.message || 'შენახვა ვერ მოხერხდა');
      throw e;
    } finally {
      setSavingItem(false);
    }
  };

  const handleCardMoved = async (previousItem, _nextItem, targetColumn) => {
    if (isDemo || !previousItem?.statusColumnId) return;
    const targetStatus = String(targetColumn?.title || '').trim();
    if (!targetStatus) return;
    const prevStatus = String(previousItem?.statusText || '').trim();
    if (prevStatus === targetStatus) return;
    try {
      // Drag/drop-ზე უკვე ლოკალურად განახლებულია UI; ახლავე არ გადავტვირთოთ ბორდი events listener-ით.
      skipBoardRefreshUntilRef.current = Date.now() + 2500;
      await mondayService.updateItemDetails(previousItem, { statusText: targetStatus });
    } catch (e) {
      console.error('[Kandan] drag status sync შეცდომა:', e);
      setError(e?.message || 'სტატუსის სინქრონიზაცია ვერ მოხერხდა');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => () => {
    if (boardRefreshTimeoutRef.current) {
      clearTimeout(boardRefreshTimeoutRef.current);
      boardRefreshTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    document.body.setAttribute('data-theme', appTheme);
  }, [appTheme]);

  return (
    <div className={`app theme-${appTheme}`}>
      <header className="app-header">
        <div className="header-content">
          <div>
            <h1>Kanban</h1>
          </div>
          <button type="button" className="refresh-button" onClick={loadData}>
            🔄 განახლება
          </button>
        </div>
      </header>

      <main className="app-main">
        <KanbanBoard
          columns={kanbanData.columns}
          loading={loading}
          error={error}
          onItemClick={setSelectedItem}
          onColumnsChange={handleColumnsChange}
          onCardMoved={handleCardMoved}
        />
      </main>
      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          saving={savingItem}
          onSave={handleSaveItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}

export default App;
