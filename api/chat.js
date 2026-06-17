export default async function handler(req, res) {
  // CORS headers for Telegram Mini App
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'Messages required' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
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
        max_tokens: 1000,
        system: `Ты профессиональный коуч по голосу, речи и уверенности. 
Часть приложения "Голос на миллион" — тренажёра для развития коммуникации.

Правила:
- Отвечаешь по-русски, тепло и конкретно
- Даёшь практичные советы и упражнения
- Ответы компактные: 2-4 абзаца
- Иногда используешь эмодзи, без фанатизма`,
        messages,
      }),
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Claude API error:', error);
    res.status(500).json({ error: 'API request failed' });
  }
}
