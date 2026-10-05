/**
 * Dizipal — Nuvio eklentisi (PuuStream)
 *
 * CS3 "Dizipal" (com.keyiflerolsun) eklentisinin link bulma kısmının JavaScript karşılığı.
 * Nuvio bize sadece TMDB numarası + sezon + bölüm verir; zinciri biz kurarız:
 *
 *   1. TMDB → Türkçe ad, orijinal ad, yıl
 *   2. Dizipal arama:  GET /ajax-search?q=…   → {results:[{title,url,type,year}]}
 *   3. Film → sayfa; Dizi → /bolum/{slug}-{S}-sezon-{E}-bolum
 *   4. Sayfadaki  data-cfg="…"
 *   5. GET  /ajax-token                (oturum çerezi)
 *   6. POST /ajax-player-config  cfg=… → {config:{t,v}, enc:{c,iv,k1,k2}}
 *   7. enc → AES-CBC çöz (anahtar: k1 XOR k2, yoksa k1, yoksa k2) → embed linki
 *   8. Embed sayfası → m3u8 + altyazılar (vtt/srt)
 *
 * Alan adı sık değişiyor (dizipal2135.com …). Ayarlardan "domain" verilirse o kullanılır;
 * verilmezse varsayılan adrese gidilir ve yönlendirme varsa yeni adres otomatik bulunur.
 */

const DEFAULT_DOMAIN = 'https://dizipal2135.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const TMDB = 'https://api.themoviedb.org/3';

// ------------------------------------------------------------------ yardımcılar
function settings() {
  try {
    return (typeof SCRAPER_SETTINGS !== 'undefined' && SCRAPER_SETTINGS) || {};
  } catch (e) {
    return {};
  }
}

function tmdbKey() {
  try {
    if (typeof TMDB_API_KEY !== 'undefined' && TMDB_API_KEY) return TMDB_API_KEY;
  } catch (e) {}
  return '';
}

function log() {
  try { console.log.apply(console, ['[Dizipal]'].concat([].slice.call(arguments))); } catch (e) {}
}

/** Çerezleri elle de taşı (bazı Nuvio sürümlerinde fetch çerez saklamıyor). Site başına ayrı. */
const jar = {};
function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url || '');
  return m ? m[1].toLowerCase() : '';
}
function storeCookies(url, res) {
  try {
    const raw = res.headers && (res.headers.get('set-cookie') || '');
    if (!raw) return;
    const box = jar[hostOf(url)] = jar[hostOf(url)] || {};
    raw.split(/,(?=\s*[^;,=\s]+=)/).forEach(function (part) {
      const kv = part.split(';')[0].trim();
      const i = kv.indexOf('=');
      if (i > 0) box[kv.slice(0, i)] = kv.slice(i + 1);
    });
  } catch (e) {}
}
function cookieHeader(url) {
  const box = jar[hostOf(url)] || {};
  return Object.keys(box).map(function (k) { return k + '=' + box[k]; }).join('; ');
}

async function request(url, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'User-Agent': UA }, opts.headers || {});
  const ck = cookieHeader(url);
  if (ck && !headers.Cookie) headers.Cookie = ck;
  const res = await fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body });
  storeCookies(url, res);
  return res;
}

function pageHeaders(referer) {
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7',
    'Referer': referer,
  };
}

function ajaxHeaders(base, referer) {
  return {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': base,
    'Referer': referer,
  };
}

function abs(base, u) {
  if (!u) return null;
  u = String(u).trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.charAt(0) === '/') return base + u;
  return base + '/' + u;
}

/** Türkçe karakterleri sadeleştirip karşılaştırma için normalize eder. */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/i̇/g, 'i').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/&/g, ' ve ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ------------------------------------------------------------------ base64 / AES
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64ToBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    buf = (buf << 6) | B64.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}
function bytesToHex(bytes) {
  let h = '';
  for (let i = 0; i < bytes.length; i++) h += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return h;
}

function aesCbc(cBytes, keyBytes, ivBytes) {
  try {
    const CJ = (typeof CryptoJS !== 'undefined' && CryptoJS) || require('crypto-js');
    const params = CJ.lib.CipherParams.create({ ciphertext: CJ.enc.Hex.parse(bytesToHex(cBytes)) });
    const dec = CJ.AES.decrypt(params, CJ.enc.Hex.parse(bytesToHex(keyBytes)), {
      iv: CJ.enc.Hex.parse(bytesToHex(ivBytes)),
      mode: CJ.mode.CBC,
      padding: CJ.pad.Pkcs7,
    });
    return dec.toString(CJ.enc.Utf8);
  } catch (e) {
    return null;
  }
}

/** CS3'teki decryptEnc(): anahtar adayları k1^k2, k1, k2 (16/24/32 bayt). */
function decryptEnc(enc) {
  if (!enc || !enc.c || !enc.iv) return null;
  const c = b64ToBytes(enc.c);
  const iv = b64ToBytes(enc.iv);
  const keys = [];
  const a = enc.k1 ? b64ToBytes(enc.k1) : null;
  const b = enc.k2 ? b64ToBytes(enc.k2) : null;
  if (a && b && a.length === b.length) keys.push(a.map(function (x, i) { return x ^ b[i]; }));
  if (a) keys.push(a);
  if (b) keys.push(b);
  for (const k of keys) {
    if ([16, 24, 32].indexOf(k.length) < 0) continue;
    const out = (aesCbc(c, k, iv) || '').trim();
    if (out && (out.indexOf('http') === 0 || out.indexOf('//') === 0 || out.charAt(0) === '{')) return out;
  }
  return null;
}

// ------------------------------------------------------------------ alan adı
async function resolveBase() {
  const s = settings();
  let base = (s.domain || s.url || DEFAULT_DOMAIN).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) base = 'https://' + base;
  try {
    const res = await request(base + '/', { headers: pageHeaders(base + '/') });
    const finalUrl = res.url || '';
    const m = /^(https?:\/\/[^/]+)/i.exec(finalUrl);
    if (m && m[1] !== base) {
      log('yeni alan adı', m[1]);
      base = m[1];
    }
  } catch (e) {
    log('ana sayfa açılamadı', String(e));
  }
  return base;
}

// ------------------------------------------------------------------ TMDB
async function tmdbInfo(tmdbId, mediaType) {
  const key = tmdbKey();
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const out = { titles: [], year: null };
  async function get(lang) {
    const res = await fetch(TMDB + '/' + type + '/' + tmdbId + '?api_key=' + key + '&language=' + lang);
    return res.json();
  }
  try {
    const tr = await get('tr-TR');
    const t1 = type === 'tv' ? tr.name : tr.title;
    const t2 = type === 'tv' ? tr.original_name : tr.original_title;
    if (t1) out.titles.push(t1);
    if (t2 && out.titles.indexOf(t2) < 0) out.titles.push(t2);
    const d = (type === 'tv' ? tr.first_air_date : tr.release_date) || '';
    out.year = parseInt(d.slice(0, 4), 10) || null;
    const en = await get('en-US');
    const t3 = type === 'tv' ? en.name : en.title;
    if (t3 && out.titles.indexOf(t3) < 0) out.titles.push(t3);
  } catch (e) {
    log('TMDB hatası', String(e));
  }
  return out;
}

// ------------------------------------------------------------------ arama
async function search(base, query) {
  try {
    const res = await request(base + '/ajax-search?q=' + encodeURIComponent(query), {
      headers: ajaxHeaders(base, base + '/'),
    });
    const j = await res.json();
    return (j && j.results ? j.results : []).map(function (r) {
      return {
        title: r.title || '',
        url: abs(base, r.url),
        year: parseInt(r.year, 10) || null,
        isMovie: /\/film\//.test(r.url || '') || String(r.type || '').toLowerCase() === 'film',
      };
    }).filter(function (r) { return r.url; });
  } catch (e) {
    log('ajax-search olmadı, /arama deneniyor', String(e));
  }
  // Yedek: HTML arama sayfası (article.content-card)
  try {
    const res = await request(base + '/arama?q=' + encodeURIComponent(query), { headers: pageHeaders(base + '/') });
    const $ = require('cheerio-without-node-native').load(await res.text());
    const out = [];
    $('article.content-card').each(function (_, el) {
      const a = $(el).find('a.card-link, a[href]').first();
      const href = abs(base, a.attr('href'));
      if (!href) return;
      const title = ($(el).find('.card-title').text() || $(el).find('img').attr('alt') || '').trim();
      const year = parseInt(($(el).find('.card-year').text() || '').trim(), 10) || null;
      out.push({ title: title, url: href, year: year, isMovie: /\/film\//.test(href) });
    });
    return out;
  } catch (e) {
    log('arama hatası', String(e));
    return [];
  }
}

/** TMDB adlarıyla arar, tür + ad + yıl tutan en iyi sonucu seçer. */
async function findPage(base, info, isMovie) {
  for (const t of info.titles) {
    const results = (await search(base, t)).filter(function (r) { return r.isMovie === isMovie; });
    if (!results.length) continue;
    const want = norm(t);
    let best = null, bestScore = -1;
    for (const r of results) {
      let score = 0;
      const n = norm(r.title);
      if (n === want) score += 10;
      else if (n.indexOf(want) >= 0 || want.indexOf(n) >= 0) score += 5;
      else continue;
      if (info.year && r.year) {
        if (r.year === info.year) score += 4;
        else if (Math.abs(r.year - info.year) <= 1) score += 2;
        else score -= 6;
      }
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (best && bestScore > 0) {
      log('eşleşti', t, '→', best.url);
      return best.url;
    }
  }
  return null;
}

/** Dizi sayfasından S/E bölüm linkini bulur; bulamazsa slug'dan tahmin eder. */
async function findEpisode(base, seriesUrl, season, episode) {
  const re = new RegExp('/bolum/(.+?)-' + season + '-sezon-' + episode + '-bolum/?(?:[?#].*)?$', 'i');
  try {
    const res = await request(seriesUrl, { headers: pageHeaders(base + '/') });
    const html = await res.text();
    const $ = require('cheerio-without-node-native').load(html);
    let found = null;
    $('a[href*="/bolum/"]').each(function (_, a) {
      const href = abs(base, $(a).attr('href'));
      if (!found && href && re.test(href)) found = href;
    });
    if (found) return found;
  } catch (e) {
    log('dizi sayfası açılamadı', String(e));
  }
  // Tahmin: /dizi/{slug} → /bolum/{slug}-{S}-sezon-{E}-bolum
  const m = /\/dizi\/([^/?#]+)/i.exec(seriesUrl);
  return m ? base + '/bolum/' + m[1] + '-' + season + '-sezon-' + episode + '-bolum' : null;
}

// ------------------------------------------------------------------ oynatıcı
const M3U8_RE = /["']?(?:file|src|source)["']?\s*:\s*["']([^"']+\.m3u8[^"']*)["']/gi;
const ANY_M3U8_RE = /https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/gi;
const TRACK_RE = /\{[^{}]*?["']?file["']?\s*:\s*["']([^"']+\.(?:vtt|srt)[^"']*)["'][^{}]*?\}/gi;
const LABEL_RE = /["']?label["']?\s*:\s*["']([^"']+)["']/i;
const KIND_RE = /["']?kind["']?\s*:\s*["']([^"']+)["']/i;

function langLabel(raw, url) {
  const l = String(raw || '').trim();
  const key = (l + ' ' + url).toLowerCase();
  if (key.indexOf('tur') >= 0 || key.indexOf('türk') >= 0 || key.indexOf('_tr') >= 0) return 'Türkçe';
  if (key.indexOf('eng') >= 0 || key.indexOf('_en') >= 0) return 'English';
  return l || 'Altyazı';
}

function qualityOf(url) {
  const m = /(\d{3,4})p/i.exec(url);
  return m ? m[1] + 'p' : 'Auto';
}

/** Embed sayfasından m3u8 ve altyazıları çıkarır (CS3'teki resolveEmbed). */
async function resolveEmbed(embed, pageUrl, label) {
  const streams = [];
  try {
    const res = await request(embed, { headers: pageHeaders(pageUrl) });
    const text = (await res.text()).replace(/\\\//g, '/');
    const origin = (/^(https?:\/\/[^/]+)/i.exec(embed) || [])[1] || '';

    const subtitles = [];
    const seenSub = {};
    let m;
    TRACK_RE.lastIndex = 0;
    while ((m = TRACK_RE.exec(text))) {
      const obj = m[0];
      const kind = (KIND_RE.exec(obj) || [])[1] || '';
      if (/thumb|chapter/i.test(kind)) continue;
      let u = m[1];
      if (u.indexOf('//') === 0) u = 'https:' + u;
      if (seenSub[u]) continue;
      seenSub[u] = true;
      const lang = langLabel((LABEL_RE.exec(obj) || [])[1], u);
      subtitles.push({ url: u, lang: lang, name: lang });
    }

    const urls = [];
    M3U8_RE.lastIndex = 0;
    while ((m = M3U8_RE.exec(text))) urls.push(m[1]);
    ANY_M3U8_RE.lastIndex = 0;
    while ((m = ANY_M3U8_RE.exec(text))) urls.push(m[0]);
    const uniq = urls.map(function (u) { return u.indexOf('//') === 0 ? 'https:' + u : u; })
      .filter(function (u, i, arr) { return /^https?:/.test(u) && arr.indexOf(u) === i; });

    for (const u of uniq) {
      streams.push({
        name: 'Dizipal',
        title: label + (subtitles.some(function (s) { return s.lang === 'Türkçe'; }) ? ' • TR altyazı' : ''),
        url: u,
        quality: qualityOf(u),
        type: 'hls',
        headers: { 'User-Agent': UA, 'Referer': embed, 'Origin': origin },
        subtitles: subtitles,
      });
    }
    log('embed', embed, 'streams=' + streams.length, 'subs=' + subtitles.length);
  } catch (e) {
    log('embed hatası', embed, String(e));
  }
  return streams;
}

async function linksFromPage(base, pageUrl, label) {
  const res = await request(pageUrl, { headers: pageHeaders(base + '/') });
  const html = await res.text();
  const cfgMatch = /data-cfg\s*=\s*["']([^"']+)["']/i.exec(html);
  if (!cfgMatch) {
    log('data-cfg yok', pageUrl);
    return [];
  }
  const cfg = cfgMatch[1].trim();

  try {
    await request(base + '/ajax-token', { headers: ajaxHeaders(base, pageUrl) });
  } catch (e) {}

  const cfgRes = await request(base + '/ajax-player-config', {
    method: 'POST',
    headers: Object.assign(ajaxHeaders(base, pageUrl), {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    }),
    body: 'cfg=' + encodeURIComponent(cfg),
  });
  const root = await cfgRes.json();
  if (!root || root.success === false) {
    log('player-config başarısız', JSON.stringify(root || {}).slice(0, 200));
    return [];
  }

  const targets = [];
  const decrypted = decryptEnc(root.enc);
  if (decrypted) {
    if (decrypted.charAt(0) === '{') {
      try {
        const j = JSON.parse(decrypted);
        ['url', 'src', 'file', 'embed', 'v'].forEach(function (k) { if (j[k]) targets.push(String(j[k])); });
      } catch (e) {}
    } else {
      targets.push(decrypted);
    }
  }
  const direct = String((root.config && root.config.v) || '').replace(/\\\//g, '/');
  if (/^https?:/.test(direct)) targets.push(direct);

  const out = [];
  const seen = {};
  for (let t of targets) {
    if (t.indexOf('//') === 0) t = 'https:' + t;
    if (seen[t]) continue;
    seen[t] = true;
    if (/\.m3u8/i.test(t)) {
      out.push({
        name: 'Dizipal',
        title: label,
        url: t,
        quality: qualityOf(t),
        type: 'hls',
        headers: { 'User-Agent': UA, 'Referer': pageUrl },
      });
    } else {
      const s = await resolveEmbed(t, pageUrl, label);
      for (const x of s) out.push(x);
    }
  }
  return out;
}

// ------------------------------------------------------------------ Nuvio giriş noktası
async function getStreams(tmdbId, mediaType, season, episode) {
  const isMovie = mediaType !== 'tv';
  try {
    const base = await resolveBase();
    const info = await tmdbInfo(tmdbId, mediaType);
    if (!info.titles.length) return [];

    const page = await findPage(base, info, isMovie);
    if (!page) {
      log('Dizipal\'da bulunamadı', info.titles.join(' / '));
      return [];
    }

    let target = page;
    let label = info.titles[0];
    if (!isMovie) {
      target = await findEpisode(base, page, season, episode);
      if (!target) return [];
      label += ' S' + season + 'E' + episode;
    }
    const streams = await linksFromPage(base, target, label);
    log('bitti', streams.length + ' link');
    return streams;
  } catch (e) {
    log('genel hata', String(e && e.stack || e));
    return [];
  }
}

module.exports = { getStreams };
