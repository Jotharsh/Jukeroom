import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, join, leave, act, publicState, newCode, normaliseCode, cleanText, snapshot, restore, HOST } from '../js/room.js';
import { ClockSync, expectedPosition, decide } from '../js/sync.js';
import { parseVideoId, formatClock, fetchInfo } from '../js/youtube.js';

const V1 = 'jNQXAC9IVRw', V2 = 'aqz-KE-bpKQ', V3 = 'dQw4w9WgXcQ';
const fresh = (extra = {}) => createRoom({ name: 'Test', hostNick: 'Asha', now: 1000, ...extra });

test('codes are 6 readable characters', () => {
  const c = newCode(); assert.match(c, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(normaliseCode(' ab-c d12 34 '), 'ABCD12');
});

test('cleanText strips markup and control characters', () => {
  assert.equal(cleanText('  <b>Hi</b>\n there ', 20), ' b Hi /b  there'.replace(/\s+/g, ' ').trim());
  assert.equal(cleanText('', 5, 'x'), 'x');
  assert.equal(cleanText('abcdefgh', 3), 'abc');
});

test('password is required, wrong ones are refused, open rooms need none', () => {
  const locked = fresh({ password: 'sesame' });
  assert.deepEqual(join(locked, 'g1', { nick: 'Ravi', password: 'nope' }), { ok: false, error: 'password' });
  assert.deepEqual(join(locked, 'g1', { nick: 'Ravi' }), { ok: false, error: 'password' });
  assert.equal(join(locked, 'g1', { nick: 'Ravi', password: 'sesame' }).ok, true);
  assert.equal(join(fresh(), 'g2', { nick: 'Mei' }).ok, true);
});

test('the public state never carries the password', () => {
  const s = JSON.stringify(publicState(fresh({ password: 'sesame' })));
  assert.ok(!s.includes('sesame')); assert.ok(s.includes('"locked":true'));
});

test('room fills up and duplicate nicknames get a number', () => {
  const room = fresh();
  for (let i = 0; i < 11; i++) assert.equal(join(room, `g${i}`, { nick: 'Sam' }).ok, true);
  assert.equal(join(room, 'late', { nick: 'Sam' }).error, 'full');
  assert.deepEqual(new Set(Object.values(room.members).map((m) => m.nick)).size, 12);
});

test('first song starts at once, later ones queue', () => {
  const room = fresh();
  act(room, HOST, { type: 'add', vid: V1, title: 'Zoo' }, 2000);
  assert.equal(room.playback.item.vid, V1); assert.equal(room.playback.playing, true); assert.equal(room.queue.length, 0);
  act(room, HOST, { type: 'add', vid: V2, title: 'Bunny' }, 2100);
  assert.equal(room.queue.length, 1);
});

test('bad video ids and queue limits are refused', () => {
  const room = fresh();
  assert.equal(act(room, HOST, { type: 'add', vid: 'short' }).error, 'bad-video');
  join(room, 'g', { nick: 'G' });
  act(room, HOST, { type: 'add', vid: V1 });
  for (let i = 0; i < 20; i++) assert.equal(act(room, 'g', { type: 'add', vid: V2 }).ok, true);
  assert.equal(act(room, 'g', { type: 'add', vid: V2 }).error, 'too-many');
});

test('pause freezes the position and play resumes from it', () => {
  const room = fresh();
  act(room, HOST, { type: 'add', vid: V1 }, 0);
  act(room, HOST, { type: 'pause' }, 5000);
  assert.equal(room.playback.playing, false); assert.equal(room.playback.pos, 5);
  assert.equal(expectedPosition(room.playback, 99999), 5);
  act(room, HOST, { type: 'play' }, 10000);
  assert.equal(expectedPosition(room.playback, 12000), 7);
});

test('seek moves the position, and rejects nonsense', () => {
  const room = fresh();
  act(room, HOST, { type: 'add', vid: V1 }, 0);
  act(room, HOST, { type: 'seek', pos: 30 }, 1000);
  assert.equal(expectedPosition(room.playback, 3000), 32);
  assert.equal(act(room, HOST, { type: 'seek', pos: -4 }).error, 'bad-position');
  assert.equal(act(room, HOST, { type: 'seek', pos: 'x' }).error, 'bad-position');
});

test('guests control playback only while the host allows it', () => {
  const room = fresh(); join(room, 'g', { nick: 'G' });
  act(room, HOST, { type: 'add', vid: V1 }, 0);
  assert.equal(act(room, 'g', { type: 'pause' }, 1000).ok, true);
  assert.equal(act(room, 'g', { type: 'settings', guestsControl: false }).error, 'host-only');
  act(room, HOST, { type: 'settings', guestsControl: false });
  assert.equal(act(room, 'g', { type: 'play' }).error, 'no-control');
  assert.equal(act(room, 'g', { type: 'next' }).error, 'no-control');
  assert.equal(act(room, 'g', { type: 'add', vid: V2 }).ok, true);   // adding songs is always allowed
});

test('next, play-now and end of queue', () => {
  const room = fresh();
  act(room, HOST, { type: 'add', vid: V1, title: 'a' }, 0);
  act(room, HOST, { type: 'add', vid: V2, title: 'b' }, 0);
  act(room, HOST, { type: 'add', vid: V3, title: 'c' }, 0);
  const c = room.queue[1].qid;
  act(room, HOST, { type: 'playnow', qid: c }, 100);
  assert.equal(room.playback.item.title, 'c'); assert.equal(room.queue.length, 1);
  act(room, HOST, { type: 'next' }, 200); assert.equal(room.playback.item.title, 'b');
  act(room, HOST, { type: 'next' }, 300); assert.equal(room.playback.item, null); assert.equal(room.playback.playing, false);
  assert.equal(act(room, HOST, { type: 'play' }).error, 'nothing-playing');
});

test('only the host can say a song ended, and only for the current song', () => {
  const room = fresh(); join(room, 'g', { nick: 'G' });
  act(room, HOST, { type: 'add', vid: V1 }); act(room, HOST, { type: 'add', vid: V2 });
  const qid = room.playback.item.qid;
  assert.equal(act(room, 'g', { type: 'ended', qid }).error, 'stale');
  assert.equal(act(room, HOST, { type: 'ended', qid: 999 }).error, 'stale');
  assert.equal(act(room, HOST, { type: 'ended', qid }).ok, true);
  assert.equal(room.playback.item.vid, V2);
});

test('unplayable songs are skipped with a notice', () => {
  const room = fresh();
  act(room, HOST, { type: 'add', vid: V1, title: 'Locked' }); act(room, HOST, { type: 'add', vid: V2, title: 'Fine' });
  const r = act(room, HOST, { type: 'unplayable', qid: room.playback.item.qid });
  assert.match(r.notice, /Locked/); assert.equal(room.playback.item.title, 'Fine');
});

test('people can remove their own songs, the host any', () => {
  const room = fresh(); join(room, 'g', { nick: 'G' }); join(room, 'h', { nick: 'H' });
  act(room, HOST, { type: 'add', vid: V1 });
  act(room, 'g', { type: 'add', vid: V2 }); act(room, 'g', { type: 'add', vid: V3 });
  const [a, b] = room.queue;
  assert.equal(act(room, 'h', { type: 'remove', qid: a.qid }).error, 'not-yours');
  assert.equal(act(room, 'g', { type: 'remove', qid: a.qid }).ok, true);
  assert.equal(act(room, HOST, { type: 'remove', qid: b.qid }).ok, true);
  assert.equal(act(room, HOST, { type: 'remove', qid: b.qid }).error, 'gone');
});

test('the host can remove a guest, but not themselves; strangers can do nothing', () => {
  const room = fresh(); join(room, 'g', { nick: 'G' });
  assert.equal(act(room, 'g', { type: 'kick', id: HOST }).error, 'host-only');
  assert.equal(act(room, HOST, { type: 'kick', id: HOST }).error, 'gone');
  assert.equal(act(room, HOST, { type: 'kick', id: 'g' }).kick, 'g');
  assert.equal(act(room, 'g', { type: 'pause' }).error, 'not-in-room');
  assert.equal(leave(room, HOST), false);
});

test('revision goes up on every accepted change only', () => {
  const room = fresh(); const r0 = room.rev;
  act(room, HOST, { type: 'add', vid: 'bad' }); assert.equal(room.rev, r0);
  act(room, HOST, { type: 'add', vid: V1 }); assert.equal(room.rev, r0 + 1);
});

test('a refresh keeps the code, password and songs but not who was playing', () => {
  const room = fresh({ password: 'pw' });
  act(room, HOST, { type: 'add', vid: V1, title: 'a' }); act(room, HOST, { type: 'add', vid: V2, title: 'b' });
  const back = restore(JSON.parse(JSON.stringify(snapshot(room))), 5000);
  assert.equal(back.code, room.code); assert.equal(back.password, 'pw');
  assert.deepEqual(back.queue.map((q) => q.title), ['a', 'b']); assert.equal(back.playback.item, null);
  assert.equal(back.members[HOST].nick, 'Asha');
});

test('clock sync finds the host offset and ignores a slow outlier', () => {
  const c = new ClockSync();
  // host clock is 5000 ms ahead; the network takes 40 ms each way
  for (let i = 0; i < 4; i++) { const sent = 1000 * i; c.addSample(sent, sent + 40 + 5000, sent + 80); }
  assert.ok(Math.abs(c.offset - 5000) <= 1); assert.equal(c.rtt, 80);
  c.addSample(9000, 9000 + 900 + 5000, 9000 + 1800);        // one very slow trip
  assert.ok(Math.abs(c.offset - 5000) <= 5);
  c.addSample(0, 0, 9000);                                   // rejected: too slow to mean anything
  assert.ok(Math.abs(c.offset - 5000) <= 5);
  assert.equal(c.hostNow(100), 100 + c.offset);
});

test('decide: follows play, pause and large drift, but not small drift or a recent seek', () => {
  const base = { expected: 20, current: 20, wantPlaying: true, playerState: 'playing', sinceSeek: Infinity };
  assert.deepEqual(decide(base), {});
  assert.deepEqual(decide({ ...base, current: 20.2 }), {});
  assert.equal(decide({ ...base, current: 20.45 }).seekTo > 20, true);
  assert.equal(decide({ ...base, current: 25 }).seekTo > 20, true);
  assert.deepEqual(decide({ ...base, current: 25, sinceSeek: 500 }), {});
  assert.deepEqual(decide({ ...base, playerState: 'paused' }), { play: true });
  assert.equal(decide({ ...base, playerState: 'paused', current: 3 }).seekTo, 20);
  assert.deepEqual(decide({ ...base, playerState: 'buffering', current: 3 }), {});
  assert.deepEqual(decide({ ...base, wantPlaying: false }), { pause: true });
  assert.deepEqual(decide({ ...base, wantPlaying: false, playerState: 'paused', current: 40 }), { seekTo: 20 });
  assert.equal(decide({ ...base, current: 0, expected: 500, duration: 200 }).seekTo <= 200, true);
});

test('video links in every common shape', () => {
  for (const u of [V1, `https://www.youtube.com/watch?v=${V1}&t=5s`, `youtu.be/${V1}?si=x`, `https://m.youtube.com/watch?v=${V1}`,
    `https://music.youtube.com/watch?v=${V1}&list=abc`, `https://www.youtube.com/shorts/${V1}`, `https://www.youtube.com/embed/${V1}`, `  ${V1}  `])
    assert.equal(parseVideoId(u), V1, u);
  for (const u of ['', 'hello', 'https://example.com/watch?v=' + V1, 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/', null, 'javascript:alert(1)'])
    assert.equal(parseVideoId(u), null, String(u));
});

test('song info falls back gracefully', async () => {
  assert.deepEqual(await fetchInfo(V1, async () => ({ ok: true, json: async () => ({ title: 'Zoo', author_name: 'jawed' }) })), { title: 'Zoo', author: 'jawed', ok: true });
  assert.equal((await fetchInfo(V1, async () => ({ ok: false, status: 401 }))).ok, false);     // embedding disabled
  assert.equal((await fetchInfo(V1, async () => { throw new Error('offline'); })).ok, true);
  assert.equal(formatClock(75.9), '1:15'); assert.equal(formatClock(NaN), '0:00');
});
