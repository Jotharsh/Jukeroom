// The room, as the host's device keeps it. Pure data and rules, no browser, so it is easy to test.
// Everyone else only ever sees publicState(); every change they ask for goes through act().
import { CODE_ALPHABET, CODE_LENGTH, MAX_QUEUE, MAX_MEMBERS, MAX_NICK, MAX_ROOM_NAME } from './config.js';
import { expectedPosition } from './sync.js';

const VIDEO_ID = /^[\w-]{11}$/;
const PER_PERSON = 20;
export const HOST = 'host';

export function newCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}
export const normaliseCode = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);

export function cleanText(text, max, fallback = '') {
  const t = String(text ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return t || fallback;
}

export function createRoom({ code = newCode(), name, password = '', guestsControl = true, hostNick = 'Host', now = Date.now() }) {
  return {
    code,
    name: cleanText(name, MAX_ROOM_NAME, 'Untitled room'),
    password: String(password ?? '').slice(0, 64),
    guestsControl,
    queue: [],
    playback: { item: null, playing: false, pos: 0, t: now },
    members: { [HOST]: { nick: cleanText(hostNick, MAX_NICK, 'Host') } },
    nextQid: 1,
    rev: 0,
  };
}

function sameSecret(a, b) {                 // does not stop early, so timing does not leak how much matched
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function uniqueNick(room, wanted, id) {
  const taken = new Set(Object.entries(room.members).filter(([k]) => k !== id).map(([, m]) => m.nick.toLowerCase()));
  let nick = wanted, n = 2;
  while (taken.has(nick.toLowerCase())) nick = `${wanted.slice(0, MAX_NICK - 3)} ${n++}`;
  return nick;
}

/** A guest asks to come in. Returns { ok } or { ok:false, error: 'password' | 'full' }. */
export function join(room, id, { nick, password = '' }) {
  if (room.members[id]) { room.members[id].nick = uniqueNick(room, cleanText(nick, MAX_NICK, 'Guest'), id); room.rev++; return { ok: true }; }
  if (Object.keys(room.members).length >= MAX_MEMBERS) return { ok: false, error: 'full' };
  if (room.password && !sameSecret(String(password), room.password)) return { ok: false, error: 'password' };
  room.members[id] = { nick: uniqueNick(room, cleanText(nick, MAX_NICK, 'Guest'), id) };
  room.rev++;
  return { ok: true };
}

export function leave(room, id) {
  if (id === HOST || !room.members[id]) return false;
  delete room.members[id];
  room.rev++;
  return true;
}

function advance(room, now) {
  const item = room.queue.shift() ?? null;
  room.playback = { item, playing: Boolean(item), pos: 0, t: now };
}

const canControl = (room, id) => id === HOST || room.guestsControl;

/**
 * Applies one request from a member. Returns { ok, error?, notice?, kick? }.
 * `notice` is a short sentence everyone may like to see.
 */
export function act(room, id, msg, now = Date.now()) {
  if (!room.members[id]) return { ok: false, error: 'not-in-room' };
  const pb = room.playback;
  const result = (extra = {}) => { room.rev++; return { ok: true, ...extra }; };
  const nick = room.members[id].nick;

  switch (msg?.type) {
    case 'add': {
      if (!VIDEO_ID.test(String(msg.vid ?? ''))) return { ok: false, error: 'bad-video' };
      const mine = room.queue.filter((q) => q.byId === id).length;
      if (room.queue.length >= MAX_QUEUE) return { ok: false, error: 'queue-full' };
      if (mine >= PER_PERSON) return { ok: false, error: 'too-many' };
      const item = { qid: room.nextQid++, vid: msg.vid, title: cleanText(msg.title, 200, 'YouTube song'), author: cleanText(msg.author, 100), by: nick, byId: id };
      if (!pb.item) room.playback = { item, playing: true, pos: 0, t: now };
      else room.queue.push(item);
      return result({ notice: `${nick} added ${item.title}` });
    }
    case 'remove': {
      const at = room.queue.findIndex((q) => q.qid === msg.qid);
      if (at < 0) return { ok: false, error: 'gone' };
      if (id !== HOST && room.queue[at].byId !== id) return { ok: false, error: 'not-yours' };
      room.queue.splice(at, 1);
      return result();
    }
    case 'play': case 'pause': case 'seek': case 'next': case 'playnow': {
      if (!canControl(room, id)) return { ok: false, error: 'no-control' };
      if (msg.type === 'next') { advance(room, now); return result({ notice: pb.item || room.playback.item ? undefined : 'The queue is empty' }); }
      if (msg.type === 'playnow') {
        const at = room.queue.findIndex((q) => q.qid === msg.qid);
        if (at < 0) return { ok: false, error: 'gone' };
        room.playback = { item: room.queue.splice(at, 1)[0], playing: true, pos: 0, t: now };
        return result();
      }
      if (!pb.item) return { ok: false, error: 'nothing-playing' };
      const here = expectedPosition(pb, now);
      if (msg.type === 'play') room.playback = { ...pb, playing: true, pos: here, t: now };
      else if (msg.type === 'pause') room.playback = { ...pb, playing: false, pos: here, t: now };
      else {
        const to = Number(msg.pos);
        if (!Number.isFinite(to) || to < 0) return { ok: false, error: 'bad-position' };
        room.playback = { ...pb, pos: to, t: now };
      }
      return result();
    }
    case 'ended': {                       // only the host's own player is believed about this
      if (id !== HOST || pb.item?.qid !== msg.qid) return { ok: false, error: 'stale' };
      advance(room, now);
      return result();
    }
    case 'unplayable': {
      if (id !== HOST || pb.item?.qid !== msg.qid) return { ok: false, error: 'stale' };
      const title = pb.item.title;
      advance(room, now);
      return result({ notice: `${title} can't be played here, so it was skipped` });
    }
    case 'settings': {
      if (id !== HOST) return { ok: false, error: 'host-only' };
      if (typeof msg.guestsControl === 'boolean') room.guestsControl = msg.guestsControl;
      return result();
    }
    case 'kick': {
      if (id !== HOST) return { ok: false, error: 'host-only' };
      if (!room.members[msg.id] || msg.id === HOST) return { ok: false, error: 'gone' };
      const gone = room.members[msg.id].nick;
      delete room.members[msg.id];
      return result({ kick: msg.id, notice: `${gone} was removed` });
    }
    default: return { ok: false, error: 'unknown' };
  }
}

/** What goes over the wire to everyone. Never includes the password. */
export function publicState(room, hostNow = Date.now()) {
  return {
    code: room.code, name: room.name, locked: Boolean(room.password), guestsControl: room.guestsControl,
    queue: room.queue, playback: room.playback, rev: room.rev, hostNow,
    members: Object.entries(room.members).map(([id, m]) => ({ id, nick: m.nick, host: id === HOST })),
  };
}

/** What the host's device keeps so a page refresh does not end the room. */
export const snapshot = (room) => ({
  code: room.code, name: room.name, password: room.password, guestsControl: room.guestsControl,
  nick: room.members[HOST].nick, queue: [room.playback.item, ...room.queue].filter(Boolean), nextQid: room.nextQid,
});

export function restore(saved, now = Date.now()) {
  const room = createRoom({ code: saved.code, name: saved.name, password: saved.password, guestsControl: saved.guestsControl, hostNick: saved.nick, now });
  room.queue = (saved.queue ?? []).filter((q) => VIDEO_ID.test(String(q?.vid))).map((q) => ({ ...q, byId: q.byId === HOST ? HOST : null }));
  room.nextQid = saved.nextQid ?? room.queue.length + 1;
  return room;
}
