// Clock and drift maths. Pure functions, so they can be tested without a browser.

/** Estimates how far the host's clock is ahead of ours, from ping/pong round trips. */
export class ClockSync {
  constructor(keep = 8) { this.keep = keep; this.samples = []; this.offset = 0; this.rtt = null; }

  /** sent and received are our own clock; hostTime is the host's clock when it answered. */
  addSample(sent, hostTime, received) {
    const rtt = received - sent;
    if (!(rtt >= 0) || rtt > 5000) return;                       // a stalled reply says nothing useful
    this.samples.push({ rtt, offset: hostTime + rtt / 2 - received });
    if (this.samples.length > this.keep) this.samples.shift();
    // The quickest round trips are the least distorted by queueing, so trust the best three.
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3).map((s) => s.offset).sort((a, b) => a - b);
    this.offset = best[Math.floor(best.length / 2)];
    this.rtt = Math.min(...this.samples.map((s) => s.rtt));
  }

  hostNow(ownNow = Date.now()) { return ownNow + this.offset; }
}

/** Where the song should be right now, given the host's playback record. */
export function expectedPosition(playback, hostNow) {
  if (!playback?.item) return 0;
  if (!playback.playing) return playback.pos;
  return Math.max(0, playback.pos + (hostNow - playback.t) / 1000);
}

export const DRIFT_SEEK = 0.3;       // seconds out of step before we jump
export const SEEK_COOLDOWN = 2500;   // after a jump, give the player time to settle

/**
 * What the local player should do to follow the room.
 * playerState: 'playing' | 'paused' | 'buffering' | 'idle'
 * Returns { play, pause, seekTo } where each is optional.
 */
export function decide({ expected, current, wantPlaying, playerState, sinceSeek = Infinity, duration = Infinity }) {
  const drift = Math.abs(current - expected);
  const target = Math.min(expected, Math.max(0, duration - 0.5));
  if (!wantPlaying) {
    const out = {};
    if (playerState === 'playing' || playerState === 'buffering') out.pause = true;
    if (drift > 0.4 && sinceSeek > SEEK_COOLDOWN / 2) out.seekTo = expected;
    return out;
  }
  if (playerState === 'buffering') return {};
  if (playerState !== 'playing') {
    const out = { play: true };
    if (drift > DRIFT_SEEK && sinceSeek > SEEK_COOLDOWN) out.seekTo = target;
    return out;
  }
  if (drift > DRIFT_SEEK && sinceSeek > SEEK_COOLDOWN) return { seekTo: Math.min(target + 0.25, duration) };   // lead a little, the seek itself takes time
  return {};
}
