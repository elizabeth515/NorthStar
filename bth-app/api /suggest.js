export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { type, transcript, northStar, showing } = req.body

  // ── TYPE 1: Extract MOVE from free-form buyer intake ──
  if (type === 'intake') {
    const prompt = `You are helping a real estate agent build a diagnostic profile of a new buyer — called their MOVE.

The agent just got off a buyer consultation call. Here is their free-form voice transcript:

"${transcript}"

Extract the buyer's MOVE from this transcript. Think like a doctor diagnosing a patient — look for the real need underneath what was said.

MOVE stands for:
- Motivation: What is finally driving this move? What's broken or not working in their current situation?
- Outcome: What does the right home give them? What changes in their life?
- Veto: What would kill a house immediately? Hard limits, non-negotiables.
- Exchange: What will they give up to get what matters most? What's the trade?

Also extract:
- propertyType: What type of home are they looking for?
- location: What area or neighborhood?
- oneSentence: Write one sharp sentence that captures the complete MOVE. Example: "The Martinez family needs a 3-bed in Hillsboro Village — schools are non-negotiable and they'll trade commute and price ceiling to get there."

Respond ONLY with valid JSON. No explanation. No markdown. Just the JSON object with these exact keys: motivation, outcome, veto, exchange, propertyType, location, oneSentence.`

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
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await response.json()
      const text = data.content?.[0]?.text || '{}'
      const extracted = JSON.parse(text.replace(/```json|```/g, '').trim())
      res.json({ extracted })
    } catch (err) {
      res.status(500).json({ error: 'Extraction failed', detail: err.message })
    }
    return
  }

  // ── TYPE 2: Update MOVE from showing debrief + coaching question ──
  if (type === 'debrief') {
    const prompt = `You are a senior real estate coach helping an agent refine their understanding of a buyer's MOVE after a showing.

Current MOVE:
- Motivation: ${northStar.motivation || 'not set'}
- Outcome: ${northStar.outcome || 'not set'}
- Veto: ${northStar.veto || 'not set'}
- Exchange: ${northStar.exchange || 'not set'}
- Property Type: ${northStar.propertyType || 'not set'}
- Location: ${northStar.location || 'not set'}

Showing debrief:
- Responded to: ${showing.respondedTo || 'not noted'}
- Pulled back from: ${showing.pulledBackFrom || 'not noted'}
- More true: ${showing.moreTrue || 'not noted'}
- Less true: ${showing.lessTrue || 'not noted'}
- Agent's shift note: ${showing.hypothesisUpdate || 'none'}

Do two things:

1. Suggest refined MOVE values. Only change a field when the evidence clearly supports it. Keep values under 12 words. If a field should stay the same, return its current value.

2. Write ONE sharp coaching question — the single most important question the agent should be asking themselves or testing on the next showing. Make it specific to what was observed. Sound like a brilliant, direct mentor — not a generic prompt. Under 20 words.

Respond ONLY with valid JSON with these exact keys: motivation, outcome, veto, exchange, propertyType, location, oneSentence, coachingQuestion. No explanation. No markdown.`

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
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = await response.json()
      const text = data.content?.[0]?.text || '{}'
      const result = JSON.parse(text.replace(/```json|```/g, '').trim())
      res.json({ result })
    } catch (err) {
      res.status(500).json({ error: 'Debrief failed', detail: err.message })
    }
    return
  }

  res.status(400).json({ error: 'Invalid type' })
}
