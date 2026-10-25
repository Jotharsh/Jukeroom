// Peer to peer rooms. The host's browser is the room: it keeps the state and checks the password.
// Guests connect straight to it over WebRTC. PeerJS's free public broker only introduces the devices.
import { PEER_PREFIX, MAX_PASSWORD_TRIES } from './config.js';
import { createRoom, restore, join, leave, act, publicState, HOST } from './room.js';
import { ClockSync } from './sync.js';

const ICE = { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Emitter {
  #handlers = {};
  on(type, fn) { (this.#handlers[type] ??= new Set()).add(fn); return () => this.#handlers[type].delete(fn); }
  emit(type, payload) { for (const fn of this.#handlers[type] ?? []) { try { fn(payload); } catch (e) { console.error(e); } } }
}

const safeSend = (conn, data) => { try { if (conn.open) conn.send(data); } catch (e) { console.warn('send failed', e); } };

export class HostSession extends Emitter {
  isHost = true;
  id = HOST;
  constructor(room) { super(); this.room = room; this.conns = new Map(); this.peer = null; this.beat = null; this.closed = false; }

  get state() { return publicState(this.room, Date.now()); }
  hostNow() { return Date.now(); }

  /** Opens the room. When resuming after a refresh the old registration may take a moment to clear, so we keep trying. */
  async start({ retryFor = 0 } = {}) {
    const until = Date.now() + retryFor;
    for (;;) {
      try { await this.#open(); break; }
      catch (error) { if (error.reason !== 'taken' || Date.now() > until) throw error; await wait(1500); }
    }
    this.beat = setInterval(() => this.#broadcast({ t: 'beat', rev: this.room.rev, playback: this.room.playback, hostNow: Date.now() }), 2000);
  }

  #open() {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_PREFIX + this.room.code, ICE);
      const timer = setTimeout(() => { peer.destroy(); reject({ reason: 'offline' }); }, 15000);
      peer.on('open', () => { clearTimeout(timer); this.peer = peer; peer.on('connection', (c) => this.#onConnection(c)); peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); }); resolve(); });
      peer.on('error', (e) => { if (!this.peer) { clearTimeout(timer); peer.destroy(); reject({ reason: e.type === 'unavailable-id' ? 'taken' : 'offline' }); } else console.warn('peer error', e.type); });
    });
  }

  #onConnection(conn) {
    let tries = 0, joined = false;
    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;
      if (!joined) {
        if (data.t !== 'hello') return;
        const result = join(this.room, conn.peer, { nick: data.nick, password: data.pw });
        if (!result.ok) {
          safeSend(conn, { t: 'denied', reason: result.error });
          if (result.error === 'password' && ++tries >= MAX_PASSWORD_TRIES) setTimeout(() => conn.close(), 300);
          if (result.error === 'full') setTimeout(() => conn.close(), 300);
          return;
        }
        joined = true; this.conns.set(conn.peer, conn);
        safeSend(conn, { t: 'welcome', id: conn.peer, state: publicState(this.room, Date.now()) });
        this.#changed(`${this.room.members[conn.peer].nick} joined`);
        return;
      }
      if (data.t === 'ping') safeSend(conn, { t: 'pong', c: data.c, h: Date.now() });
      else if (data.t === 'need') safeSend(conn, { t: 'state', state: publicState(this.room, Date.now()) });
      else if (data.t === 'act') {
        const result = act(this.room, conn.peer, data.msg);
        if (!result.ok) { safeSend(conn, { t: 'rejected', error: result.error, what: data.msg?.type }); return; }
        if (result.kick) { const k = this.conns.get(result.kick); if (k) { safeSend(k, { t: 'kicked' }); setTimeout(() => k.close(), 300); this.conns.delete(result.kick); } }
        this.#changed(result.notice);
      }
    });
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      const nick = this.room.members[conn.peer]?.nick;
      if (joined && leave(this.room, conn.peer)) this.#changed(`${nick} left`);
    });
    conn.on('error', (e) => console.warn('connection error', e));
  }

  #broadcast(message) { for (const c of this.conns.values()) safeSend(c, message); }

  #changed(notice) {
    this.#broadcast({ t: 'state', state: publicState(this.room, Date.now()), notice });
    this.emit('update', this.state);
    if (notice) this.emit('notice', notice);
  }

  /** The host's own requests go through the same rules as everyone else's. */
  request(msg) {
    const result = act(this.room, HOST, msg);
    if (result.ok) {
      if (result.kick) { const k = this.conns.get(result.kick); if (k) { safeSend(k, { t: 'kicked' }); setTimeout(() => k.close(), 300); this.conns.delete(result.kick); } }
      this.#changed(result.notice);
    }
    return result;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.beat);
    this.#broadcast({ t: 'closed' });
    setTimeout(() => this.peer?.destroy(), 400);
  }
}

export class GuestSession extends Emitter {
  isHost = false;
  constructor({ code, nick, password = '' }) {
    super(); Object.assign(this, { code, nick, password });
    this.state = null; this.id = null; this.clock = new ClockSync();
    this.peer = null; this.conn = null; this.timers = []; this.closed = false; this.pings = 0;
  }
  hostNow() { return this.clock.hostNow(); }

  /** Resolves when we are in. Rejects with { reason: 'notfound' | 'password' | 'full' | 'offline' }. */
  async connect() { await this.#dial(15000); this.#afterJoin(); }

  #dial(timeoutMs) {
    return new Promise((resolve, reject) => {
      this.#teardown();
      const peer = new Peer(undefined, ICE);
      this.peer = peer;
      let settled = false;
      const fail = (reason) => { if (settled) return; settled = true; clearTimeout(timer); peer.destroy(); reject({ reason }); };
      const timer = setTimeout(() => fail('offline'), timeoutMs);
      peer.on('error', (e) => { if (!settled) fail(e.type === 'peer-unavailable' ? 'notfound' : 'offline'); });
      peer.on('open', () => {
        const conn = peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => safeSend(conn, { t: 'hello', nick: this.nick, pw: this.password }));
        conn.on('data', (d) => {
          if (!d || typeof d !== 'object' || conn !== this.conn) return;
          this.heard = Date.now();
          if (!settled && d.t === 'welcome') {
            settled = true; clearTimeout(timer);
            this.id = d.id; this.state = d.state; this.clock.offset = d.state.hostNow - Date.now();   // rough, until the pings refine it
            resolve();
          } else if (!settled && d.t === 'denied') fail(d.reason);
          else if (settled) this.#onData(d);
        });
        conn.on('close', () => { if (conn !== this.conn) return; if (!settled) fail('offline'); else this.#lost(); });
      });
    });
  }

  #afterJoin() {
    this.heard = Date.now(); this.pings = 0;
    this.#ping();
    this.timers.push(setInterval(() => { this.#ping(); if (Date.now() - this.heard > 9000) this.#lost(); }, 1000));   // a vanished host does not always close the connection
  }
  #ping() {
    if (this.pings++ > 6 && this.pings % 8 !== 0) return;                     // quick at first, then every 8 seconds
    if (this.conn) safeSend(this.conn, { t: 'ping', c: Date.now() });
  }

  #onData(d) {
    switch (d.t) {
      case 'pong': this.clock.addSample(d.c, d.h, Date.now()); break;
      case 'state': this.state = d.state; this.emit('update', this.state); if (d.notice) this.emit('notice', d.notice); break;
      case 'beat':
        if (!this.state) break;
        if (d.rev !== this.state.rev) safeSend(this.conn, { t: 'need' });
        else { this.state = { ...this.state, playback: d.playback }; this.emit('update', this.state); }
        break;
      case 'rejected': this.emit('rejected', d); break;
      case 'kicked': this.closed = true; this.#teardown(); this.emit('closed', { reason: 'kicked' }); break;
      case 'closed': this.closed = true; this.#teardown(); this.emit('closed', { reason: 'ended' }); break;
    }
  }

  async #lost() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    this.emit('status', 'reconnecting');
    this.#clearTimers();
    const until = Date.now() + 45000;
    while (!this.closed && Date.now() < until) {
      await wait(3000);
      if (this.closed) return;
      try { await this.#dial(10000); this.reconnecting = false; this.#afterJoin(); this.emit('status', 'live'); this.emit('update', this.state); return; }
      catch (e) { if (e.reason === 'password' || e.reason === 'full') break; }
    }
    this.reconnecting = false;
    if (!this.closed) { this.closed = true; this.#teardown(); this.emit('closed', { reason: 'lost' }); }
  }

  request(msg) { if (this.conn) safeSend(this.conn, { t: 'act', msg }); return { ok: true }; }

  #clearTimers() { this.timers.splice(0).forEach(clearInterval); }
  #teardown() { this.#clearTimers(); try { this.conn?.close(); } catch {} try { this.peer?.destroy(); } catch {} this.conn = null; this.peer = null; }
  close() { this.closed = true; this.#teardown(); }
}

export { createRoom, restore };
