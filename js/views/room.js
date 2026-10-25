import { h, toast, icon, sheet, confirmDialog, plural } from '../ui.js';
import { HostSession, GuestSession, restore } from '../net.js';
import { createPlayer } from '../player.js';
import { expectedPosition, decide, SEEK_COOLDOWN } from '../sync.js';
import { parseVideoId, fetchInfo, thumbUrl, formatClock } from '../youtube.js';
import { normaliseCode, snapshot, newCode, cleanText } from '../room.js';
import * as store from '../store.js';
import { CODE_LENGTH, MAX_NICK } from '../config.js';

const REJECTIONS = {
  'no-control': 'The host has turned off playback controls for guests.',
  'queue-full': 'The queue is full.', 'too-many': 'You have 20 songs waiting already. Let a few play first.',
  'not-yours': 'You can only remove songs you added.', 'bad-video': 'That is not a valid video.',
  'nothing-playing': 'Nothing is playing yet.',
};
const JOIN_ERRORS = {
  notfound: 'No room has that code. Check it, and ask the host to keep Jukeroom open: a room only exists while the host\'s page is open.',
  password: 'That password is not right.',
  full: 'This room is full.',
  offline: 'Could not connect. Check your internet and try again.',
};

export async function roomScreen(screen, [rawCode], { go }) {
  const code = normaliseCode(rawCode);
  let cleanup = () => {};
  const result = () => () => cleanup();

  if (code.length !== CODE_LENGTH) {
    screen.append(h('div', { class: 'card center' }, h('h1', {}, 'That code looks wrong'), h('p', { class: 'muted' }, `Room codes have ${CODE_LENGTH} letters and numbers.`), h('a', { class: 'btn primary', href: '#/' }, 'Back to start')));
    return result();
  }

  const saved = store.hostRecord.get();
  if (saved?.code === code) await startHost(saved);
  else {
    const remembered = store.joined.get(code);
    if (remembered) await tryJoin(remembered.nick, remembered.password, true);
    else showJoin();
  }
  return result();

  // ---- joining as a guest ----------------------------------------------------------------------------------------
  function showJoin(message = '', needPassword = false) {
    const nick = h('input', { type: 'text', value: store.nick.get() || `Guest ${Math.floor(100 + Math.random() * 900)}`, maxLength: MAX_NICK, autocomplete: 'nickname', 'aria-label': 'Your name' });
    const pw = h('input', { type: 'password', placeholder: 'Room password', autocomplete: 'off', 'aria-label': 'Room password' });
    const note = h('p', { class: 'error', role: 'alert' }, message);
    const submit = h('button', { class: 'btn primary big', type: 'submit' }, 'Join the room');
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true; submit.textContent = 'Connecting…'; note.textContent = '';
      const problem = await tryJoin(cleanText(nick.value, MAX_NICK, 'Guest'), pw.value, false);
      if (problem) { submit.disabled = false; submit.textContent = 'Join the room'; note.textContent = problem.message; if (problem.reason === 'password') { pw.closest('label').hidden = false; pw.focus(); } }
    } },
      h('p', { class: 'eyebrow' }, 'You are joining'),
      h('div', { class: 'code-display' }, [...code].map((c) => h('span', {}, c))),
      h('label', { class: 'field' }, h('span', {}, 'Your name'), nick),
      h('label', { class: 'field', hidden: !needPassword }, h('span', {}, 'Password'), pw),
      note, submit,
      h('a', { class: 'btn ghost', href: '#/' }, 'Cancel'));
    screen.replaceChildren(h('header', { class: 'topbar' }, h('a', { class: 'iconbtn', href: '#/', 'aria-label': 'Back' }, icon('back')), h('span', { class: 'brand' }, 'Jukeroom')), form);
    if (needPassword) pw.focus();
    return form;
  }

  /** Returns null on success, or { reason, message } so the form can say what went wrong. */
  async function tryJoin(nick, password, silent) {
    if (silent) screen.replaceChildren(h('div', { class: 'card center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, 'Reconnecting to the room…')));
    const session = new GuestSession({ code, nick, password });
    try { await session.connect(); }
    catch (error) {
      session.close();
      const reason = error.reason ?? 'offline';
      if (reason === 'password' || reason === 'full' || reason === 'notfound' || reason === 'offline') store.joined.clear(code);
      const needPw = reason === 'password';
      const message = needPw && !password ? 'This room needs a password.' : JOIN_ERRORS[reason];
      if (silent) showJoin(reason === 'password' ? message : message, needPw);
      return { reason, message };
    }
    store.nick.set(nick);
    store.joined.set(code, { nick, password });
    store.recent.add({ code, name: session.state.name });
    mount(session);
    return null;
  }

  // ---- hosting ---------------------------------------------------------------------------------------------------
  async function startHost(record) {
    screen.replaceChildren(h('div', { class: 'card center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, 'Opening your room…')));
    const session = new HostSession(restore(record));
    try { await session.start({ retryFor: record.fresh ? 0 : 15000 }); }
    catch (error) {
      if (error.reason === 'taken' && record.fresh) { const next = { ...record, code: newCode() }; store.hostRecord.set(next); go(`/r/${next.code}`); return; }
      screen.replaceChildren(h('div', { class: 'card center' },
        h('h1', {}, error.reason === 'taken' ? 'This room is open somewhere else' : 'Could not open the room'),
        h('p', { class: 'muted' }, error.reason === 'taken' ? 'Close the other tab or device that is hosting it, then try again.' : 'Check your internet and try again.'),
        h('button', { class: 'btn primary', onclick: () => startHost(record) }, 'Try again'), h('a', { class: 'btn ghost', href: '#/' }, 'Back to start')));
      return;
    }
    store.hostRecord.set({ ...snapshot(session.room), fresh: false });
    store.recent.add({ code: record.code, name: record.name, host: true });
    mount(session);
  }

  // ---- the room itself -------------------------------------------------------------------------------------------
  function mount(session) {
    const isHost = session.isHost;
    let state = session.state;
    let player = null, playerFailed = false, tapNeeded = false, notPlayingSince = null, lastSeek = 0, lastKey = null, dragging = false, status = 'live', tab = 'queue', ended = false;
    const canControl = () => isHost || state.guestsControl;
    const off = [];

    const yt = h('div', { class: 'yt' });
    const veilText = h('div', { class: 'veil-text' });
    const veilBtn = h('button', { class: 'btn primary', hidden: true, onclick: () => { tapNeeded = false; player?.play(); } }, 'Tap to listen');
    const veil = h('div', { class: 'veil' }, veilText, veilBtn);
    const label = h('div', { class: 'label' });
    const platter = h('div', { class: 'platter' }, h('div', { class: 'vinyl' }, label, h('i', { class: 'spindle' })), h('div', { class: 'arm' }, h('i')));
    const elapsed = h('span', { class: 'elapsed' }, '0:00'), remaining = h('small', {}, '-0:00');
    const titleEl = h('div', { class: 'lcd-title' }), subEl = h('div', { class: 'lcd-sub' });
    const syncLed = h('i', { class: 'led' }), syncText = h('span', {}, 'SYNC');
    const listenLed = h('i', { class: 'led on' }), listenText = h('span', {});
    const lcd = h('div', { class: 'lcd' },
      h('div', { class: 'lcd-time' }, elapsed, remaining), titleEl, subEl,
      h('div', { class: 'status' }, h('span', { class: 'chip' }, syncLed, syncText), h('span', { class: 'chip' }, listenLed, listenText)));

    const canvas = h('canvas', { class: 'wave-canvas', 'aria-hidden': 'true' });
    const wave = h('div', { class: 'wave', role: 'slider', tabindex: 0, 'aria-label': 'Position in the song', 'aria-valuemin': 0, 'aria-valuemax': 100 }, canvas);

    const playBtn = h('button', { class: 'pad play', 'aria-label': 'Play or pause', onclick: () => { const pb = state.playback; if (!pb.item) return; session.request({ type: pb.playing ? 'pause' : 'play' }); } });
    const nextBtn = h('button', { class: 'pad', 'aria-label': 'Next song', onclick: () => session.request({ type: 'next' }) }, icon('next', 22), h('span', {}, 'Next'));
    const knob = makeKnob(store.volume.get(), (v) => { player?.setVolume(v); store.volume.set(v); });

    const banner = h('div', { class: 'banner', hidden: true }, 'Reconnecting to the room…');
    const crateBody = h('div', { class: 'crate-body' });
    const tabQueue = h('button', { class: 'tab', onclick: () => setTab('queue') }), tabChannels = h('button', { class: 'tab', onclick: () => setTab('channels') });

    const input = h('input', { type: 'text', inputMode: 'url', placeholder: 'Paste a YouTube link', 'aria-label': 'YouTube link', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
    const addBtn = h('button', { class: 'btn primary', type: 'submit' }, icon('plus', 18), 'Add');
    const addForm = h('form', { class: 'add', onsubmit: async (e) => {
      e.preventDefault();
      const vid = parseVideoId(input.value);
      if (!vid) { toast('That does not look like a YouTube link.'); return; }
      addBtn.disabled = true;
      const info = await fetchInfo(vid);
      addBtn.disabled = false;
      if (!info.ok) { toast('YouTube does not allow that video to be played outside its own site. Try another.', 4200); return; }
      session.request({ type: 'add', vid, title: info.title, author: info.author });
      input.value = ''; setTab('queue');
    } }, input, addBtn);

    const menuBtn = h('button', { class: 'iconbtn', 'aria-label': 'Room menu', onclick: openMenu }, icon('dots'));
    const shareBtn = h('button', { class: 'iconbtn', 'aria-label': 'Share the room', onclick: share }, icon('share'));
    const backBtn = h('button', { class: 'iconbtn', 'aria-label': 'Leave the room', onclick: leaveRoom }, icon('back'));
    const roomName = h('b', {}), lockIcon = h('span', { class: 'lock' }, icon('lock', 14));

    screen.replaceChildren(
      h('header', { class: 'topbar room' }, backBtn,
        h('div', { class: 'roomid' }, h('span', { class: 'onair' }, h('i', { class: 'led live' }), 'On air'), h('div', { class: 'rname' }, roomName, lockIcon), h('span', { class: 'code' }, [...code].map((c) => h('i', {}, c)))),
        shareBtn, menuBtn),
      banner,
      h('div', { class: 'rig' },
        h('section', { class: 'deck', 'aria-label': 'Player' },
          h('div', { class: 'monitor' }, yt, veil),
          h('div', { class: 'deckrow' }, platter, lcd),
          wave,
          h('div', { class: 'transport' }, playBtn, nextBtn, knob.el)),
        h('section', { class: 'crate', 'aria-label': 'Queue and listeners' },
          h('div', { class: 'tabs' }, tabQueue, tabChannels),
          addForm, crateBody)));

    // ---- drawing the parts that change with the room's state ----
    function setTab(t) { tab = t; renderCrate(); }

    function renderAll() {
      roomName.textContent = state.name;
      lockIcon.hidden = !state.locked;
      renderNow(); renderCrate(); renderControls();
    }

    function renderNow() {
      const item = state.playback.item;
      titleEl.textContent = item ? item.title : 'Nothing on the deck';
      subEl.textContent = item ? `${item.author ? item.author + ' · ' : ''}added by ${item.by}` : 'Add a song to start the set';
      label.style.backgroundImage = item ? `url(${thumbUrl(item.vid)})` : '';
      listenText.textContent = `${state.members.length} ${state.members.length === 1 ? 'listening' : 'listening'}`;
    }

    function renderControls() {
      const pb = state.playback, can = canControl();
      playBtn.replaceChildren(icon(pb.playing ? 'pause' : 'play', 26), h('span', {}, pb.playing ? 'Pause' : 'Play'));
      playBtn.classList.toggle('lit', pb.playing);
      playBtn.disabled = !can || !pb.item; nextBtn.disabled = !can || !pb.item;
      wave.classList.toggle('locked', !can || !pb.item);
    }

    function renderCrate() {
      tabQueue.textContent = `Queue ${state.queue.length ? `· ${state.queue.length}` : ''}`.trim();
      tabChannels.textContent = `Channels · ${state.members.length}`;
      tabQueue.classList.toggle('on', tab === 'queue'); tabChannels.classList.toggle('on', tab === 'channels');
      addForm.hidden = tab !== 'queue';
      if (tab === 'queue') {
        crateBody.replaceChildren(state.queue.length
          ? h('ol', { class: 'tracks' }, state.queue.map((q, i) => h('li', { class: 'track' },
              h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')),
              h('img', { src: thumbUrl(q.vid), alt: '', loading: 'lazy', width: 64, height: 36 }),
              h('div', { class: 'meta' }, h('b', {}, q.title), h('small', {}, `${q.author ? q.author + ' · ' : ''}${q.by}`)),
              canControl() && h('button', { class: 'iconbtn sm', 'aria-label': `Play ${q.title} now`, title: 'Play now', onclick: () => session.request({ type: 'playnow', qid: q.qid }) }, icon('play', 16)),
              (isHost || q.byId === session.id) && h('button', { class: 'iconbtn sm', 'aria-label': `Remove ${q.title}`, title: 'Remove', onclick: () => session.request({ type: 'remove', qid: q.qid }) }, icon('x', 16)))))
          : h('div', { class: 'empty' }, icon('music', 28), h('p', {}, state.playback.item ? 'The queue is empty. Add the next song.' : 'The deck is empty. Paste a YouTube link above to start.')));
      } else {
        crateBody.replaceChildren(h('ul', { class: 'channels' }, state.members.map((m, i) => h('li', { class: 'channel' },
          h('span', { class: 'idx' }, `CH${i + 1}`), h('i', { class: 'led on' }),
          h('b', {}, m.nick, (m.id === session.id) && h('em', {}, ' (you)')),
          m.host ? h('span', { class: 'tag' }, 'Host') : null,
          isHost && !m.host && h('button', { class: 'iconbtn sm', 'aria-label': `Remove ${m.nick}`, title: 'Remove from room', onclick: async () => { if (await confirmDialog({ title: `Remove ${m.nick}?`, message: 'They can come back with the code and password.', confirmText: 'Remove', danger: true })) session.request({ type: 'kick', id: m.id }); } }, icon('x', 16))))));
      }
    }

    // ---- waveform seek bar: a timeline drawn from the song's id, not from its audio ----
    let wavePos = -1, waveBars = null, waveVid = null;
    function drawWave(progress) {
      const dpr = window.devicePixelRatio || 1, w = wave.clientWidth, hgt = wave.clientHeight;
      if (!w) return;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); wavePos = -1; }
      const vid = state.playback.item?.vid ?? '';
      if (vid !== waveVid) { waveVid = vid; waveBars = barsFor(vid); wavePos = -1; }
      if (Math.abs(progress - wavePos) < 0.002) return;
      wavePos = progress;
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hgt);
      const n = waveBars.length, gap = 2, bw = Math.max(1.5, w / n - gap), css = getComputedStyle(document.documentElement);
      for (let i = 0; i < n; i++) {
        const x = i * (bw + gap), bh = Math.max(3, waveBars[i] * (hgt - 8)), played = (i + 0.5) / n <= progress;
        ctx.fillStyle = played ? css.getPropertyValue('--cyan') : css.getPropertyValue('--bar');
        ctx.fillRect(x, (hgt - bh) / 2, bw, bh);
      }
      ctx.fillStyle = css.getPropertyValue('--fg'); ctx.fillRect(Math.min(w - 2, progress * w), 0, 2, hgt);
    }
    const seekFromEvent = (e) => { const r = wave.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    let scrub = 0;
    wave.addEventListener('pointerdown', (e) => { if (wave.classList.contains('locked')) return; dragging = true; scrub = seekFromEvent(e); wave.setPointerCapture(e.pointerId); drawWave(scrub); });
    wave.addEventListener('pointermove', (e) => { if (!dragging) return; scrub = seekFromEvent(e); drawWave(scrub); });
    const finishScrub = (e) => { if (!dragging) return; dragging = false; const d = player?.duration(); if (d) session.request({ type: 'seek', pos: scrub * d }); };
    wave.addEventListener('pointerup', finishScrub); wave.addEventListener('pointercancel', () => { dragging = false; });
    wave.addEventListener('keydown', (e) => {
      if (wave.classList.contains('locked') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); const pos = expectedPosition(state.playback, session.hostNow());
      session.request({ type: 'seek', pos: Math.max(0, pos + (e.key === 'ArrowRight' ? 10 : -10)) });
    });

    // ---- keeping the local player in step with the room, twice a second ----
    function tick() {
      if (ended) return;
      const pb = state.playback, now = Date.now(), hostNow = session.hostNow();
      const item = pb.item;
      let drift = null;
      if (player && item) {
        const expected = expectedPosition(pb, hostNow), key = item.qid;
        if (lastKey !== key) {
          lastKey = key; lastSeek = now; tapNeeded = false; notPlayingSince = null;
          player.load(item.vid, key, expected, pb.playing);
        } else {
          const ps = player.state(), dur = player.duration();
          const d = decide({ expected, current: player.time(), wantPlaying: pb.playing, playerState: ps === 'ended' ? 'idle' : ps, sinceSeek: now - lastSeek, duration: dur || Infinity });
          if (d.seekTo != null) { player.seek(d.seekTo); lastSeek = now; }
          if (d.play) player.play();
          if (d.pause) player.pause();
          if (pb.playing && ps === 'playing') drift = Math.abs(player.time() - expected);
          if (pb.playing && ps !== 'playing' && ps !== 'buffering') { notPlayingSince ??= now; if (now - notPlayingSince > 3000) tapNeeded = true; }
          else { notPlayingSince = null; if (ps === 'playing') tapNeeded = false; }
        }
      } else if (player && !item && lastKey !== null) { lastKey = null; player.stop(); }

      const dur = player?.duration() || 0, pos = item ? expectedPosition(pb, hostNow) : 0;
      elapsed.textContent = formatClock(pos);
      remaining.textContent = dur ? `-${formatClock(Math.max(0, dur - pos))}` : '-:--';
      if (!dragging) { const p = dur && item ? Math.min(1, pos / dur) : 0; drawWave(p); wave.setAttribute('aria-valuenow', String(Math.round(p * 100))); }
      const spinning = Boolean(item && pb.playing && player?.state() === 'playing');
      platter.classList.toggle('spin', spinning); platter.classList.toggle('loaded', Boolean(item));
      if (isHost) { syncLed.className = 'led on'; syncText.textContent = 'HOST CLOCK'; }
      else if (drift == null) { syncLed.className = 'led'; syncText.textContent = item && pb.playing ? 'SYNCING' : 'SYNC'; }
      else { syncLed.className = `led ${drift < 0.35 ? 'on' : 'warn'}`; syncText.textContent = `SYNC ±${Math.round(drift * 1000)}ms`; }
      veilBtn.hidden = !(tapNeeded && status === 'live');
      veilText.textContent = status !== 'live' ? 'Reconnecting…' : playerFailed ? 'YouTube could not be reached' : tapNeeded ? 'Your browser is waiting for a tap' : !item ? 'Nothing on the deck' : '';
      veil.classList.toggle('on', Boolean(veilText.textContent) || !veilBtn.hidden);
    }

    createPlayer(yt, {
      onEnded: (qid) => { if (isHost && qid != null) session.request({ type: 'ended', qid }); },
      onError: (_code, qid) => { if (isHost && qid != null) session.request({ type: 'unplayable', qid }); },
    }).then((p) => { player = p; p.setVolume(knob.value); lastKey = null; }).catch(() => { playerFailed = true; });

    // ---- wiring ----
    off.push(session.on('update', (s) => { state = s; renderAll(); if (isHost) scheduleSave(); }));
    off.push(session.on('notice', (text) => toast(text)));
    off.push(session.on('rejected', (d) => toast(REJECTIONS[d.error] ?? 'That did not work.')));
    off.push(session.on('status', (s) => { status = s; banner.hidden = s === 'live'; }));
    off.push(session.on('closed', ({ reason }) => {
      ended = true; player?.stop(); store.joined.clear(code);
      screen.replaceChildren(h('div', { class: 'card center' },
        icon('music', 36),
        h('h1', {}, reason === 'kicked' ? 'You were removed' : reason === 'lost' ? 'Lost the room' : 'The room has ended'),
        h('p', { class: 'muted' }, reason === 'kicked' ? 'The host removed you from this room.' : reason === 'lost' ? 'We could not reach the host any more. Their connection may have dropped.' : 'The host closed the room.'),
        h('a', { class: 'btn primary', href: '#/' }, 'Back to start')));
    }));
    let saveTimer = null;
    const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.hostRecord.set({ ...snapshot(session.room), fresh: false }), 300); };
    const timer = setInterval(tick, 400);
    const onResize = () => { wavePos = -1; };
    window.addEventListener('resize', onResize);
    renderAll(); tick();

    async function share() {
      const url = `${location.origin}${location.pathname}#/r/${code}`;
      const text = `Join "${state.name}" on Jukeroom${state.locked ? ' (you will need the password)' : ''}`;
      try { if (navigator.share) { await navigator.share({ title: 'Jukeroom', text, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { toast(url, 6000); }
    }

    async function openMenu() {
      const choice = await sheet({
        title: state.name, message: `Room code ${code}`,
        actions: [
          { id: 'share', label: 'Share the invite link', primary: true },
          { id: 'code', label: 'Copy the room code' },
          isHost && { id: 'control', label: 'Guests can control playback', detail: state.guestsControl ? 'On' : 'Off' },
          { id: 'help', label: 'How it works' },
          isHost ? { id: 'end', label: 'End the room for everyone', danger: true } : { id: 'leave', label: 'Leave the room', danger: true },
        ].filter(Boolean),
      });
      if (choice === 'share') share();
      else if (choice === 'code') { try { await navigator.clipboard.writeText(code); toast('Code copied'); } catch { toast(code, 5000); } }
      else if (choice === 'control') session.request({ type: 'settings', guestsControl: !state.guestsControl });
      else if (choice === 'help') go('/help');
      else if (choice === 'end' || choice === 'leave') leaveRoom();
    }

    async function leaveRoom() {
      if (isHost) {
        if (!(await confirmDialog({ title: 'End the room?', message: 'The music stops for everyone. A room only exists while you keep this page open.', confirmText: 'End room', cancelText: 'Keep playing', danger: true }))) return;
        store.hostRecord.clear(); store.recent.remove(code);
        session.close();
      } else store.joined.clear(code);
      go('/');
    }

    cleanup = () => {
      clearInterval(timer); clearTimeout(saveTimer); window.removeEventListener('resize', onResize); off.forEach((f) => f());
      ended = true; try { player?.destroy(); } catch {} session.close();
    };
  }
}

/** A rotary volume knob that works by dragging, scrolling, arrow keys or a tap to mute. */
function makeKnob(initial, onChange) {
  let value = Math.min(100, Math.max(0, initial)), muted = false, lastNonZero = value || 80;
  const NS = 'http://www.w3.org/2000/svg';
  const el = h('div', { class: 'knob', role: 'slider', tabindex: 0, 'aria-label': 'Volume', 'aria-valuemin': 0, 'aria-valuemax': 100 });
  el.innerHTML = '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><path class="track" d="" /><path class="fill" d="" /><g class="cap"><circle cx="32" cy="32" r="19"/><line x1="32" y1="32" x2="32" y2="17"/></g></svg><span class="readout"></span><span class="knob-label">Volume</span>';
  const track = el.querySelector('.track'), fill = el.querySelector('.fill'), cap = el.querySelector('.cap'), readout = el.querySelector('.readout');
  const arc = (from, to) => { const p = (a) => [32 + 27 * Math.sin(a * Math.PI / 180), 32 - 27 * Math.cos(a * Math.PI / 180)]; const [x1, y1] = p(from), [x2, y2] = p(to); return `M${x1.toFixed(2)} ${y1.toFixed(2)} A27 27 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`; };
  track.setAttribute('d', arc(-135, 135));
  const apply = () => {
    const shown = muted ? 0 : value, a = -135 + (270 * shown) / 100;
    fill.setAttribute('d', shown > 0 ? arc(-135, Math.max(-134.5, a)) : '');
    cap.setAttribute('transform', `rotate(${a} 32 32)`);
    readout.textContent = muted ? 'MUTE' : String(Math.round(value));
    el.setAttribute('aria-valuenow', String(Math.round(shown)));
    onChange(Math.round(shown));
  };
  const set = (v) => { value = Math.min(100, Math.max(0, v)); if (value > 0) { muted = false; lastNonZero = value; } apply(); };
  let startY = 0, startV = 0, moved = false;
  el.addEventListener('pointerdown', (e) => { startY = e.clientY; startV = value; moved = false; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => { if (!el.hasPointerCapture(e.pointerId)) return; const dy = startY - e.clientY; if (Math.abs(dy) > 3) moved = true; if (moved) set(startV + dy * 0.8); });
  el.addEventListener('pointerup', () => { if (!moved) { muted = !muted; if (!muted && value === 0) value = lastNonZero; apply(); } });
  el.addEventListener('wheel', (e) => { e.preventDefault(); set(value - Math.sign(e.deltaY) * 4); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(value + 5); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(value - 5); }
    else if (e.key === 'm' || e.key === 'M') { muted = !muted; apply(); }
  });
  apply();
  return { el, get value() { return muted ? 0 : Math.round(value); } };
}

/** Bar heights for the timeline, repeatable for a given song id so everyone sees the same picture. */
function barsFor(vid) {
  let seed = 2166136261;
  for (const ch of vid || 'empty') { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619) >>> 0; }
  const rand = () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return seed / 4294967296; };
  const n = 96, out = [];
  let level = 0.5;
  for (let i = 0; i < n; i++) {
    level = Math.min(1, Math.max(0.12, level + (rand() - 0.5) * 0.45));
    const section = 0.55 + 0.45 * Math.sin((i / n) * Math.PI * 3 + (vid.length ? vid.charCodeAt(0) : 1));
    out.push(Math.min(1, Math.max(0.08, level * section + rand() * 0.15)));
  }
  return out;
}
