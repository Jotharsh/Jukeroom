// A thin wrapper over the YouTube IFrame player, so the rest of the app never touches YT constants.
let apiReady;
function loadApi() {
  return apiReady ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { apiReady = null; reject(new Error('YouTube could not be reached')); };
    document.head.append(script);
  });
}

const NAMES = { [-1]: 'idle', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'paused' };
const UNPLAYABLE = new Set([100, 101, 150, 5, 2]);     // not found, embedding off, or an internal error

export async function createPlayer(mount, { onEnded, onError, onState } = {}) {
  await loadApi();
  const holder = document.createElement('div');
  mount.append(holder);
  let ready = false, queued = null, volume = 100;
  const api = { vid: null, qid: null };

  const yt = await new Promise((resolve) => {
    const p = new YT.Player(holder, {
      width: '100%', height: '100%',
      host: 'https://www.youtube-nocookie.com',
      playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, fs: 0, iv_load_policy: 3, modestbranding: 1, origin: location.origin },
      events: {
        onReady: () => { ready = true; resolve(p); if (queued) { queued(); queued = null; } },
        onStateChange: (e) => { const s = NAMES[e.data] ?? 'idle'; onState?.(s); if (e.data === 0) onEnded?.(api.qid); },
        onError: (e) => { if (UNPLAYABLE.has(e.data)) onError?.(e.data, api.qid); },
      },
    });
  });

  const when = (fn) => (ready ? fn() : (queued = fn));
  Object.assign(api, {
    load(vid, qid, start, autoplay) {
      api.vid = vid; api.qid = qid;
      when(() => (autoplay ? yt.loadVideoById({ videoId: vid, startSeconds: start }) : yt.cueVideoById({ videoId: vid, startSeconds: start })));
    },
    play: () => yt.playVideo(),
    pause: () => yt.pauseVideo(),
    seek: (s) => yt.seekTo(s, true),
    stop() { api.vid = null; api.qid = null; try { yt.stopVideo(); } catch {} },
    time: () => { try { return yt.getCurrentTime() || 0; } catch { return 0; } },
    duration: () => { try { return yt.getDuration() || 0; } catch { return 0; } },
    state: () => { try { return NAMES[yt.getPlayerState()] ?? 'idle'; } catch { return 'idle'; } },
    setVolume(v) { volume = v; try { yt.setVolume(v); if (v === 0) yt.mute(); else yt.unMute(); } catch {} },
    get volume() { return volume; },
    destroy() { try { yt.destroy(); } catch {} holder.remove(); },
  });
  return api;
}
