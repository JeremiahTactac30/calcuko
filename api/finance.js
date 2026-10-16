// Vercel serverless function: private cloud sync for the Finance Tracker.
//
// Everything is private: no passcode = no access.
// Environment variables (Vercel > Settings > Environment Variables):
//   FINANCE_PASSCODE   your passcode (falls back to PLANNER_PASSCODE if you already have one)
//   KV_REST_API_URL, KV_REST_API_TOKEN   added when you connect an Upstash Redis database
//                                        (UPSTASH_REDIS_REST_URL / _TOKEN also work)
//
// Storage: the whole data file is saved in Redis in small chunks, plus a "meta" record
// holding the current revision number. A save must say which revision it started from;
// if another device saved in the meantime, the server answers 409 instead of overwriting.
const crypto = require('crypto');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const PASSCODE = process.env.FINANCE_PASSCODE || process.env.PLANNER_PASSCODE;
const META = 'finance-tracker:meta';
const CHUNK = 250000;            // characters per Redis value (stays far below Upstash's 1 MB limit)
const MAX_TOTAL = 4000000;       // Vercel allows ~4.5 MB request bodies

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || 'redis error');
  return j.result;
}
function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
async function readMeta() {
  const raw = await redis(['GET', META]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!PASSCODE || !REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'not_configured' });
  const given = req.headers['x-passcode'] || '';
  if (!given || !same(given, PASSCODE)) return res.status(401).json({ error: 'bad_passcode' });

  try {
    const meta = await readMeta();                       // { rev, n, t } or null
    if (req.method === 'GET') {
      const wantMeta = String((req.query && req.query.meta) || '') === '1';
      if (!meta) return res.status(200).json({ rev: 0, data: null });
      if (wantMeta) return res.status(200).json({ rev: meta.rev, t: meta.t });
      let data = '';
      for (let i = 0; i < meta.n; i++) {
        const part = await redis(['GET', 'finance-tracker:' + meta.rev + ':' + i]);
        if (part == null) return res.status(500).json({ error: 'incomplete_data' });
        data += part;
      }
      return res.status(200).json({ rev: meta.rev, t: meta.t, data: data });
    }
    if (req.method === 'PUT') {
      const body = readBody(req);
      if (!body || body.length > MAX_TOTAL) return res.status(413).json({ error: 'too_large' });
      try { const o = JSON.parse(body); if (!o || o.v !== 1 || !Array.isArray(o.txns)) throw 0; }
      catch (e) { return res.status(400).json({ error: 'bad_data' }); }
      const base = parseInt(req.headers['x-base-rev'] || '0', 10) || 0;
      const current = meta ? meta.rev : 0;
      if (base !== current) return res.status(409).json({ error: 'conflict', rev: current });
      const rev = Math.max(current + 1, Date.now());
      const n = Math.ceil(body.length / CHUNK);
      for (let i = 0; i < n; i++) {
        await redis(['SET', 'finance-tracker:' + rev + ':' + i, body.slice(i * CHUNK, (i + 1) * CHUNK)]);
      }
      await redis(['SET', META, JSON.stringify({ rev: rev, n: n, t: Date.now() })]);   // switch over last
      if (meta) for (let i = 0; i < meta.n; i++) await redis(['DEL', 'finance-tracker:' + meta.rev + ':' + i]);
      return res.status(200).json({ rev: rev });
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
};
