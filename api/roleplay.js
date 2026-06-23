// AI-ролевые игры Rezon: Claude играет роль собеседника, в конце — разбор от Алмата.
// phase: 'converse' (ведёт диалог в роли) | 'feedback' (разбирает, как пользователь общался)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { scenario, messages, phase } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages required' });
  }
  if (phase !== 'build' && !scenario) {
    return res.status(400).json({ error: 'scenario required' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  let system, maxTokens;
  if (phase === 'build') {
    // «Твоя ситуация»: из описания пользователя собрать персонажа и сценарий
    maxTokens = 500;
    system = `Ты — Алмат, коуч по коммуникации в Rezon. Пользователь описал реальную ситуацию, к которой готовится. Собери под неё ролевой тренажёр.
Придумай ОДНОГО собеседника (имя, краткая роль, характер/мотив) и его первую реплику, чтобы пользователь сразу попал в разговор.
Верни ТОЛЬКО валидный JSON без markdown:
{
  "title": "Короткое название тренировки, 2–4 слова",
  "situation": "Одно предложение — суть ситуации, на «ты»",
  "persona": { "name": "Имя собеседника", "role": "краткая роль (1–3 слова)", "agenda": "характер и мотив собеседника — как его отыгрывать", "face": "один эмодзи лица" },
  "opener": "Первая реплика собеседника, с которой начинается разговор"
}`;
  } else if (phase === 'feedback') {
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
  } else if (Array.isArray(scenario.personas) && scenario.personas.length) {
    // мульти-персонаж «совещание»
    maxTokens = 400;
    const list = scenario.personas.map(p => `- ${p.id} | ${p.name}, ${p.role}: ${p.agenda}`).join('\n');
    system = `Ты ведёшь ролевое СОВЕЩАНИЕ в тренажёре общения Rezon. Ситуация: "${scenario.situation}".
Участники со стороны собеседника, у каждого свой мотив:
${list}
Пользователь обращается к совещанию. Ответь ОТ ИМЕНИ ОДНОГО участника — того, кто естественнее всего среагирует с учётом своего мотива и последней реплики пользователя. Хорошо, когда инициативу перехватывают разные участники, а не один и тот же.
Реплика короткая (1–3 предложения), строго в характере, по-русски; можно возражать и давить.
Верни ТОЛЬКО валидный JSON без markdown: {"speaker":"<id участника>","text":"<реплика>"}`;
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
    if (phase === 'build' || phase === 'feedback') {
      const s = text.indexOf('{'), e = text.lastIndexOf('}');
      if (s === -1 || e === -1) throw new Error('no json');
      return res.json(JSON.parse(text.slice(s, e + 1)));
    }
    if (Array.isArray(scenario.personas) && scenario.personas.length) {
      const s = text.indexOf('{'), e = text.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        try { const o = JSON.parse(text.slice(s, e + 1)); return res.json({ speaker: o.speaker, text: o.text || text }); } catch (_) {}
      }
      return res.json({ text });   // фолбэк без speaker
    }
    res.json({ text });
  } catch (error) {
    console.error('Roleplay error:', error);
    res.status(502).json({ error: 'Roleplay failed' });
  }
}
