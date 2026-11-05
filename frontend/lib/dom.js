const SAFE_HEX_RE = /^#[0-9a-f]{6}$/i;
const SAFE_GRADIENT_RE = /^linear-gradient\(\s*\d{1,3}deg\s*,\s*#[0-9a-f]{6}\s+\d{1,3}%\s*,\s*#[0-9a-f]{6}\s+\d{1,3}%(?:\s*,\s*#[0-9a-f]{6}\s+\d{1,3}%)?\s*\)$/i;
const SAFE_ID_RE = /^[a-z0-9_-]{1,80}$/i;

export function clearElement(node) {
  if (!node) return;
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function setText(node, value) {
  if (!node) return;
  node.textContent = value === null || value === undefined ? '' : String(value);
}

export function el(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs && typeof attrs === 'object') {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'className') {
        node.className = String(value);
      } else if (key === 'textContent') {
        node.textContent = String(value);
      } else if (key === 'hidden') {
        node.hidden = Boolean(value);
      } else if (key === 'disabled') {
        node.disabled = Boolean(value);
      } else if (key === 'checked') {
        node.checked = Boolean(value);
      } else if (key === 'value') {
        node.value = String(value);
      } else if (key === 'dataset' && typeof value === 'object') {
        for (const [dKey, dVal] of Object.entries(value)) {
          if (dVal !== undefined && dVal !== null) {
            node.dataset[dKey] = String(dVal);
          }
        }
      } else if (key.startsWith('aria-') || key === 'role' || key === 'type' || key === 'id' || key === 'title' || key === 'placeholder' || key === 'for' || key === 'name' || key === 'maxlength' || key === 'min' || key === 'max' || key === 'step' || key === 'autocomplete' || key === 'spellcheck') {
        node.setAttribute(key, value === true ? '' : String(value));
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

export function safeHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function safeHexColor(value, fallback = '#007aff') {
  return typeof value === 'string' && SAFE_HEX_RE.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

export function safeGradient(value, fallback = 'linear-gradient(180deg, #007aff 0%, #1c1c1e 140%)') {
  return typeof value === 'string' && SAFE_GRADIENT_RE.test(value.trim())
    ? value.trim()
    : fallback;
}

export function isSafeIdentifier(value) {
  return typeof value === 'string' && SAFE_ID_RE.test(value);
}
