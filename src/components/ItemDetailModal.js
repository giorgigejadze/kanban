import React, { useEffect, useMemo, useState } from 'react';
import './ItemDetailModal.css';

const STATUS_BADGE_CLASS = {
  'working on it': 'item-detail-status-badge-orange',
  done: 'item-detail-status-badge-green',
  stuck: 'item-detail-status-badge-red',
  'default label': 'item-detail-status-badge-grey',
  'in progress': 'item-detail-status-badge-orange',
  'to do': 'item-detail-status-badge-grey'
};

const getStatusBadgeClass = (statusText) => {
  const key = (statusText || '').toLowerCase().trim();
  return STATUS_BADGE_CLASS[key] || 'item-detail-status-badge-default';
};

const toDateInputValue = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const ItemDetailModal = ({ item, saving, onSave, onClose }) => {
  const currentItem = item || {};

  const [title, setTitle] = useState(currentItem.title || '');
  const [personId, setPersonId] = useState(currentItem.assignee?.id || '');
  const [statusText, setStatusText] = useState(currentItem.statusText || '');
  const [dateText, setDateText] = useState(toDateInputValue(currentItem.dateText));
  const [extraFieldValues, setExtraFieldValues] = useState(() =>
    Object.fromEntries((currentItem.extraFields || []).map((field) => [field.id, field.value || '']))
  );
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!item) return;
    setTitle(item.title || '');
    setPersonId(item.assignee?.id || '');
    setStatusText(item.statusText || '');
    setDateText(toDateInputValue(item.dateText));
    setExtraFieldValues(Object.fromEntries((item.extraFields || []).map((field) => [field.id, field.value || ''])));
    setSubmitError('');
  }, [item]);

  const statusOptions = useMemo(() => {
    if (Array.isArray(currentItem.statusOptions) && currentItem.statusOptions.length) {
      return currentItem.statusOptions.map((opt) => opt.label).filter(Boolean);
    }
    return [currentItem.statusText || 'Done'];
  }, [currentItem.statusOptions, currentItem.statusText]);

  const statusClass = getStatusBadgeClass(statusText);

  if (!item) return null;

  const handleSave = async () => {
    setSubmitError('');
    try {
      await onSave?.(item, {
        title,
        personId,
        statusText,
        dateText,
        extraFields: extraFieldValues
      });
      onClose?.();
    } catch (e) {
      setSubmitError(e?.message || 'შენახვა ვერ მოხერხდა');
    }
  };

  return (
    <div className="item-detail-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="item-detail-title">
      <div className="item-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="item-detail-header">
          <div className="item-detail-title-wrap">
            <input
              id="item-detail-title"
              className="item-detail-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Item title"
            />
          </div>
          <div className="item-detail-actions">
            <button type="button" className="item-detail-icon-btn item-detail-close" onClick={onClose} aria-label="დახურვა">✕</button>
          </div>
        </div>
        <div className="item-detail-body">
          <div className="item-detail-row">
            <span className="item-detail-label item-detail-label-person">
              <span className="item-detail-label-icon" aria-hidden>👤</span>
              Person
            </span>
            <span className="item-detail-value item-detail-value-person">
              <select className="item-detail-input" value={personId || ''} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">Unassigned</option>
                {(item.peopleOptions || []).map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </span>
          </div>
          <div className="item-detail-row">
            <span className="item-detail-label item-detail-label-status">
              <span className="item-detail-label-icon" aria-hidden>≡</span>
              Status
            </span>
            <span className="item-detail-value">
              <select className="item-detail-input" value={statusText} onChange={(e) => setStatusText(e.target.value)}>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <span
                className={`item-detail-status-badge ${statusClass}`}
                style={item.statusColor ? { background: item.statusColor } : undefined}
              >
                {statusText || 'Status'}
              </span>
            </span>
          </div>
          <div className="item-detail-row">
            <span className="item-detail-label item-detail-label-date">
              <span className="item-detail-label-icon" aria-hidden>📅</span>
              Date
            </span>
            <span className="item-detail-value">
              <input
                className="item-detail-input"
                type="date"
                value={dateText}
                onChange={(e) => setDateText(e.target.value)}
              />
            </span>
          </div>
          {(item.extraFields || []).map((field) => (
            <div className="item-detail-row" key={field.id}>
              <span className="item-detail-label">
                <span className="item-detail-label-icon" aria-hidden>•</span>
                {field.title}
              </span>
              <span className="item-detail-value">
                <input
                  className="item-detail-input"
                  value={extraFieldValues[field.id] ?? ''}
                  onChange={(e) => setExtraFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                />
              </span>
            </div>
          ))}
          {submitError ? <p className="item-detail-error">{submitError}</p> : null}
          <div className="item-detail-footer">
            <button type="button" className="item-detail-btn item-detail-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="item-detail-btn item-detail-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemDetailModal;
