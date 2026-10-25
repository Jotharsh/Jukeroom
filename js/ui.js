// Tiny helpers so every screen is plain DOM, with no framework and no build step.
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list' && key !== 'form') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function toast(message, ms = 2800) {
  const host = document.getElementById('toasts');
  const node = h('div', { class: 'toast' }, message);
  host.append(node);
  setTimeout(() => node.remove(), ms);
}

export function openDialog(content) {
  return new Promise((resolve) => {
    const dialog = h('dialog', {}, content(resolve));
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue || null); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** A yes/no question. Resolves true only if the user chose the main button. */
export async function confirmDialog({ title, message = '', confirmText = 'Yes', cancelText = 'Cancel', danger = false }) {
  const result = await openDialog(() => [
    h('h2', {}, title),
    message && h('p', {}, message),
    h('div', { class: 'actions' },
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: (e) => e.target.closest('dialog').close('yes') }, confirmText),
      h('button', { class: 'btn', onclick: (e) => e.target.closest('dialog').close('no'), autofocus: true }, cancelText)),
  ]);
  return result === 'yes';
}

/** A list of big buttons. Resolves with the chosen action's id, or null if dismissed. */
export function sheet({ title, message = '', actions }) {
  return openDialog(() => [
    h('h2', {}, title),
    message && h('p', { class: 'muted' }, message),
    h('div', { class: 'actions' },
      actions.map((a) => h('button', { class: `btn ${a.danger ? 'danger' : a.primary ? 'primary' : ''}${a.selected ? ' selected' : ''}`, onclick: (e) => e.target.closest('dialog').close(a.id), disabled: a.disabled },
        a.label, a.detail && h('span', { class: 'detail' }, a.detail))),
      h('button', { class: 'btn ghost', onclick: (e) => e.target.closest('dialog').close('') }, 'Close')),
  ]);
}

/** Asks for some text. Resolves with the text, or null if cancelled. `validate` returns an error message or ''. */
export function promptDialog({ title, message = '', label, value = '', placeholder = '', confirmText = 'Save', validate }) {
  return openDialog(() => {
    const input = h('input', { type: 'text', value, placeholder, 'aria-label': label, autocomplete: 'off', autofocus: true });
    const error = h('p', { class: 'error', role: 'alert' });
    const submit = (e) => {
      e.preventDefault();
      const problem = validate?.(input.value) ?? '';
      if (problem) { error.textContent = problem; input.focus(); return; }
      e.target.closest('dialog').close(`ok:${input.value}`);
    };
    return h('form', { onsubmit: submit },
      h('h2', {}, title), message && h('p', { class: 'muted' }, message),
      h('label', { class: 'field' }, h('span', {}, label), input), error,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'submit' }, confirmText),
        h('button', { class: 'btn', type: 'button', onclick: (e) => e.target.closest('dialog').close('') }, 'Cancel')));
  }).then((r) => (r && r.startsWith('ok:') ? r.slice(3) : null));
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  dots: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  play: '<path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" fill="currentColor"/>',
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor"/><rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor"/>',
  next: '<path d="M6 5.4v13.2a.5.5 0 0 0 .8.4l8.6-6.6a.5.5 0 0 0 0-.8L6.8 5a.5.5 0 0 0-.8.4z" fill="currentColor"/><path d="M18.5 5v14"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  users: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3.2 3.2 0 0 1 0 5.6M18.5 19a5.5 5.5 0 0 0-2.6-4.7"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  volume: '<path d="M4.5 9.5h3l4.5-3.8v12.6L7.5 14.5h-3z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4.5 9.5h3l4.5-3.8v12.6L7.5 14.5h-3z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7"/>',
  music: '<path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
};


/** A small line icon. The shapes above are fixed text written in this file, never user input. */
export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}
export const backLabel = (text) => [icon('back', 20), text];

/** The Jukeroom mark: a record with a needle. Fixed markup, never user input. */
export function logo(size = 28) {
  const span = document.createElement('span');
  span.className = 'logo';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none"><circle cx="30" cy="34" r="22" stroke="currentColor" stroke-width="2.5"/><circle cx="30" cy="34" r="14" stroke="currentColor" stroke-width="1.5" opacity=".45"/><circle cx="30" cy="34" r="5" fill="var(--cyan)"/><path d="M52 6l-9 17" stroke="var(--cyan)" stroke-width="3.5" stroke-linecap="round"/></svg>`;
  return span;
}
