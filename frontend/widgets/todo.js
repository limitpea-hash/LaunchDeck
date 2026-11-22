import { el, clearElement, setText } from '../lib/dom.js';
import {
  createButton,
  createCheckbox,
  createDatePicker,
  createIconButton,
} from '../lib/ui/index.js';
import {
  createCompactTopRow,
  createStaticWidgetIcon,
  createSummaryExtra,
  createSummaryScrollRegion,
} from './summary-helpers.js';

function isValidDateString(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ts = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ts) && new Date(ts).toISOString().slice(0, 10) === value;
}

export function mount(root, context) {
  clearElement(root);
  root.className = 'ios-widget widget-todo';

  let config = {
    hideCompleted: Boolean(context.config?.hideCompleted),
  };
  let todos = Array.isArray(context.getTodos?.()) ? structuredClone(context.getTodos()) : [];
  let rowCheckboxInstances = [];

  const titleSpan = el('span', { className: 'todo-widget-title', textContent: '待办清单' });
  const countBadge = el('span', { className: 'widget-count-pill', textContent: '0' });
  const hideToggleBtn = createButton({
    label: config.hideCompleted ? '显示已完成' : '隐藏已完成',
    size: 'sm',
  });
  const syncStatusSpan = el('span', { className: 'widget-sync-hint', textContent: '' });

  const header = el(
    'div',
    { className: 'todo-widget-header' },
    el('div', { className: 'todo-title-group' }, titleSpan, countBadge),
    el('div', { className: 'todo-meta-group' }, syncStatusSpan, hideToggleBtn)
  );

  const form = el('form', { className: 'todo-add-form' });
  const textInput = el('input', {
    type: 'text',
    className: 'todo-text-input',
    placeholder: '添加待办事项…',
    maxlength: 500,
    'aria-label': '待办事项内容',
  });
  const dueDatePicker = createDatePicker({
    placeholder: '截止日(可选)',
    allowEmpty: true,
    compact: true,
    ariaLabel: '截止日期（可选）',
    getTodayParts: () => context.clock.getSnapshot().parts,
  });
  dueDatePicker.root.classList.add('todo-date-picker');

  const addBtn = createButton({
    label: '添加',
    variant: 'accent',
    size: 'sm',
    type: 'submit',
    ariaLabel: '添加待办',
  });
  form.append(textInput, dueDatePicker.root, addBtn);

  const errorBanner = el('div', { className: 'widget-error-inline', hidden: true });
  const listContainer = el('div', { className: 'todo-list-container', role: 'list' });

  const inner = el('div', { className: 'widget-inner' }, header, form, errorBanner, listContainer);
  const { topRow: compactTopRow } = createCompactTopRow({
    kickerText: '待办清单',
    iconNode: createStaticWidgetIcon('todo'),
    accentClass: 'is-todo',
  });
  const compactPrimary = el('div', { className: 'widget-compact-primary', textContent: '0 待办' });
  const compactTodoFill = el('div', { className: 'compact-todo-fill' });
  compactTodoFill.style.width = '0%';
  const compactTodoTrack = el('div', { className: 'compact-todo-track', 'aria-hidden': 'true' }, compactTodoFill);
  const compactSecondary = el('div', { className: 'widget-compact-secondary', textContent: '点击查看或添加待办' });
  const summaryTodoStats = el('div', { className: 'summary-todo-stats', textContent: '' });
  const summaryTodoScroll = createSummaryScrollRegion({
    ariaLabel: '待办清单事项预览',
    extraClass: 'summary-todo-scroll',
  });
  const summaryExtra = createSummaryExtra(
    'summary-extra-todo',
    summaryTodoStats,
    summaryTodoScroll
  );
  const compactSummary = el(
    'div',
    { className: 'widget-compact-summary compact-layout-todo' },
    compactTopRow,
    compactPrimary,
    compactTodoTrack,
    compactSecondary,
    summaryExtra
  );
  const label = el('span', { className: 'widget-label', textContent: '待办清单' });
  root.append(inner, compactSummary, label);

  function showInlineError(msg) {
    if (!msg) {
      errorBanner.hidden = true;
      setText(errorBanner, '');
      return;
    }
    setText(errorBanner, msg);
    errorBanner.hidden = false;
  }

  function clearRowCheckboxes() {
    for (const inst of rowCheckboxInstances) {
      inst.destroy();
    }
    rowCheckboxInstances = [];
  }

  function renderList() {
    clearRowCheckboxes();
    clearElement(listContainer);
    const remainingItems = todos.filter(item => !item.completed);
    const remainingCount = remainingItems.length;
    const completedCount = todos.length - remainingCount;
    const completedPct = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0;
    compactTodoFill.style.width = `${completedPct}%`;
    setText(countBadge, `${remainingCount}/${todos.length}`);
    setText(hideToggleBtn, config.hideCompleted ? '显示已完成' : '隐藏已完成');
    setText(
      compactPrimary,
      todos.length === 0 ? '暂无待办' : `待完成 ${remainingCount}/${todos.length}`
    );
    const firstItem = remainingItems[0] || todos[0];
    setText(
      compactSecondary,
      firstItem ? firstItem.text.slice(0, 28) : '点击添加新的待办事项'
    );

    setText(
      summaryTodoStats,
      todos.length === 0
        ? '今日暂无待办事项'
        : `完成度 ${completedPct}% · 待办 ${remainingCount} 项 · 已完成 ${completedCount} 项`
    );
    clearElement(summaryTodoScroll);
    const previewList = [
      ...remainingItems,
      ...todos.filter(item => item.completed),
    ].slice(0, 10);
    if (previewList.length === 0) {
      summaryTodoScroll.appendChild(
        el('div', {
          className: 'summary-todo-empty',
          textContent: '暂无待办事项，点击卡片添加新计划',
        })
      );
    } else {
      for (const item of previewList) {
        const markEl = el('span', {
          className: `summary-todo-bullet ${item.completed ? 'is-done' : ''}`.trim(),
          'aria-hidden': 'true',
          textContent: item.completed ? '✓' : '○',
        });
        const textEl = el('span', {
          className: `summary-todo-text ${item.completed ? 'is-done' : ''}`.trim(),
          textContent: item.text,
        });
        const dueEl = item.dueDate
          ? el('span', {
              className: 'summary-todo-due',
              textContent: item.dueDate,
            })
          : null;
        summaryTodoScroll.appendChild(
          el(
            'div',
            {
              className: `summary-todo-item ${item.completed ? 'is-completed' : ''}`.trim(),
            },
            markEl,
            textEl,
            dueEl
          )
        );
      }
    }

    const visibleTodos = config.hideCompleted
      ? todos.filter(item => !item.completed)
      : todos;

    if (visibleTodos.length === 0) {
      listContainer.appendChild(
        el('div', {
          className: 'todo-empty-hint',
          textContent: todos.length === 0 ? '暂无待办事项，上方输入即可添加' : '已完成事项已隐藏',
        })
      );
      return;
    }

    for (const item of visibleTodos) {
      const cb = createCheckbox({
        checked: Boolean(item.completed),
        ariaLabel: `完成状态：${item.text}`,
        onChange: (checked) => {
          toggleTodo(item.id, checked);
        },
      });
      rowCheckboxInstances.push(cb);

      const textNode = el('span', {
        className: `todo-item-text ${item.completed ? 'is-completed' : ''}`,
        textContent: item.text,
      });

      const dueNode = item.dueDate
        ? el('span', { className: 'todo-due-badge', textContent: item.dueDate })
        : null;

      const deleteBtn = createIconButton({
        iconText: '×',
        variant: 'danger',
        title: '删除此待办',
        ariaLabel: `删除待办：${item.text}`,
        onClick: (e) => {
          e.stopPropagation();
          removeTodo(item.id);
        },
      });

      const row = el(
        'div',
        { className: 'todo-item-row', role: 'listitem', dataset: { id: item.id } },
        cb.root,
        el('div', { className: 'todo-item-main' }, textNode, dueNode),
        deleteBtn
      );
      listContainer.appendChild(row);
    }
  }

  function persistTodos(nextTodos) {
    todos = nextTodos;
    renderList();
    context.saveTodos?.(structuredClone(todos));
  }

  function toggleTodo(id, completed) {
    const next = todos.map(item => (item.id === id ? { ...item, completed: Boolean(completed) } : item));
    persistTodos(next);
  }

  function removeTodo(id) {
    const next = todos.filter(item => item.id !== id);
    persistTodos(next);
  }

  const onSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = textInput.value.trim();
    if (!text) return;
    if (todos.length >= 200) {
      showInlineError('最多允许保存 200 条待办');
      return;
    }
    const rawDue = dueDatePicker.getValue();
    if (rawDue && !isValidDateString(rawDue)) {
      showInlineError('截止日期格式不正确，请使用 YYYY-MM-DD');
      return;
    }
    showInlineError('');
    const newTodo = {
      id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: text.slice(0, 500),
      completed: false,
      dueDate: rawDue || null,
    };
    textInput.value = '';
    dueDatePicker.setValue('');
    persistTodos([newTodo, ...todos]);
  };

  const onToggleHide = (e) => {
    e.stopPropagation();
    config = { hideCompleted: !config.hideCompleted };
    renderList();
    context.saveWidgetConfig?.(config);
  };

  form.addEventListener('submit', onSubmit);
  hideToggleBtn.addEventListener('click', onToggleHide);

  renderList();

  return {
    update(data = {}) {
      if (data.config && typeof data.config.hideCompleted === 'boolean') {
        config = { hideCompleted: data.config.hideCompleted };
      }
      if (Array.isArray(data.todos)) {
        todos = structuredClone(data.todos);
      }
      if (data.widgetSyncStatus) {
        setText(syncStatusSpan, data.widgetSyncStatus.shortLabel || '');
        if (data.widgetSyncStatus.error) {
          showInlineError(data.widgetSyncStatus.error);
        } else {
          showInlineError('');
        }
      }
      renderList();
    },
    destroy() {
      clearRowCheckboxes();
      dueDatePicker.destroy();
      form.removeEventListener('submit', onSubmit);
      hideToggleBtn.removeEventListener('click', onToggleHide);
      clearElement(root);
    },
  };
}
