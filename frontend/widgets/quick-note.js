import { el, clearElement, setText } from '../lib/dom.js';

export function mount(root, context) {
  clearElement(root);
  root.className = 'ios-widget widget-quick-note';

  const statusSpan = el('span', {
    className: 'note-status',
    id: 'noteSavedStatus',
    textContent: context.getPortalSyncStatusText?.() || '已就绪',
  });
  const retryBtn = el('button', {
    type: 'button',
    className: 'widget-inline-btn',
    hidden: true,
    textContent: '重试',
  });

  const header = el(
    'div',
    { className: 'note-header' },
    el('div', { className: 'note-title-wrap' }, el('span', { textContent: '备忘速记' })),
    el('div', { className: 'note-status-wrap' }, statusSpan, retryBtn)
  );

  const textarea = el('textarea', {
    id: 'quickNoteArea',
    className: 'quick-note-textarea',
    placeholder: '在此随手记录今日灵感、速记或临时链接…',
  });
  textarea.value = context.getNote?.() ?? '';

  const inner = el('div', { className: 'widget-inner' }, header, textarea);
  const compactPrimary = el('div', { className: 'widget-compact-primary', textContent: '备忘速记' });
  const compactSecondary = el('div', { className: 'widget-compact-secondary', textContent: '点击编辑速记…' });
  const compactSummary = el(
    'div',
    { className: 'widget-compact-summary' },
    el(
      'div',
      { className: 'widget-compact-top' },
      el('span', { className: 'widget-compact-kicker', textContent: '备忘速记' }),
      el('span', { className: 'widget-compact-badge', textContent: '详情 ↗' })
    ),
    compactPrimary,
    compactSecondary
  );
  const label = el('span', { className: 'widget-label', textContent: '速记' });
  root.append(inner, compactSummary, label);

  function syncCompactNote() {
    const raw = String(textarea.value || '').trim();
    if (!raw) {
      setText(compactPrimary, '暂无速记');
      setText(compactSecondary, '点击输入今日灵感或链接…');
      return;
    }
    const lines = raw
      .split(/\r?\n/)
      .map(l => l.replace(/^[•\-*\s]+/, '').trim())
      .filter(Boolean);
    setText(compactPrimary, (lines[0] || raw).slice(0, 26));
    setText(compactSecondary, lines[1] ? lines[1].slice(0, 32) : `共 ${raw.length} 字 · 点击编辑`);
  }

  syncCompactNote();

  const onInput = () => {
    setText(statusSpan, '正在保存…');
    retryBtn.hidden = true;
    syncCompactNote();
    context.saveNote?.(textarea.value);
  };

  const onRetry = (e) => {
    e.stopPropagation();
    setText(statusSpan, '正在重试…');
    context.saveNote?.(textarea.value);
  };

  textarea.addEventListener('input', onInput);
  retryBtn.addEventListener('click', onRetry);

  return {
    update(data = {}) {
      if (typeof data.note === 'string' && document.activeElement !== textarea) {
        textarea.value = data.note;
        syncCompactNote();
      }
      if (data.portalSyncStatus) {
        setText(statusSpan, data.portalSyncStatus.label || '已保存');
        retryBtn.hidden = !data.portalSyncStatus.hasError;
      }
    },
    destroy() {
      textarea.removeEventListener('input', onInput);
      retryBtn.removeEventListener('click', onRetry);
      clearElement(root);
    },
  };
}
