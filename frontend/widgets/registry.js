import { el, clearElement } from '../lib/dom.js';
import * as clockWeatherWidget from './clock-weather.js';
import * as focusTimerWidget from './focus-timer.js';
import * as quickNoteWidget from './quick-note.js';
import * as todoWidget from './todo.js';
import * as calendarWidget from './calendar.js';
import * as worldClockWidget from './world-clock.js';

// Fixed, reviewed local module map. Never construct dynamic imports from user input.
export const WIDGET_MODULE_MAP = new Map([
  ['clock-weather', clockWeatherWidget],
  ['focus-timer', focusTimerWidget],
  ['quick-note', quickNoteWidget],
  ['todo', todoWidget],
  ['calendar', calendarWidget],
  ['world-clock', worldClockWidget],
]);

export function createWidgetHost(contextFactory) {
  let legacyContainerEl = null;
  const mountedInstances = new Map(); // id -> { id, type, root, container, instance, item, afterMount }

  function destroyWidget(widgetId) {
    const entry = mountedInstances.get(widgetId);
    if (!entry) return;
    try {
      entry.instance?.destroy?.();
    } catch {
      // Ignore widget teardown error
    }
    try {
      entry.root?.remove?.();
    } catch {
      // Ignore DOM removal error
    }
    mountedInstances.delete(widgetId);
  }

  function pruneUnmounted(activeWidgetIds = new Set()) {
    const keepSet = activeWidgetIds instanceof Set ? activeWidgetIds : new Set(activeWidgetIds);
    for (const id of Array.from(mountedInstances.keys())) {
      if (!keepSet.has(id)) {
        destroyWidget(id);
      }
    }
  }

  function destroyAll() {
    for (const id of Array.from(mountedInstances.keys())) {
      destroyWidget(id);
    }
    mountedInstances.clear();
    if (legacyContainerEl) {
      clearElement(legacyContainerEl);
      legacyContainerEl = null;
    }
  }

  function mountWidget(container, item, { afterMount, reuseExisting = true } = {}) {
    if (!container || !item || !item.enabled || !WIDGET_MODULE_MAP.has(item.type)) {
      return null;
    }

    // Reuse existing mounted widget DOM & instance on pure reorder / cross-page move
    if (reuseExisting && mountedInstances.has(item.id)) {
      const prev = mountedInstances.get(item.id);
      if (
        prev &&
        prev.type === item.type &&
        prev.root &&
        prev.root.ownerDocument === container.ownerDocument
      ) {
        container.appendChild(prev.root);
        prev.container = container;
        prev.item = item;
        prev.afterMount = afterMount;
        if (typeof afterMount === 'function') {
          afterMount(prev.root, item);
        }
        return prev.root;
      }
      destroyWidget(item.id);
    } else if (mountedInstances.has(item.id)) {
      destroyWidget(item.id);
    }

    const mod = WIDGET_MODULE_MAP.get(item.type);
    if (!mod || typeof mod.mount !== 'function') return null;

    const root = el('article', {
      className: `ios-widget widget-${item.type}`,
      dataset: { widgetId: item.id, widgetType: item.type },
    });
    container.appendChild(root);

    function mountIntoRoot() {
      const widgetContext = contextFactory(item);
      try {
        const instance = mod.mount(root, widgetContext);
        root.dataset.widgetId = item.id;
        root.dataset.widgetType = item.type;
        if (typeof afterMount === 'function') {
          afterMount(root, item);
        }
        mountedInstances.set(item.id, {
          id: item.id,
          type: item.type,
          root,
          container,
          instance,
          item,
          afterMount,
        });
      } catch (err) {
        console.error(`[Widget Mount Error: ${item.type}]`, err);
        clearElement(root);
        root.className = `ios-widget widget-${item.type}`;
        root.dataset.widgetId = item.id;
        root.dataset.widgetType = item.type;
        const retryBtn = el('button', {
          type: 'button',
          className: 'widget-inline-btn',
          textContent: '重试组件',
        });
        retryBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          destroyWidget(item.id);
          mountIntoRoot();
        });
        const fallbackInner = el(
          'div',
          { className: 'widget-inner widget-error-fallback' },
          el('div', { className: 'widget-error-title', textContent: `组件暂不可用 (${item.type})` }),
          el('div', {
            className: 'widget-error-desc',
            textContent: err?.message ? String(err.message) : '组件初始化异常，其他功能不受影响',
          }),
          retryBtn
        );
        root.append(
          fallbackInner,
          el('span', { className: 'widget-label', textContent: String(item.type) })
        );
        if (typeof afterMount === 'function') {
          afterMount(root, item);
        }
        mountedInstances.set(item.id, {
          id: item.id,
          type: item.type,
          root,
          container,
          instance: null,
          item,
          afterMount,
        });
      }
    }

    mountIntoRoot();
    return root;
  }

  function renderLayout(container, layout = [], options = {}) {
    destroyAll();
    legacyContainerEl = container || null;
    if (!legacyContainerEl) return;

    const enabledWidgets = (Array.isArray(layout) ? layout : [])
      .filter(item => item && item.enabled && WIDGET_MODULE_MAP.has(item.type))
      .slice()
      .sort((a, b) => Number(a.order) - Number(b.order));

    if (enabledWidgets.length === 0) {
      legacyContainerEl.classList.add('widgets-bento-empty');
      return;
    }

    legacyContainerEl.classList.remove('widgets-bento-empty');
    for (const item of enabledWidgets) {
      mountWidget(legacyContainerEl, item, options);
    }
  }

  function updateAll(data = {}) {
    for (const [id, entry] of mountedInstances.entries()) {
      const layoutItem = Array.isArray(data.layout)
        ? data.layout.find(w => w.id === id)
        : null;
      try {
        entry.instance?.update?.({
          ...data,
          ...(layoutItem ? { config: layoutItem.config } : {}),
        });
      } catch {
        // Ignore individual widget update error
      }
    }
  }

  return {
    mountWidget,
    destroyWidget,
    pruneUnmounted,
    renderLayout,
    updateAll,
    destroyAll,
    getMountedCount: () => mountedInstances.size,
    getMountedIds: () => Array.from(mountedInstances.keys()),
  };
}
