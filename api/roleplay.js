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
  "opener": "Первая реплика собеседника, с которой начинается разговор",
  "mode": "ОДИН из: persuade (надо убедить/отстоять — переговоры, просьба, спор), difficult (сложный эмоциональный разговор, цель — понять друг друга), connect (расположить, сблизиться — знакомство, свидание), support (поддержать, выслушать того, кому тяжело) — выбери по сути ситуации"
}`;
  } else if (phase === 'feedback') {
    maxTokens = 800;
    const metricsByMode = {
      persuade:  ['Ясность','Уверенность','Убедительность'],
      difficult: ['Эмпатия','Ясность','Такт'],
      connect:   ['Теплота','Искренность','Слушание'],
      support:   ['Эмпатия','Присутствие','Бережность'],
    };
    const labels = metricsByMode[scenario.mode] || metricsByMode.persuade;
    system = `Ты — Алмат, коуч по коммуникации в приложении Rezon. Пользователь прошёл ролевой разговор.
Ситуация: "${scenario.situation}". Собеседник: "${scenario.role}". Цель разговора (режим): ${scenario.mode || 'persuade'}.
Оцени, КАК пользователь вёл разговор ИМЕННО ПОД ЕГО ЦЕЛЬ. Важно: в тёплом/поддерживающем разговоре «продавить» или сыпать советами — это провал, а услышать и проявить тепло — успех. Не подходи ко всему как к спору.
Верни ТОЛЬКО валидный JSON без markdown:
{
  "outcome": "Короткий вердикт исхода под цель разговора, по-русски (напр.: «Договорились», «Вы стали ближе», «Собеседник закрылся», «Удалось расположить», «Тебя пока не взяли»)",
  "outcomeEmoji": "✅ если цель достигнута, ⚠️ если частично, ❌ если нет",
  "scores": [ {"label":"${labels[0]}","value":0}, {"label":"${labels[1]}","value":0}, {"label":"${labels[2]}","value":0} ],
  "feedback": "Тёплый, но честный разбор на «ты»: 2 сильные стороны и 2 зоны роста с конкретным примером — КАК можно было сказать иначе под цель этого разговора. 2–3 коротких абзаца, без markdown."
}
В scores значения value — числа 0–100, label оставь ровно как заданы.`;
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
    const behavior = {
      persuade:  'Ты сопротивляешься: возражаешь, давишь, ищешь слабые места. Цель пользователя — тебя убедить; легко не поддавайся.',
      difficult: 'Тема болезненная, ты задет и защищаешься. Но ты живой человек: если пользователь говорит с тактом, слушает и признаёт твои чувства — ты смягчаешься; если давит, обвиняет или холоден — закрываешься или вспыхиваешь. Цель разговора — взаимопонимание, а НЕ победа.',
      connect:   'Ты доброжелателен и открыт, но чувствителен к вниманию: на искренний интерес, вопросы и теплоту — раскрываешься, тебе приятно; на эгоцентризм, неловкость или сухость — становишься прохладнее. Это НЕ спор.',
      support:   'Тебе тяжело, ты делишься переживаниями. На внимательное слушание, сочувствие и принятие — тебе становится легче, ты раскрываешься. На споры, непрошеные советы или обесценивание — закрываешься и отдаляешься. Тебе нужно понимание, а НЕ решения.',
    };
    system = `Ты играешь роль собеседника в тренажёре общения Rezon. Твоя роль: "${scenario.role}". Ситуация: "${scenario.situation}".
Ты начал диалог фразой: "${scenario.opener}".
Модель поведения (цель разговора): ${behavior[scenario.mode] || behavior.persuade}
Правила:
— Оставайся строго В РОЛИ, говори как живой человек, по-русски.
— Реплики короткие, 1–3 предложения, как в настоящем разговоре.
— Реагируй на КАЖДУЮ реплику пользователя по модели поведения выше — твоё отношение меняется от того, КАК он говорит.
— НЕ подсказывай, НЕ оценивай и НЕ выходи из роли (разбор будет в конце).`;
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
