// Rezon — голосовой дневник: загрузка записей «до/после» в Supabase Storage
// (приватный бакет "voices") + выдача временных подписанных ссылок на прослушивание.
// Личность проверяется по Telegram initData, как в /api/state.
import crypto from 'node:crypto';

function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    if (calc !== hash) return null;
    const authDate = Number(params.get('auth_date') || 0);
    if (authDate && Date.now() / 1000 - authDate > 86400) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch (e) { return null; }
}

const BUCKET = 'voices';
function sbHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(501).json({ error: 'storage not configured' });
  }

  const { initData, action, exId, phase, audio, mime } = req.body || {};
  const user = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!user || !user.id) return res.status(401).json({ error: 'unauthorized' });
  const base = process.env.SUPABASE_URL;

  try {
    if (action === 'upload') {
      if (!audio) return res.status(400).json({ error: 'no audio' });
      const buffer = Buffer.from(audio, 'base64');
      if (buffer.length > 3_000_000) return res.status(413).json({ error: 'too large' });
      const safePhase = ['before', 'after', 'baseline'].includes(phase) ? phase : 'rec';
      const path = `${user.id}/${Date.now()}_${(exId || 'x').replace(/[^\w]/g, '')}_${safePhase}.webm`;

      const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: sbHeaders({ 'Content-Type': mime || 'audio/webm', 'x-upsert': 'true' }),
        body: buffer,
      });
      if (!up.ok) { const t = await up.text(); console.error('storage upload', up.status, t); return res.status(502).json({ error: 'upload failed' }); }

      await fetch(`${base}/rest/v1/voices`, {
        method: 'POST',
        headers: sbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tg_id: user.id, ex_id: exId || null, phase: safePhase, path }),
      });
      return res.json({ ok: true, path });
    }

    // list: записи пользователя + временные ссылки на прослушивание
    const r = await fetch(`${base}/rest/v1/voices?tg_id=eq.${user.id}&select=ex_id,phase,path,created_at&order=created_at.desc&limit=60`, { headers: sbHeaders() });
    const rows = await r.json();
    const items = [];
    for (const row of (Array.isArray(rows) ? rows : [])) {
      try {
        const s = await fetch(`${base}/storage/v1/object/sign/${BUCKET}/${row.path}`, {
          method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ expiresIn: 3600 }),
        });
        const sj = await s.json();
        const url = sj.signedURL ? `${base}/storage/v1${sj.signedURL}` : null;
        items.push({ exId: row.ex_id, phase: row.phase, created_at: row.created_at, url });
      } catch (e) { /* пропускаем недоступную */ }
    }
    return res.json({ items });
  } catch (e) {
    console.error('voice error', e);
    res.status(500).json({ error: 'voice failed' });
  }
}
