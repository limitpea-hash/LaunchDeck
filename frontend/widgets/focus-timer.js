import { el, clearElement, setText } from '../lib/dom.js';

export function mount(root, context) {
  clearElement(root);
  root.className = 'ios-widget widget-focus-timer';

  let config = {
    workMinutes: Math.min(180, Math.max(1, Number(context.config?.workMinutes) || 25)),
    breakMinutes: Math.min(60, Math.max(1, Number(context.config?.breakMinutes) || 5)),
  };

  let phase = 'work'; // 'work' | 'break'
  let running = false;
  let totalSeconds = config.workMinutes * 60;
  let remainingSeconds = totalSeconds;
  let intervalId = null;

  const focusDot = el('span', { className: 'focus-dot' });
  const phaseTitle = el('span', { className: 'focus-title', textContent: '专注番茄钟' });
  const resetBtn = el('button', {
    type: 'button',
    className: 'focus-reset-btn',
    textContent: '重置',
    'aria-label': '重置专注计时器',
  });

  const topRow = el(
    'div',
    { className: 'focus-top-row' },
    el('div', { className: 'focus-badge-group' }, focusDot, phaseTitle),
    resetBtn
  );

  const readout = el('div', { className: 'timer-readout', textContent: '25:00' });
  const playBtn = el('button', {
    type: 'button',
    className: 'timer-play-btn',
    'aria-label': '开始或暂停计时',
    textContent: '▶',
  });

  const mainRow = el('div', { className: 'focus-main-row' }, readout, playBtn);

  const progressBar = el('div', { className: 'focus-progress-bar' });
  progressBar.style.width = '0%';
  const progressTrack = el('div', { className: 'focus-progress-track' }, progressBar);

  const workModeBtn = el('button', {
    type: 'button',
    className: 'preset-chip active',
    textContent: `专注 ${config.workMinutes}m`,
  });
  const breakModeBtn = el('button', {
    type: 'button',
    className: 'preset-chip',
    textContent: `休息 ${config.breakMinutes}m`,
  });
  const customCfgBtn = el('button', {
    type: 'button',
    className: 'preset-chip',
    textContent: '时长设置',
  });

  const presetsRow = el('div', { className: 'focus-presets' }, workModeBtn, breakModeBtn, customCfgBtn);

  const configForm = el('div', { className: 'focus-inline-config', hidden: true });
  const workInput = el('input', {
    type: 'number',
    className: 'widget-mini-input',
    min: 1,
    max: 180,
    value: config.workMinutes,
    'aria-label': '专注时长（分钟）',
  });
  const breakInput = el('input', {
    type: 'number',
    className: 'widget-mini-input',
    min: 1,
    max: 60,
    value: config.breakMinutes,
    'aria-label': '休息时长（分钟）',
  });
  const saveCfgBtn = el('button', {
    type: 'button',
    className: 'widget-inline-btn',
    textContent: '保存',
  });
  configForm.append(
    el('label', { className: 'focus-cfg-field' }, '专注', workInput, '分'),
    el('label', { className: 'focus-cfg-field' }, '休息', breakInput, '分'),
    saveCfgBtn
  );

  const inner = el('div', { className: 'widget-inner' }, topRow, mainRow, progressTrack, presetsRow, configForm);
  const compactPrimary = el('div', { className: 'widget-compact-primary', textContent: '25:00' });
  const compactSecondary = el('div', { className: 'widget-compact-secondary', textContent: '专注番茄钟 · 待机' });
  const compactSummary = el(
    'div',
    { className: 'widget-compact-summary' },
    el(
      'div',
      { className: 'widget-compact-top' },
      el('span', { className: 'widget-compact-kicker', textContent: '专注计时' }),
      el('span', { className: 'widget-compact-badge', textContent: '详情 ↗' })
    ),
    compactPrimary,
    compactSecondary
  );
  const label = el('span', { className: 'widget-label', textContent: '专注计时' });
  root.append(inner, compactSummary, label);

  function stopInterval() {
    running = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    setText(playBtn, '▶');
    renderReadout();
  }

  function renderReadout() {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    setText(readout, formatted);
    const elapsed = Math.max(0, totalSeconds - remainingSeconds);
    const pct = totalSeconds > 0 ? Math.min(100, (elapsed / totalSeconds) * 100) : 0;
    progressBar.style.width = `${pct.toFixed(1)}%`;
    setText(phaseTitle, phase === 'work' ? '专注番茄钟' : '小憩恢复时段');
    setText(workModeBtn, `专注 ${config.workMinutes}m`);
    setText(breakModeBtn, `休息 ${config.breakMinutes}m`);
    workModeBtn.classList.toggle('active', phase === 'work');
    breakModeBtn.classList.toggle('active', phase === 'break');
    setText(compactPrimary, formatted);
    setText(
      compactSecondary,
      `${phase === 'work' ? '专注' : '休息'} · ${running ? '计时进行中' : '点击操作'}`
    );
  }

  const onTogglePlay = (e) => {
    e.stopPropagation();
    if (running) {
      stopInterval();
      return;
    }
    running = true;
    setText(playBtn, '❚❚');
    renderReadout();
    intervalId = setInterval(() => {
      if (remainingSeconds > 0) {
        remainingSeconds -= 1;
        renderReadout();
      } else {
        stopInterval();
        phase = phase === 'work' ? 'break' : 'work';
        totalSeconds = (phase === 'work' ? config.workMinutes : config.breakMinutes) * 60;
        remainingSeconds = totalSeconds;
        renderReadout();
      }
    }, 1000);
  };

  const onReset = (e) => {
    e.stopPropagation();
    stopInterval();
    totalSeconds = (phase === 'work' ? config.workMinutes : config.breakMinutes) * 60;
    remainingSeconds = totalSeconds;
    renderReadout();
  };

  const onSelectWork = (e) => {
    e.stopPropagation();
    stopInterval();
    phase = 'work';
    totalSeconds = config.workMinutes * 60;
    remainingSeconds = totalSeconds;
    renderReadout();
  };

  const onSelectBreak = (e) => {
    e.stopPropagation();
    stopInterval();
    phase = 'break';
    totalSeconds = config.breakMinutes * 60;
    remainingSeconds = totalSeconds;
    renderReadout();
  };

  const onToggleCfg = (e) => {
    e.stopPropagation();
    configForm.hidden = !configForm.hidden;
  };

  const onSaveCfg = (e) => {
    e.stopPropagation();
    const nextWork = Math.min(180, Math.max(1, Math.round(Number(workInput.value) || 25)));
    const nextBreak = Math.min(60, Math.max(1, Math.round(Number(breakInput.value) || 5)));
    config = { workMinutes: nextWork, breakMinutes: nextBreak };
    workInput.value = String(nextWork);
    breakInput.value = String(nextBreak);
    if (!running) {
      totalSeconds = (phase === 'work' ? config.workMinutes : config.breakMinutes) * 60;
      remainingSeconds = totalSeconds;
    }
    configForm.hidden = true;
    renderReadout();
    context.saveWidgetConfig?.(config);
  };

  playBtn.addEventListener('click', onTogglePlay);
  resetBtn.addEventListener('click', onReset);
  workModeBtn.addEventListener('click', onSelectWork);
  breakModeBtn.addEventListener('click', onSelectBreak);
  customCfgBtn.addEventListener('click', onToggleCfg);
  saveCfgBtn.addEventListener('click', onSaveCfg);

  renderReadout();

  return {
    update(data = {}) {
      if (data.config) {
        const nextWork = Math.min(180, Math.max(1, Math.round(Number(data.config.workMinutes) || config.workMinutes)));
        const nextBreak = Math.min(60, Math.max(1, Math.round(Number(data.config.breakMinutes) || config.breakMinutes)));
        const changed = nextWork !== config.workMinutes || nextBreak !== config.breakMinutes;
        config = { workMinutes: nextWork, breakMinutes: nextBreak };
        workInput.value = String(nextWork);
        breakInput.value = String(nextBreak);
        if (changed && !running) {
          totalSeconds = (phase === 'work' ? config.workMinutes : config.breakMinutes) * 60;
          remainingSeconds = totalSeconds;
        }
        renderReadout();
      }
    },
    destroy() {
      stopInterval();
      playBtn.removeEventListener('click', onTogglePlay);
      resetBtn.removeEventListener('click', onReset);
      workModeBtn.removeEventListener('click', onSelectWork);
      breakModeBtn.removeEventListener('click', onSelectBreak);
      customCfgBtn.removeEventListener('click', onToggleCfg);
      saveCfgBtn.removeEventListener('click', onSaveCfg);
      clearElement(root);
    },
  };
}
