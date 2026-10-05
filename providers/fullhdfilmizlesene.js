/**
 * FullHDFilmizlesene — Nuvio scraper (PuuStream)
 *
 * CloudStream FullHDFilmizlesene provider + ParsRapidVid akışının JS karşılığı.
 *
 * Nuvio -> TMDB id
 * -> TMDB Türkçe/orijinal/İngilizce ad
 * -> fullhdfilmizlesene.now autocomplete
 * -> film detay sayfası
 * -> scx kaynakları
 * -> ROT13 + Base64
 * -> RapidVid /vx/
 * -> window._p8
 * -> _p8 decode
 * -> JSON cm/tm HLS + altyazı
 */

const SITE = 'https://www.fullhdfilmizlesene.now';
const TMDB = 'https://api.themoviedb.org/3';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

function log() {
  try { console.log.apply(console, ['[FullHDFilmizlesene]'].concat([].slice.call(arguments))); } catch (_) {}
}

function settings() {
  try { return (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) || {}; }
  catch (_) { return {}; }
}
function tmdbKey() {
  try { if (typeof TMDB_API_KEY !== 'undefined' && TMDB_API_KEY) return TMDB_API_KEY; }
  catch (_) {}
  return '';
}
function baseUrl() {
  const s = settings();
  let b = String(s.domain || s.url || SITE).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  return b;
}
function abs(base, u) {
  u = String(u || '').trim().replace(/\\\//g, '/');
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return base.replace(/\/+$/, '') + u;
  return base.replace(/\/+$/, '') + '/' + u;
}
function hostOrigin(u) {
  const m = /^(https?:\/\/[^/]+)/i.exec(u || '');
  return m ? m[1] : '';
}
function pageHeaders(ref) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7',
    'Referer': ref || SITE + '/'
  };
}
async function getText(url, headers) {
  const r = await fetch(url, { method: 'GET', headers: Object.assign({ 'User-Agent': UA }, headers || {}) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return await r.text();
}

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/i̇/g, 'i').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/&/g, ' ve ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function rot13(s) {
  return String(s || '').replace(/[a-zA-Z]/g, function(c) {
    const b = c <= 'Z' ? 65 : 97;
    return String.fromCharCode((c.charCodeAt(0) - b + 13) % 26 + b);
  });
}
function b64Text(s) {
  s = String(s || '').trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (s.length % 4) s += '=';
  try {
    if (typeof atob === 'function') {
      const bin = atob(s);
      let out = '';
      for (let i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i));
      try { return decodeURIComponent(escape(out)); } catch (_) { return out; }
    }
  } catch (_) {}
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
  } catch (_) {}
  return null;
}
function htmlDecode(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function tmdbInfo(id) {
  const key = tmdbKey();
  if (!key) { log('TMDB_API_KEY yok'); return null; }
  const out = { titles: [], year: null };
  for (const lang of ['tr-TR', 'en-US']) {
    try {
      const r = await fetch(TMDB + '/movie/' + id + '?api_key=' + encodeURIComponent(key) + '&language=' + lang);
      const j = await r.json();
      [j.title, j.original_title].forEach(function(t) {
        if (t && out.titles.indexOf(t) < 0) out.titles.push(t);
      });
      if (!out.year && j.release_date) out.year = parseInt(j.release_date.slice(0, 4), 10) || null;
    } catch (e) { log('TMDB', lang, String(e)); }
  }
  return out;
}

async function autocomplete(base, q) {
  const url = base + '/autocomplete/q.php?q=' + encodeURIComponent(q).replace(/%20/g, '%20') + '&callback=';
  try {
    let text = (await getText(url, {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': base + '/'
    })).trim();
    if (!(text.charAt(0) === '[' || text.charAt(0) === '{')) {
      const a = text.indexOf('('), b = text.lastIndexOf(')');
      if (a >= 0 && b > a) text = text.slice(a + 1, b).trim();
    }
    const root = JSON.parse(text);
    const arr = Array.isArray(root) ? root : [root];
    return arr.map(function(x) {
      const slug = String(x.dizilink || '').replace(/^\/+|\/+$/g, '');
      const prefix = String(x.prefix || 'film').replace(/^\/+|\/+$/g, '');
      return {
        title: String(x.baslik || ''),
        original: String(x.altbaslik || ''),
        year: parseInt(x.yil, 10) || null,
        url: /^https?:/i.test(slug) ? slug : base + '/' + prefix + '/' + slug + '/'
      };
    }).filter(function(x) { return x.url && /\/film\//i.test(x.url); });
  } catch (e) {
    log('autocomplete hata', q, String(e));
    return [];
  }
}

async function findMovie(base, info) {
  for (const title of info.titles) {
    const rows = await autocomplete(base, title);
    const want = norm(title);
    let best = null, score = -999;
    for (const r of rows) {
      const names = [norm(r.title), norm(r.original)];
      let s = names.some(function(n) { return n === want; }) ? 12 :
              names.some(function(n) { return n && (n.indexOf(want) >= 0 || want.indexOf(n) >= 0); }) ? 6 : -20;
      if (info.year && r.year) s += r.year === info.year ? 5 : Math.abs(r.year - info.year) <= 1 ? 2 : -8;
      if (s > score) { score = s; best = r; }
    }
    if (best && score > 0) {
      log('eşleşti', title, '->', best.url, 'score=' + score);
      return best.url;
    }
  }
  return null;
}

// scx = {...} bloğunu nested parantezlere zarar vermeden çıkar.
function extractObjectAfter(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const start = text.indexOf('{', m.index);
  if (start < 0) return null;
  let depth = 0, quote = '', esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function extractScxLinks(html) {
  const raw = extractObjectAfter(html, /(?:var\s+|let\s+|const\s+)?scx\s*=\s*\{/i);
  if (!raw) { log('SCX bulunamadı'); return []; }

  // Kotlin tarafındaki JSON gerçek JSON; yine de tek tırnak fallback'i tutuyoruz.
  let obj = null;
  try { obj = JSON.parse(raw); }
  catch (_) {
    try {
      const safer = raw.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
                       .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, function(_,x){ return ':' + JSON.stringify(x); });
      obj = JSON.parse(safer);
    } catch (e) { log('SCX JSON parse hata', String(e)); }
  }
  if (!obj) return [];

  const keys = ['atom','advid','advidprox','proton','fast','fastly','tr','en'];
  const out = [], seen = {};
  keys.forEach(function(key) {
    const t = obj[key] && obj[key].sx && obj[key].sx.t;
    const vals = [];
    if (Array.isArray(t)) t.forEach(function(v){ if (typeof v === 'string') vals.push([key,v]); });
    else if (t && typeof t === 'object') Object.keys(t).forEach(function(k){ if (typeof t[k] === 'string') vals.push([k,t[k]]); });
    vals.forEach(function(pair) {
      try {
        const decoded = b64Text(rot13(pair[1]));
        if (decoded && /^https?:|^\/\//i.test(decoded.trim())) {
          const u = decoded.trim().indexOf('//') === 0 ? 'https:' + decoded.trim() : decoded.trim();
          if (!seen[u]) { seen[u] = true; out.push({ key: pair[0], url: u }); }
        }
      } catch (_) {}
    });
  });
  log('SCX link', out.length);
  return out;
}

function normalizeB64(s) {
  s = String(s || '').trim().replace(/^["']|["']$/g, '').replace(/\\\//g, '/');
  s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  while (s.length % 4) s += '=';
  return s;
}

/*
 * RapidVid'in _p8 alanı zaman içinde birkaç biçim kullandı.
 * CS3 extractorünün "reversed" davranışını da kapsayacak şekilde adayları dener:
 * base64(p8), base64(reverse(p8)), reverse(base64(p8)), ayrıca URL-decoded biçimler.
 * Yalnız cm/tm veya media URL taşıyan geçerli JSON kabul edilir.
 */
function decodeP8(p8) {
  const inputs = [];
  const raw = htmlDecode(String(p8 || '').trim());
  inputs.push(raw);
  try { inputs.push(decodeURIComponent(raw)); } catch (_) {}
  inputs.push(raw.split('').reverse().join(''));

  const candidates = [];
  inputs.forEach(function(v) {
    const d = b64Text(normalizeB64(v));
    if (d) {
      candidates.push(d);
      candidates.push(d.split('').reverse().join(''));
      const d2 = b64Text(normalizeB64(d));
      if (d2) candidates.push(d2);
    }
    candidates.push(v);
  });

  for (let c of candidates) {
    c = String(c || '').trim().replace(/^\uFEFF/, '');
    const a = c.indexOf('{'), b = c.lastIndexOf('}');
    if (a >= 0 && b > a) c = c.slice(a, b + 1);
    try {
      const j = JSON.parse(c);
      if (j && (j.cm || j.tm || j.file || j.src || j.url || j.sources || j.tracks)) {
        log('_p8 JSON kabul', c.slice(0, 180));
        return j;
      }
    } catch (_) {}
  }
  return null;
}

function collectUrls(value, out) {
  if (value == null) return;
  if (typeof value === 'string') {
    let s = htmlDecode(value).replace(/\\\//g, '/').trim();
    if (/^https?:\/\//i.test(s) || s.indexOf('//') === 0) out.push(s.indexOf('//') === 0 ? 'https:' + s : s);
    return;
  }
  if (Array.isArray(value)) { value.forEach(function(v){ collectUrls(v,out); }); return; }
  if (typeof value === 'object') Object.keys(value).forEach(function(k){ collectUrls(value[k],out); });
}

function subtitleLabel(url, hint) {
  const s = (String(hint || '') + ' ' + String(url || '')).toLowerCase();
  if (/tur|türk|_tr|\/tr[._/-]/.test(s)) return 'Türkçe';
  if (/eng|english|_en|\/en[._/-]/.test(s)) return 'English';
  return hint || 'Altyazı';
}
function extractSubtitlesFromAny(root, embed) {
  const out = [], seen = {};
  function walk(v, keyHint) {
    if (v == null) return;
    if (typeof v === 'string') {
      let u = htmlDecode(v).replace(/\\\//g,'/');
      const m = /(https?:)?\/\/[^"'\s\\]+\.(?:vtt|srt)(?:\?[^"'\s\\]*)?/i.exec(u);
      if (m) {
        u = m[0].indexOf('//') === 0 ? 'https:' + m[0] : m[0];
        if (!seen[u]) { seen[u]=1; const l=subtitleLabel(u,keyHint); out.push({url:u,lang:l,name:l}); }
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach(function(x){ walk(x,keyHint); }); return; }
    if (typeof v === 'object') {
      const file = v.file || v.src || v.url;
      if (typeof file === 'string' && /\.(vtt|srt)(\?|$)/i.test(file)) {
        const u = abs(hostOrigin(embed), file);
        if (u && !seen[u]) {
          seen[u]=1; const l=subtitleLabel(u,v.label || v.lang || v.language || keyHint);
          out.push({url:u,lang:l,name:l});
        }
      }
      Object.keys(v).forEach(function(k){ walk(v[k], k); });
    }
  }
  walk(root,'');
  return out;
}

function qualityOf(u, hint) {
  const m = /(?:^|[^\d])(\d{3,4})p(?:[^\d]|$)/i.exec(String(hint || '') + ' ' + String(u || ''));
  return m ? m[1] + 'p' : 'Auto';
}

async function resolveRapidVid(url, detailUrl, sourceKey) {
  if (!/rapidvid\.(?:org|net)/i.test(url)) return [];
  const origin = hostOrigin(url);
  let html;
  try {
    html = await getText(url, pageHeaders(detailUrl));
  } catch (e) {
    log('RapidVid GET hata', String(e));
    return [];
  }

  if (!html) return [];
  const p8m = /(?:window\.)?_p8\s*=\s*"([^"]+)"/i.exec(html) ||
              /(?:window\.)?_p8\s*=\s*'([^']+)'/i.exec(html);
  if (!p8m) {
    log('RapidVid _p8 yok', url, 'len=' + html.length);
    return [];
  }

  const root = decodeP8(p8m[1]);
  if (!root) {
    log('RapidVid _p8 decode olmadı', 'len=' + p8m[1].length);
    return [];
  }

  const media = [];
  // CS3 extractorünün doğrulanmış ana alanları cm/tm.
  collectUrls(root.cm, media);
  collectUrls(root.tm, media);
  if (!media.length) {
    ['file','src','url','sources'].forEach(function(k){ collectUrls(root[k],media); });
  }

  const subtitles = extractSubtitlesFromAny(root, url);
  // HTML içinde düz VTT fallback.
  const re = /(?:https?:)?\/\/[^"'\s\\]+\.vtt(?:\?[^"'\s\\]*)?/gi;
  let sm;
  while ((sm = re.exec(html.replace(/\\\//g,'/')))) {
    const su = sm[0].indexOf('//') === 0 ? 'https:' + sm[0] : sm[0];
    if (!subtitles.some(function(s){return s.url===su;})) {
      const l=subtitleLabel(su,''); subtitles.push({url:su,lang:l,name:l});
    }
  }

  const uniq = media.filter(function(u,i,a){ return a.indexOf(u)===i; })
                    .filter(function(u){ return /\.m3u8(?:\?|$)/i.test(u) || /\/(?:m3u8|hls|master|playlist)\b/i.test(u); });

  log('RapidVid', sourceKey, 'master=' + uniq.length, 'subs=' + subtitles.length);
  return uniq.map(function(u) {
    return {
      name: 'FullHDFilmizlesene',
      title: 'FullHDFilmizlesene • ' + sourceKey,
      url: u,
      quality: qualityOf(u, sourceKey),
      type: 'hls',
      headers: {
        'User-Agent': UA,
        'Referer': url,
        'Origin': origin
      },
      subtitles: subtitles
    };
  });
}

async function linksFromMovie(base, movieUrl) {
  let html;
  try { html = await getText(movieUrl, pageHeaders(base + '/')); }
  catch (e) { log('detay alınamadı', String(e)); return []; }

  const players = extractScxLinks(html);
  if (!players.length) return [];

  const out = [];
  for (const p of players) {
    if (!/rapidvid\.(?:org|net)/i.test(p.url)) {
      log('kaynak atlandı', p.key, p.url);
      continue;
    }
    // CS3 aynı RapidVid kaynağını iki kez deneyebiliyordu; Nuvio'da tek retry.
    let links = await resolveRapidVid(p.url, movieUrl, p.key);
    if (!links.length) links = await resolveRapidVid(p.url, movieUrl, p.key);
    links.forEach(function(x){ out.push(x); });
  }
  const seen = {};
  return out.filter(function(x) {
    const k = x.url + '|' + x.title;
    if (seen[k]) return false;
    seen[k] = 1; return true;
  });
}

async function getStreams(tmdbId, mediaType, season, episode) {
  // Kaynak CS3 provider yalnız Movie destekliyor.
  if (mediaType === 'tv') {
    log('TV desteklenmiyor: kaynak FullHDFilmizlesene provider film-only');
    return [];
  }

  try {
    const base = baseUrl();
    const info = await tmdbInfo(tmdbId);
    if (!info || !info.titles.length) return [];

    const movie = await findMovie(base, info);
    if (!movie) {
      log('film bulunamadı', info.titles.join(' / '), info.year || '');
      return [];
    }

    const streams = await linksFromMovie(base, movie);
    log('bitti', streams.length + ' link');
    return streams;
  } catch (e) {
    log('genel hata', String(e && e.stack || e));
    return [];
  }
}

module.exports = { getStreams };
