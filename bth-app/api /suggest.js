export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { northStar, showing } = req.body

  const prompt = `You are helping a real estate agent update their "North Star Hypothesis" about a buyer based on a showing debrief.

Current hypothesis:
- Property Type: ${northStar.propertyType || 'not set'}
- Location: ${northStar.location || 'not set'}
- Core Motivation: ${northStar.motivation || 'not set'}
- What Matters Most: ${northStar.whatMattersMost || 'not set'}
- Will Give Up: ${northStar.willingToTrade || 'not set'}
- In Exchange For: ${northStar.tradeFor || 'not set'}

Showing observations:
- What they responded to: ${showing.respondedTo || 'not noted'}
- What they pulled back from: ${showing.pulledBackFrom || 'not noted'}
- What became more true: ${showing.moreTrue || 'not noted'}
- What became less true: ${showing.lessTrue || 'not noted'}
- Agent note: ${showing.hypothesisUpdate || 'none'}

Suggest refined values for each hypothesis field. Only change a field when the evidence clearly supports it. Keep each value under 12 words. If a field should stay the same, return its current value. If empty and evidence supports filling it, fill it.

Respond ONLY with a valid JSON object with exactly these keys: propertyType, location, motivation, whatMattersMost, willingToTrade, tradeFor. No explanation, no markdown, just the JSON.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await response.json()
    const text = data.content?.[0]?.text || '{}'
    const suggestions = JSON.parse(text.replace(/```json|```/g, '').trim())
    res.json({ suggestions })
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate suggestions', detail: err.message })
  }
}
