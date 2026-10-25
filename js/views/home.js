import { h, icon, logo, openDialog, confirmDialog } from '../ui.js';
import { installMode, promptInstall, dismissInstall, onInstallChange } from '../install.js';
import { newCode, normaliseCode, cleanText } from '../room.js';
import { CODE_LENGTH, MAX_NICK, MAX_ROOM_NAME } from '../config.js';
import * as store from '../store.js';

function installBox() {
  const box = h('div');
  const draw = () => {
    box.replaceChildren();
    const mode = installMode();
    if (!mode) return;
    const text = {
      prompt: 'Install Jukeroom on this device so it opens like any other app.',
      ios: 'To install: tap the Share button (the square with an arrow), then "Add to Home Screen".',
      mac: 'To install: in Safari, choose File, then "Add to Dock".',
    }[mode];
    box.append(h('div', { class: 'installbox', role: 'note' }, h('p', {}, text),
      h('div', { class: 'row' },
        mode === 'prompt' && h('button', { class: 'btn primary', onclick: promptInstall }, 'Install'),
        h('button', { class: 'btn ghost', onclick: dismissInstall, 'aria-label': 'Not now, hide the install message' }, 'Not now'))));
  };
  draw();
  return { node: box, stop: onInstallChange(draw) };
}

/** The "start a room" form. Resolves to the room details, or null if dismissed. */
function startDialog() {
  return openDialog(() => {
    const nick = h('input', { type: 'text', value: store.nick.get() || '', placeholder: 'Your name', maxLength: MAX_NICK, autocomplete: 'nickname', 'aria-label': 'Your name', required: true });
    const name = h('input', { type: 'text', placeholder: 'Friday night, Study hall…', maxLength: MAX_ROOM_NAME, autocomplete: 'off', 'aria-label': 'Room name' });
    const pw = h('input', { type: 'text', placeholder: 'Leave empty for an open room', maxLength: 64, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Password' });
    const control = h('input', { type: 'checkbox', checked: true, role: 'switch' });
    return h('form', { onsubmit: (e) => {
      e.preventDefault();
      const who = cleanText(nick.value, MAX_NICK);
      if (!who) { nick.focus(); return; }
      e.target.closest('dialog').close(JSON.stringify({ nick: who, name: cleanText(name.value, MAX_ROOM_NAME, `${who}'s room`), password: pw.value, guestsControl: control.checked }));
    } },
      h('h2', {}, 'Start a room'),
      h('p', { class: 'muted' }, 'You are the host. The room stays open for as long as this page does.'),
      h('label', { class: 'field' }, h('span', {}, 'Your name'), nick),
      h('label', { class: 'field' }, h('span', {}, 'Room name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Password (optional)'), pw),
      h('label', { class: 'switch' }, control, h('i', {}), h('span', {}, 'Guests can play, pause and skip')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'submit' }, 'Open the room'),
        h('button', { class: 'btn ghost', type: 'button', onclick: (e) => e.target.closest('dialog').close('') }, 'Cancel')));
  }).then((r) => (r ? JSON.parse(r) : null));
}

export async function home(screen, _args, { go }) {
  const install = installBox();
  const hosting = store.hostRecord.get();
  const codeInput = h('input', { class: 'code-input', type: 'text', inputMode: 'text', placeholder: 'ROOM CODE', maxLength: 9, autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, 'aria-label': 'Room code', oninput: (e) => { e.target.value = normaliseCode(e.target.value); } });
  const joinError = h('p', { class: 'error', role: 'alert' });

  const start = async () => {
    if (hosting && !(await confirmDialog({ title: 'Replace your open room?', message: `You are already hosting ${hosting.code}. Starting a new room ends the old one.`, confirmText: 'Start a new room', danger: true }))) return;
    const details = await startDialog();
    if (!details) return;
    store.nick.set(details.nick);
    store.hostRecord.set({ code: newCode(), name: details.name, password: details.password, guestsControl: details.guestsControl, nick: details.nick, queue: [], nextQid: 1, fresh: true });
    go(`/r/${store.hostRecord.get().code}`);
  };

  const recents = store.recent.list();
  screen.replaceChildren(...[
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, logo(26), 'Jukeroom'), h('a', { class: 'toplink', href: '#/help' }, 'How it works')),
    h('section', { class: 'hero' },
      h('div', { class: 'hero-text' },
        h('p', { class: 'eyebrow' }, h('i', { class: 'led live' }), 'Listen together'),
        h('h1', {}, 'Your room.', h('br'), h('span', {}, 'Your set.')),
        h('p', { class: 'lead' }, 'Start a room, share the code, and drop in songs from YouTube. Everyone hears the same moment, on a phone or a laptop. No account, no cost.')),
      h('div', { class: 'hero-deck', 'aria-hidden': 'true' }, h('div', { class: 'platter spin loaded' }, h('div', { class: 'vinyl' }, h('div', { class: 'label' }), h('i', { class: 'spindle' })), h('div', { class: 'arm' }, h('i'))))),
    install.node,
    hosting && h('div', { class: 'resume' },
      h('div', {}, h('span', { class: 'eyebrow' }, 'Your open room'), h('b', {}, hosting.name), h('small', {}, hosting.code)),
      h('a', { class: 'btn primary', href: `#/r/${hosting.code}` }, 'Resume')),
    h('div', { class: 'console' },
      h('div', { class: 'module' },
        h('p', { class: 'eyebrow' }, 'Host'),
        h('button', { class: 'btn primary big', onclick: start }, icon('music', 20), 'Start a room'),
        h('p', { class: 'muted small' }, 'Optional password. You choose who can control playback.')),
      h('form', { class: 'module', onsubmit: (e) => {
        e.preventDefault();
        const code = normaliseCode(codeInput.value);
        if (code.length !== CODE_LENGTH) { joinError.textContent = `A room code has ${CODE_LENGTH} letters and numbers.`; codeInput.focus(); return; }
        go(`/r/${code}`);
      } },
        h('p', { class: 'eyebrow' }, 'Join'),
        h('div', { class: 'joinrow' }, codeInput, h('button', { class: 'btn big', type: 'submit' }, 'Join')),
        joinError)),
    recents.length > 0 && h('section', { class: 'recent' },
      h('h2', { class: 'eyebrow' }, 'Recent rooms'),
      h('ul', {}, recents.map((r) => h('li', {}, h('a', { href: `#/r/${r.code}` }, h('b', {}, r.name), h('small', {}, r.host ? `${r.code} · yours` : r.code), icon('back', 16)))))),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, 'Open a room.'), ' Name it, add a password if you like, and share the link or code.'),
      h('li', {}, h('b', {}, 'Add songs.'), ' Paste YouTube links. Anyone in the room can add to the queue.'),
      h('li', {}, h('b', {}, 'Listen in sync.'), ' Each device plays the song itself, kept in step with the host.')),
    h('footer', { class: 'foot' }, h('a', { href: '#/help' }, 'Help'), h('a', { href: '#/privacy' }, 'Privacy'), h('span', {}, 'Set in Space Grotesk and Share Tech Mono'), h('a', { href: 'https://github.com/Jotharsh/Jukeroom', rel: 'noopener' }, 'Source'))].filter(Boolean));
  return () => install.stop();
}
