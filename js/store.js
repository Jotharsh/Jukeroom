// What stays on this device. Every access is wrapped because storage can be blocked (private windows, strict settings).
const read = (area, key, fallback) => { try { const v = area.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const write = (area, key, value) => { try { area.setItem(key, JSON.stringify(value)); } catch { /* blocked: the app still works, it just forgets */ } };
const remove = (area, key) => { try { area.removeItem(key); } catch {} };
const local = () => { try { return localStorage; } catch { return memory; } };
const session = () => { try { return sessionStorage; } catch { return memory; } };
const memory = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; }, removeItem(k) { delete this.data[k]; } };

export const nick = { get: () => read(local(), 'jukeroom.nick', ''), set: (v) => write(local(), 'jukeroom.nick', v) };
export const volume = { get: () => read(local(), 'jukeroom.volume', 100), set: (v) => write(local(), 'jukeroom.volume', v) };

export const hostRecord = {
  get: () => read(local(), 'jukeroom.host', null),
  set: (v) => write(local(), 'jukeroom.host', v),
  clear: () => remove(local(), 'jukeroom.host'),
};

/** Where this tab has already been let in, so a refresh does not ask for the password again. */
export const joined = {
  get: (code) => read(session(), `jukeroom.joined.${code}`, null),
  set: (code, v) => write(session(), `jukeroom.joined.${code}`, v),
  clear: (code) => remove(session(), `jukeroom.joined.${code}`),
};

export const recent = {
  list: () => read(local(), 'jukeroom.recent', []),
  add(entry) {
    const list = recent.list().filter((r) => r.code !== entry.code);
    list.unshift({ ...entry, at: Date.now() });
    write(local(), 'jukeroom.recent', list.slice(0, 5));
  },
  remove(code) { write(local(), 'jukeroom.recent', recent.list().filter((r) => r.code !== code)); },
};
