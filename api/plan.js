// Генерация персонального плана Rezon на основе онбординг-теста.
// Принимает ответы теста + каталог упражнений, возвращает структурированный план.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { answers, catalog } = req.body || {};
  if (!answers || !Array.isArray(catalog) || !catalog.length) {
    return res.status(400).json({ error: 'answers and catalog required' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const system = `Ты — Алмат, методист и коуч по голосу в приложении Rezon. Твоя задача — составить персональный план тренировок по результатам короткого теста.

Методологическая база, на которую ты опираешься:
- Сценическая речь и актёрское мастерство: дыхательная опора (диафрагма), резонаторы, артикуляция.
- Ораторское искусство: структура убедительной речи, паузы, темп, интонирование.
- Психология уверенности: работа со страхом, телесными зажимами, тревогой перед выступлением.

Правила построения плана:
1. По ответам определи 1–2 ГЛАВНЫХ фокуса (не распыляйся на всё сразу).
2. Подбери упражнения СТРОГО из переданного каталога (используй только существующие id) — релевантные выбранным фокусам.
3. Выстрой прогрессию: от базы (дыхание/разогрев) к более сложному. Дыхательная опора почти всегда идёт в начале.
4. Учитывай опыт (новичок → проще и меньше) и доступное время в день.
5. Сроки результата давай ЧЕСТНО, не обещай быстрых чудес:
   - база/привычка — 2–3 недели; заметные изменения — 6–8 недель; устойчивый навык — 3–4 месяца.
   Корректируй формулировки под серьёзность проблемы и частоту занятий.
6. intro — тёплое личное обращение на «ты», 2–3 предложения, по-русски, без воды и канцелярита.

Верни ТОЛЬКО валидный JSON (без markdown, без пояснений, без текста вокруг) строго такой формы:
{
  "focuses": ["Короткий фокус 1", "Короткий фокус 2"],
  "focusCats": ["id_категории", "..."],
  "queue": ["id_упражнения", "..."],
  "timeframe": { "habit": "2–3 недели", "visible": "6–8 недель", "mastery": "3–4 месяца" },
  "intro": "Личное обращение."
}`;

  const userMsg = `Ответы теста:
- Главная проблема с голосом: ${answers.problem}
- Где подводит чаще: ${answers.situation}
- Скоро важное событие: ${answers.event}
- Опыт занятий: ${answers.experience}
- Время в день: ${answers.time}

Каталог упражнений (id — название — категория — сложность — минуты):
${catalog.map(e => `${e.id} — ${e.title} — ${e.catName || e.cat} — ${e.diff} — ${e.mins}м`).join('\n')}

Составь план: 8–10 упражнений в очереди в правильном порядке прохождения.`;

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
        max_tokens: 900,
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    const data = await response.json();
    const text = data?.content?.[0]?.text || '';
    // вытаскиваем JSON даже если модель обернула его в текст/«```»
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('no json in response');
    const plan = JSON.parse(text.slice(start, end + 1));

    // валидация id очереди по каталогу
    const ids = new Set(catalog.map(e => e.id));
    plan.queue = Array.isArray(plan.queue) ? plan.queue.filter(id => ids.has(id)) : [];
    if (plan.queue.length < 3) throw new Error('queue too short');

    res.json(plan);
  } catch (error) {
    console.error('Plan generation error:', error);
    res.status(502).json({ error: 'Plan generation failed' });
  }
}
