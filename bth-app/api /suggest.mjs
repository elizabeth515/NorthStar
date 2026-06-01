export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { type, transcript, northStar, showing, agentName, buyers } = req.body

  const callAI = async (prompt) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
    })
    const d = await r.json()
    const text = d.content?.[0]?.text || '{}'
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  }

  try {
    if (type === 'intake') {
      const result = await callAI(`You are helping a real estate agent build a diagnostic profile called a MOVE.

Agent's notes after a buyer consultation:
"${transcript}"

Extract the buyer's MOVE. Think like a doctor — find the real need underneath what was said.

MOVE:
- motivation: What is finally driving this move? What's broken?
- outcome: What does the right home give them?
- veto: What kills a house immediately?
- exchange: What will they give up to get what matters most?

Also extract:
- propertyType: Type of home
- location: Area or neighborhood
- oneSentence: One sharp sentence capturing the complete MOVE

Respond ONLY with valid JSON. No explanation. No markdown. Keys: motivation, outcome, veto, exchange, propertyType, location, oneSentence`)
      return res.json({ extracted: result })
    }

    if (type === 'debrief') {
      const result = await callAI(`You are a senior real estate coach helping an agent sharpen their buyer diagnosis after a showing.

Current MOVE:
- Motivation: ${northStar?.motivation || 'not set'}
- Outcome: ${northStar?.outcome || 'not set'}
- Veto: ${northStar?.veto || 'not set'}
- Exchange: ${northStar?.exchange || 'not set'}

Showing notes: "${showing?.freeText || showing?.respondedTo || ''}"

1. Update MOVE where evidence clearly supports it. Keep values under 12 words.
2. Write ONE sharp coaching question for the next showing. Under 20 words. Direct, specific.
3. Write an updated oneSentence diagnosis.

Respond ONLY with valid JSON. Keys: motivation, outcome, veto, exchange, propertyType, location, oneSentence, coachingQuestion`)
      return res.json({ result })
    }

    if (type === 'coaching_insights') {
      const summary = (buyers || []).map(b => ({
        name: b.clientName,
        moveComplete: ['motivation','outcome','veto','exchange'].filter(k => b.northStar?.[k]).length,
        showings: b.showings?.length || 0,
        isMatch: b.isMatch,
        missingKeys: ['motivation','outcome','veto','exchange'].filter(k => !b.northStar?.[k]),
      }))
      const result = await callAI(`You are a real estate coaching expert analyzing an agent's diagnostic patterns.

Agent: ${agentName}
Buyer data: ${JSON.stringify(summary)}

Identify:
1. Which MOVE letter (M, O, V, or E) this agent most consistently leaves incomplete
2. One specific pattern in their diagnostic approach
3. One sharp coaching prompt — specific, actionable, under 25 words

Respond ONLY with valid JSON. Keys: weakestLetter, pattern, coachingPrompt`)
      return res.json({ insights: result })
    }

    res.status(400).json({ error: 'Invalid type: ' + type })
  } catch (err) {
    res.status(500).json({ error: 'Failed', detail: err.message })
  }
}
