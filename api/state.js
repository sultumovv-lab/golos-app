// Rezon — серверное хранилище прогресса (Supabase) с проверкой Telegram-личности.
// Клиент шлёт initData (подписан токеном бота) — мы проверяем подпись и работаем
// с базой через service_role. Никакого прямого доступа клиента к БД.
import crypto from 'node:crypto';

// Проверка подписи Telegram WebApp initData → возвращает user или null
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calc !== hash) return null;
    // свежесть (не старше 24ч)
    const authDate = Number(params.get('auth_date') || 0);
    if (authDate && Date.now() / 1000 - authDate > 86400) return null;
    return JSON.parse(params.get('user') || 'null');
  } catch (e) { return null; }
}

function sb(path, method, body) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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

  const { initData, action, profile, stats } = req.body || {};
  const user = verifyInitData(initData, process.env.BOT_TOKEN);
  if (!user || !user.id) return res.status(401).json({ error: 'unauthorized' });

  try {
    if (action === 'save') {
      await sb('users', 'POST', {
        tg_id: user.id, username: user.username || null, first_name: user.first_name || null,
        profile: profile || {}, stats: stats || {},
      });
      return res.json({ ok: true });
    }
    // load (по умолчанию)
    const r = await sb(`users?tg_id=eq.${user.id}&select=profile,stats`, 'GET');
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) {
      return res.json({ profile: rows[0].profile || {}, stats: rows[0].stats || {} });
    }
    // первого захода ещё нет — создаём пустую запись
    await sb('users', 'POST', {
      tg_id: user.id, username: user.username || null, first_name: user.first_name || null,
    });
    return res.json({ profile: {}, stats: {} });
  } catch (e) {
    console.error('state error', e);
    res.status(500).json({ error: 'state failed' });
  }
}
