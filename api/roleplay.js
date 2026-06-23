// AI-ролевые игры Rezon: Claude играет роль собеседника, в конце — разбор от Алмата.
// phase: 'converse' (ведёт диалог в роли) | 'feedback' (разбирает, как пользователь общался)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { scenario, messages, phase } = req.body || {};
  if (!scenario || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'scenario and messages required' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  let system, maxTokens;
  if (phase === 'feedback') {
    maxTokens = 800;
    system = `Ты — Алмат, коуч по голосу и коммуникации в приложении Rezon. Пользователь только что прошёл ролевую тренировку.
Ситуация: "${scenario.situation}". Ты играл роль: "${scenario.role}".
Оцени, КАК пользователь общался по тексту его реплик: содержание, уверенность, структура мысли, убедительность, работа с возражениями.
Верни ТОЛЬКО валидный JSON (без markdown, без текста вокруг) строго такой формы:
{
  "outcome": "Короткий вердикт исхода разговора от лица ситуации, по-русски (например: «Совет почти убеждён», «Тебя пока не взяли», «Сделка под вопросом», «Произвёл сильное впечатление»)",
  "outcomeEmoji": "один эмодзи: ✅ если в целом успех, ⚠️ если спорно, ❌ если не убедил",
  "scores": { "clarity": 0-100, "confidence": 0-100, "persuasion": 0-100 },
  "feedback": "Тёплый, но честный разбор на «ты»: 2 сильные стороны и 2 зоны роста с конкретным примером — КАК можно было переформулировать. 2–3 коротких абзаца, без markdown."
}`;
  } else {
    maxTokens = 350;
    system = `Ты играешь роль собеседника в тренажёре общения Rezon. Твоя роль: "${scenario.role}". Ситуация: "${scenario.situation}".
Ты начал диалог фразой: "${scenario.opener}".
Правила:
— Оставайся строго В РОЛИ, говори как живой человек, по-русски.
— Реплики короткие, 1–3 предложения, как в настоящем разговоре.
— Реагируй на ответ пользователя: уточняй, возражай, мягко дави — как поступил бы реальный собеседник в этой ситуации.
— НЕ подсказывай, НЕ оценивай и НЕ выходи из роли (разбор будет отдельно в конце).`;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system,
        messages,
      }),
    });
    const data = await response.json();
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error('empty response');
    if (phase === 'feedback') {
      const s = text.indexOf('{'), e = text.lastIndexOf('}');
      if (s === -1 || e === -1) throw new Error('no json in feedback');
      return res.json(JSON.parse(text.slice(s, e + 1)));
    }
    res.json({ text });
  } catch (error) {
    console.error('Roleplay error:', error);
    res.status(502).json({ error: 'Roleplay failed' });
  }
}
