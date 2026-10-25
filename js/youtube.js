const ID = /^[\w-]{11}$/;

/** Pulls the 11 character video id out of any common YouTube link, or a bare id. Returns null if there is none. */
export function parseVideoId(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (ID.test(text)) return text;
  let url;
  try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else { const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?]+)/); id = m?.[1] ?? null; }
  }
  return id && ID.test(id) ? id : null;
}

export const thumbUrl = (vid) => `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;

/** Title and channel from YouTube's public oEmbed endpoint (no key needed). Falls back to a plain label. */
export async function fetchInfo(vid, fetcher = fetch) {
  try {
    const response = await fetcher(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}&format=json`);
    if (!response.ok) return { title: 'Unknown song', author: '', ok: response.status !== 401 && response.status !== 404 };
    const data = await response.json();
    return { title: String(data.title ?? 'Unknown song'), author: String(data.author_name ?? ''), ok: true };
  } catch {
    return { title: 'YouTube song', author: '', ok: true };      // offline lookup failed; the song may still play
  }
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
