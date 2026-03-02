import React, { useState } from 'react';
import './KanbanBoard.css';

const COLUMN_COLORS = {
  'working on it': 'column-header-orange',
  done: 'column-header-green',
  stuck: 'column-header-red',
  'default label': 'column-header-grey'
};

const getColumnHeaderClass = (title) => {
  const key = (title || '').toLowerCase().trim();
  return COLUMN_COLORS[key] || 'column-header-default';
};

const cloneColumns = (sourceColumns) =>
  sourceColumns.map((column) => ({
    ...column,
    items: [...(column.items || [])]
  }));

const KanbanBoard = ({ columns, loading, error, onItemClick, onColumnsChange, onCardMoved }) => {
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const moveCard = (sourceColumnId, itemId, targetColumnId, targetIndex) => {
    if (!sourceColumnId || !itemId || !targetColumnId || typeof targetIndex !== 'number') return;
    const nextColumns = cloneColumns(columns || []);
    const sourceColumn = nextColumns.find((column) => String(column.id) === String(sourceColumnId));
    const targetColumn = nextColumns.find((column) => String(column.id) === String(targetColumnId));
    if (!sourceColumn || !targetColumn) return;

    const sourceItemIndex = sourceColumn.items.findIndex((item) => String(item.id) === String(itemId));
    if (sourceItemIndex < 0) return;

    const [movedItem] = sourceColumn.items.splice(sourceItemIndex, 1);
    if (!movedItem) return;
    const previousItem = { ...movedItem };

    // როცა ბარათი სხვა სტატუს-სვეტში გადადის, card-ის Status ველი ახალ სვეტთან სინქრონდება.
    if (String(sourceColumn.id) !== String(targetColumn.id)) {
      movedItem.statusText = targetColumn.title || movedItem.statusText;
      if (targetColumn.headerColor) movedItem.statusColor = targetColumn.headerColor;
    }

    let insertIndex = targetIndex;
    if (String(sourceColumn.id) === String(targetColumn.id) && sourceItemIndex < targetIndex) {
      insertIndex -= 1;
    }
    const maxIndex = targetColumn.items.length;
    if (insertIndex < 0) insertIndex = 0;
    if (insertIndex > maxIndex) insertIndex = maxIndex;
    targetColumn.items.splice(insertIndex, 0, movedItem);

    if (typeof onColumnsChange === 'function') {
      onColumnsChange(nextColumns);
    }
    if (String(sourceColumn.id) !== String(targetColumn.id) && typeof onCardMoved === 'function') {
      onCardMoved(previousItem, { ...movedItem }, { id: targetColumn.id, title: targetColumn.title });
    }
  };

  const onCardDragStart = (event, columnId, itemId) => {
    event.dataTransfer.effectAllowed = 'move';
    setDragging({ columnId, itemId });
  };

  const onCardDrop = (event, columnId, itemIndex) => {
    event.preventDefault();
    if (dragging) {
      moveCard(dragging.columnId, dragging.itemId, columnId, itemIndex);
    }
    setDragging(null);
    setDropTarget(null);
  };

  const onColumnDropToEnd = (event, columnId, columnLength) => {
    event.preventDefault();
    if (dragging) {
      moveCard(dragging.columnId, dragging.itemId, columnId, columnLength);
    }
    setDragging(null);
    setDropTarget(null);
  };

  if (loading) {
    // პირველ ჩატვირთვაზე ცარიელი სივრცე ვაჩვენოთ, spinner/ტექსტის გარეშე.
    if (!columns || columns.length === 0) {
      return <div className="kanban-board" aria-hidden />;
    }
    return (
      <div className="kanban-loading">
        <div className="spinner"></div>
        <p>მონაცემების ჩატვირთვა...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kanban-error">
        <h3>შეცდომა</h3>
        <p>{error}</p>
        <p className="error-hint">
          გთხოვთ შეამოწმოთ API Key და კავშირი Monday.com-თან, ან გამოიყენეთ Demo რეჟიმი
        </p>
      </div>
    );
  }

  if (!columns || columns.length === 0) {
    return (
      <div className="kanban-empty">
        <p>მონაცემები არ მოიძებნა</p>
      </div>
    );
  }

  return (
    <div className="kanban-board">
      {columns.map((column) => (
        <div key={column.id} className="kanban-column">
          <div
            className={`kanban-column-header ${column.headerColor ? '' : getColumnHeaderClass(column.title)}`}
            style={column.headerColor ? { background: column.headerColor } : undefined}
          >
            <h3>{column.title}</h3>
            <div className="column-header-right">
              <span className="item-count">{column.items.length}</span>
              <button type="button" className="column-menu-btn" aria-label="მეტი">⋯</button>
            </div>
          </div>
          <div
            className={`kanban-column-content ${dropTarget?.columnId === column.id && dropTarget?.itemIndex === column.items.length ? 'kanban-column-content-drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget({ columnId: column.id, itemIndex: column.items.length });
            }}
            onDrop={(e) => onColumnDropToEnd(e, column.id, column.items.length)}
          >
            {column.items.map((item, itemIndex) => (
              <div
                key={item.id}
                className={`kanban-card ${dragging?.itemId === item.id ? 'kanban-card-dragging' : ''} ${dropTarget?.columnId === column.id && dropTarget?.itemIndex === itemIndex ? 'kanban-drop-target' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onItemClick?.(item)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onItemClick?.(item); } }}
                draggable
                onDragStart={(e) => onCardDragStart(e, column.id, item.id)}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDropTarget({ columnId: column.id, itemIndex });
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  onCardDrop(e, column.id, itemIndex);
                }}
              >
                <div className="card-header">
                  <h4>{item.title}</h4>
                  <div className="card-meta">
                    <span className="card-subtitle">{item.boardName || 'Board view'}</span>
                    <span className="card-icons">
                      {item.assignee ? (
                        <span className="card-avatar" title={item.assignee.name}>
                          {item.assignee.avatarUrl ? (
                            <img src={item.assignee.avatarUrl} alt={item.assignee.name} />
                          ) : (
                            <span className="card-avatar-initial">
                              {item.assignee.name?.[0]?.toUpperCase() || '👤'}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="card-icon card-icon-person" aria-hidden>👤</span>
                      )}
                    </span>
                  </div>
                </div>
                {item.content && (
                  <div className="card-content">
                    <p>{item.content}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default KanbanBoard;
