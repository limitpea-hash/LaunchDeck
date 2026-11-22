import { el, clearElement, setText } from '../lib/dom.js';
import {
  createCompactTopRow,
  createStaticWidgetIcon,
  createSummaryExtra,
  createSummaryScrollRegion,
} from './summary-helpers.js';

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
  const { topRow: compactTopRow } = createCompactTopRow({
    kickerText: '备忘速记',
    iconNode: createStaticWidgetIcon('quick-note'),
    accentClass: 'is-note',
  });
  const compactPrimary = el('div', { className: 'widget-compact-primary compact-note-line1', textContent: '备忘速记' });
  const compactSecondary = el('div', { className: 'widget-compact-secondary compact-note-line2', textContent: '点击编辑速记…' });
  const compactNotePaper = el(
    'div',
    { className: 'compact-note-paper' },
    compactPrimary,
    compactSecondary
  );
  const summaryNoteMeta = el('div', { className: 'summary-note-meta', textContent: '' });
  const summaryNoteScroll = createSummaryScrollRegion({
    ariaLabel: '备忘速记多行预览',
    extraClass: 'summary-note-scroll',
  });
  const summaryExtra = createSummaryExtra(
    'summary-extra-quick-note',
    summaryNoteMeta,
    summaryNoteScroll
  );
  const compactSummary = el(
    'div',
    { className: 'widget-compact-summary compact-layout-quick-note' },
    compactTopRow,
    compactNotePaper,
    summaryExtra
  );
  const label = el('span', { className: 'widget-label', textContent: '速记' });
  root.append(inner, compactSummary, label);

  function syncCompactNote() {
    const raw = String(textarea.value || '').trim();
    clearElement(summaryNoteScroll);
    if (!raw) {
      setText(compactPrimary, '暂无速记');
      setText(compactSecondary, '点击输入今日灵感或链接…');
      setText(summaryNoteMeta, '空白便签 · 点击打开速记编辑器');
      summaryNoteScroll.appendChild(
        el('div', {
          className: 'summary-note-empty',
          textContent: '在此记录今日灵感、会议纪要或常用临时链接…',
        })
      );
      return;
    }
    const rawLines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    const cleanedLines = rawLines
      .map(l => l.replace(/^[•\-*\s]+/, '').trim())
      .filter(Boolean);
    const displayLines = cleanedLines.length > 0 ? cleanedLines : [raw];
    setText(compactPrimary, (displayLines[0] || raw).slice(0, 26));
    setText(
      compactSecondary,
      displayLines[1] ? displayLines[1].slice(0, 32) : `共 ${raw.length} 字 · 点击编辑`
    );
    setText(
      summaryNoteMeta,
      `共 ${displayLines.length} 段 · ${raw.length} 字`
    );
    displayLines.slice(0, 12).forEach((lineText, idx) => {
      summaryNoteScroll.appendChild(
        el(
          'div',
          { className: 'summary-note-paragraph' },
          el('span', {
            className: 'summary-note-index',
            'aria-hidden': 'true',
            textContent: `${idx + 1}.`,
          }),
          el('span', {
            className: 'summary-note-text',
            textContent: lineText,
          })
        )
      );
    });
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
