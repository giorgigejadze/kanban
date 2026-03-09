import React, { useRef, useState, useEffect } from 'react';
import './App.css';
import KanbanBoard from './components/KanbanBoard';
import ItemDetailModal from './components/ItemDetailModal';
import mondayService from './services/mondayService';

function App() {
  const [kanbanDataByBoard, setKanbanDataByBoard] = useState({});
  const [boards, setBoards] = useState([]);
  const [selectedBoardIds, setSelectedBoardIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingBoards, setLoadingBoards] = useState({});
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
  const boardAddDropdownRef = useRef(null);
  const [boardAddDropdownOpen, setBoardAddDropdownOpen] = useState(false);
  const initialRestoreDoneRef = useRef(false);
  const allowStorageSaveRef = useRef(false);

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

  const handleColumnsChange = (boardId, nextColumns) => {
    if (!boardId) return;
    setKanbanDataByBoard((prev) => ({
      ...prev,
      [boardId]: { ...prev[boardId], columns: nextColumns }
    }));
    if (selectedItem && String(selectedItem.boardId) === String(boardId)) {
      const updatedSelected = (nextColumns || [])
        .flatMap((column) => column.items || [])
        .find((item) => String(item.id) === String(selectedItem.id));
      if (updatedSelected) setSelectedItem(updatedSelected);
    }
  };

  const loadDemo = () => {
    initialRestoreDoneRef.current = true;
    allowStorageSaveRef.current = true;
    setLoading(true);
    setError(null);
    setIsDemo(true);
    const demoData = mondayService.getDemoKanbanData();
    const demoId = 'demo-board-1';
    setKanbanDataByBoard({
      [demoId]: { columns: demoData?.columns || [], boardName: 'Demo Board' }
    });
    setSelectedBoardIds([demoId]);
    setLoading(false);
  };

  const loadBoard = async (boardId) => {
    if (!boardId) return;
    const bid = String(boardId);
    setLoadingBoards((prev) => ({ ...prev, [bid]: true }));
    setError(null);
    try {
      const boardData = await mondayService.fetchBoardItems(bid);
      const transformed = mondayService.transformToKanbanByStatus(boardData);
      if (transformed.columns) {
        const statusCols = boardData.__statusOptionsByColumnId && Object.keys(boardData.__statusOptionsByColumnId);
        const statusColumnId = statusCols?.length ? statusCols[0] : null;
        const groups = boardData.groups || boardData.__groups || [];
        const firstGroup = groups?.length ? groups[0] : null;
        const defaultGroupId = firstGroup?.id ? String(firstGroup.id) : null;
        setKanbanDataByBoard((prev) => ({
          ...prev,
          [bid]: {
            columns: transformed.columns,
            boardName: boardData.name || '',
            defaultGroupId,
            statusColumnId
          }
        }));
        if (selectedItem && String(selectedItem.boardId) === bid) {
          const updated = transformed.columns
            .flatMap((column) => column.items || [])
            .find((it) => String(it.id) === String(selectedItem.id));
          if (updated) setSelectedItem(updated);
        }
        setIsDemo(false);
      }
    } catch (err) {
      console.error('[Kandan] loadBoard შეცდომა:', err);
      setError(err.message);
    } finally {
      setLoadingBoards((prev) => ({ ...prev, [bid]: false }));
    }
  };

  const loadSelectedBoards = async (ids) => {
    if (!ids || !ids.length) return;
    setLoading(true);
    try {
      await Promise.all(ids.map((id) => loadBoard(id)));
    } finally {
      setLoading(false);
    }
  };

  const loadBoardsList = async () => {
    const boardsList = await mondayService.fetchBoards();
    setBoards(boardsList || []);
    return boardsList;
  };

  const toggleBoard = (boardId) => {
    const bid = String(boardId);
    setSelectedBoardIds((prev) => {
      const has = prev.includes(bid);
      const next = has ? prev.filter((id) => id !== bid) : [...prev, bid];
      if (next.length) loadSelectedBoards(next);
      return next;
    });
  };

  const addBoard = (boardId) => {
    const bid = String(boardId);
    setSelectedBoardIds((prev) => {
      if (prev.includes(bid)) return prev;
      const next = [...prev, bid];
      loadSelectedBoards(next);
      return next;
    });
  };

  const removeBoard = (boardId) => {
    const bid = String(boardId);
    setSelectedBoardIds((prev) => prev.filter((id) => id !== bid));
    setKanbanDataByBoard((prev) => {
      const copy = { ...prev };
      delete copy[bid];
      return copy;
    });
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
          if (!initialRestoreDoneRef.current) return;
          const boardId = context?.boardId ?? context?.data?.boardId;
          if (boardId) {
            const id = String(boardId);
            setSelectedBoardIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
            activeBoardIdRef.current = id;
          }
        });
      }
      if (!hasBoardEventsListenerRef.current) {
        hasBoardEventsListenerRef.current = true;
        mondayService.listenBoardChanges(() => {
          if (Date.now() < skipBoardRefreshUntilRef.current) return;
          if (boardRefreshTimeoutRef.current) clearTimeout(boardRefreshTimeoutRef.current);
          boardRefreshTimeoutRef.current = setTimeout(() => {
            setSelectedBoardIds((prev) => {
              if (prev.length) loadSelectedBoards(prev);
              return prev;
            });
          }, 600);
        });
      }
      if (typeof monday.get === 'function') {
        try {
          const contextRes = await monday.get('context');
          applyThemeFromContext(contextRes?.data ?? contextRes);
        } catch (e) {}
      }
      try {
        const boardsList = await loadBoardsList();
        let initialId = await mondayService.getCurrentBoardId();
        if (!initialId && boardsList?.length) initialId = String(boardsList[0].id);
        const fallbackId = initialId || (boardsList?.length ? String(boardsList[0].id) : null);
        const persistedIds = await mondayService.getBoardIdsFromStorage();
        const ids = persistedIds.length > 0
          ? (persistedIds.includes(initialId) ? persistedIds : [initialId, ...persistedIds].filter(Boolean))
          : (fallbackId ? [fallbackId] : []);
        if (ids.length) {
          initialRestoreDoneRef.current = true;
          setSelectedBoardIds(ids);
          activeBoardIdRef.current = ids[0];
          await loadSelectedBoards(ids);
        } else {
          initialRestoreDoneRef.current = true;
        }
      } catch (err) {
        console.error('[Kandan] loadBoards შეცდომა:', err);
        setError(err.message);
        loadDemo();
      } finally {
        allowStorageSaveRef.current = true;
        setLoading(false);
      }
      return;
    }
    try {
      const boardsList = await loadBoardsList();
      const persistedIds = await mondayService.getBoardIdsFromStorage();
      const fallbackId = boardsList?.length ? String(boardsList[0].id) : null;
      const ids = persistedIds.length > 0 ? persistedIds : (fallbackId ? [fallbackId] : []);
      if (ids.length === 0) {
        loadDemo();
        return;
      }
      initialRestoreDoneRef.current = true;
      setSelectedBoardIds(ids);
      await loadSelectedBoards(ids);
    } catch (err) {
      console.error('[Kandan] Monday API შეცდომა:', err);
      setError(err.message);
      loadDemo();
    } finally {
      allowStorageSaveRef.current = true;
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
      const bid = item?.boardId ? String(item.boardId) : null;
      if (bid) {
        try {
          await loadBoard(bid);
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

  const handleAddItem = async (boardId, column) => {
    if (isDemo) {
      setError('Demo რეჟიმში ახალი კლიენტის დამატება ვერ მოხერხდება');
      return;
    }
    const data = kanbanDataByBoard[boardId];
    const defaultGroupId = data?.defaultGroupId;
    const statusColumnId = data?.statusColumnId;
    if (!defaultGroupId || !statusColumnId) {
      setError('ბორდის სტრუქტურა არასაკმარისია (group/status)');
      return;
    }
    setError(null);
    try {
      await mondayService.createItem({
        boardId,
        groupId: defaultGroupId,
        statusColumnId,
        statusLabel: column?.title || ''
      });
      await loadBoard(boardId);
    } catch (e) {
      console.error('[Kandan] createItem შეცდომა:', e);
      setError(e?.message || 'კლიენტის დამატება ვერ მოხერხდა');
    }
  };

  const handleDeleteItem = async (boardId, item) => {
    if (isDemo) {
      const nextColumns = (kanbanDataByBoard[boardId]?.columns || []).map((col) => ({
        ...col,
        items: (col.items || []).filter((i) => String(i.id) !== String(item.id))
      }));
      handleColumnsChange(boardId, nextColumns);
      if (selectedItem && String(selectedItem.id) === String(item.id)) setSelectedItem(null);
      return;
    }
    setError(null);
    try {
      await mondayService.deleteItem(item.id);
      const nextColumns = (kanbanDataByBoard[boardId]?.columns || []).map((col) => ({
        ...col,
        items: (col.items || []).filter((i) => String(i.id) !== String(item.id))
      }));
      handleColumnsChange(boardId, nextColumns);
      if (selectedItem && String(selectedItem.id) === String(item.id)) setSelectedItem(null);
    } catch (e) {
      console.error('[Kandan] deleteItem შეცდომა:', e);
      setError(e?.message || 'წაშლა ვერ მოხერხდა');
    }
  };

  const handleCardMoved = async (previousItem, _nextItem, targetColumn) => {
    if (isDemo || !previousItem?.statusColumnId) return;
    const targetStatus = String(targetColumn?.title || '').trim();
    if (!targetStatus) return;
    const prevStatus = String(previousItem?.statusText || '').trim();
    if (prevStatus === targetStatus) return;
    try {
      skipBoardRefreshUntilRef.current = Date.now() + 2500;
      await mondayService.updateItemDetails(previousItem, { statusText: targetStatus });
    } catch (e) {
      console.error('[Kandan] drag status sync შეცდომა:', e);
      setError(e?.message || 'Error in status sync');
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

  useEffect(() => {
    if (!allowStorageSaveRef.current || isDemo) return;
    mondayService.setBoardIdsToStorage(selectedBoardIds);
  }, [selectedBoardIds, isDemo]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (boardAddDropdownRef.current && !boardAddDropdownRef.current.contains(e.target)) {
        setBoardAddDropdownOpen(false);
      }
    };
    if (boardAddDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [boardAddDropdownOpen]);

  return (
    <div className={`app theme-${appTheme}`}>
      <header className="app-header">
        <div className="header-content">
          <div>
            <h1>Kanban</h1>
            {!isDemo && boards.length > 0 && (
              <div className="board-selector-multi">
                <div className="board-add-dropdown" ref={boardAddDropdownRef}>
                  <button
                    type="button"
                    className="board-selector board-add board-add-trigger"
                    onClick={(e) => { e.stopPropagation(); setBoardAddDropdownOpen((v) => !v); }}
                    aria-label="Add Board"
                    aria-expanded={boardAddDropdownOpen}
                    aria-haspopup="listbox"
                  >
                    Add Board <span className="board-add-chevron">{boardAddDropdownOpen ? '▲' : '▼'}</span>
                  </button>
                  <div
                    className={`board-add-menu ${boardAddDropdownOpen ? 'board-add-menu-open' : ''}`}
                    role="listbox"
                  >
                    {boards
                      .filter((b) => !selectedBoardIds.includes(String(b.id)))
                      .map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          role="option"
                          className="board-add-option"
                          onClick={() => { addBoard(String(b.id)); setBoardAddDropdownOpen(false); }}
                        >
                          {b.name || `ბორდი ${b.id}`}
                        </button>
                      ))}
                    {boards.filter((b) => !selectedBoardIds.includes(String(b.id))).length === 0 && (
                      <div className="board-add-empty">ყველა ბორდი უკვე დამატებულია</div>
                    )}
                  </div>
                </div>
                <div className="selected-boards">
                  {selectedBoardIds.map((bid) => {
                    const b = boards.find((x) => String(x.id) === bid);
                    const name = b?.name || kanbanDataByBoard[bid]?.boardName || `ბორდი ${bid}`;
                    return (
                      <span key={bid} className="board-chip">
                        {name}
                        <button type="button" className="board-chip-remove" onClick={() => removeBoard(bid)} aria-label="ამოშლა">×</button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {isDemo && <span className="board-chip">Demo Board</span>}
          </div>
        </div>
      </header>

      <main className="app-main app-main-multi">
        {selectedBoardIds.length === 0 && !loading && (
          <div className="kanban-empty">
            <p>ბორდების არჩევა: დააჭირეთ &quot;Add Board&quot; და აირჩიეთ ბორდი</p>
          </div>
        )}
        {selectedBoardIds.map((boardId) => {
          const data = kanbanDataByBoard[boardId];
          const boardLoading = loadingBoards[boardId];
          const cols = data?.columns || [];
          const isLoading = loading && selectedBoardIds.length === 1 && selectedBoardIds[0] === boardId ? loading : boardLoading;
          const boardName = data?.boardName || boards.find((b) => String(b.id) === boardId)?.name || `ბორდი ${boardId}`;
          return (
            <div key={boardId} className="kanban-panel resizable-panel">
              <div className="kanban-panel-header">
                <h3 className="kanban-panel-title">{boardName}</h3>
                {!isDemo && (
                  <button type="button" className="kanban-panel-remove" onClick={() => removeBoard(boardId)} aria-label="ბორდის ამოშლა">
                    ×
                  </button>
                )}
              </div>
              <div className="kanban-panel-body">
                <KanbanBoard
                  boardId={boardId}
                  columns={cols}
                  loading={isLoading}
                  error={selectedBoardIds.length === 1 ? error : null}
                  onItemClick={setSelectedItem}
                  onColumnsChange={(next) => handleColumnsChange(boardId, next)}
                  onCardMoved={handleCardMoved}
                  onAddItem={(column) => handleAddItem(boardId, column)}
                  onDeleteItem={(item) => handleDeleteItem(boardId, item)}
                />
              </div>
            </div>
          );
        })}
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
