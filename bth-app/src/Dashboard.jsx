import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://fvilkxrtgomawwlizwij.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2aWxreHJ0Z29tYXd3bGl6d2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMTgwODQsImV4cCI6MjA5NTc5NDA4NH0.a_9eMlI6L_Ya0ekofyNHPTCBbM8RvD9QevkaU4SvS_U'

const DEFAULT_NS = { propertyType: '', location: '', motivation: '', outcome: '', veto: '', exchange: '', oneSentence: '' }
const DEFAULT_CONTACTS = [
  { id: '1', name: '', phone: '', email: '', role: 'Buyer', isPrimary: true },
  { id: '2', name: '', phone: '', email: '', role: 'Spouse / Partner', isPrimary: false },
]

const MOVE = [
  { key: 'motivation', letter: 'M', label: 'Motivation', question: "What's driving this move?" },
  { key: 'outcome',    letter: 'O', label: 'Outcome',    question: 'What does the right home give them?' },
  { key: 'veto',       letter: 'V', label: 'Veto',       question: 'What kills a house immediately?' },
  { key: 'exchange',   letter: 'E', label: 'Exchange',   question: 'What will they trade to get what matters most?' },
]

const DEBRIEF = [
  { key: 'respondedTo',      label: 'Responded to',    question: 'What created energy?' },
  { key: 'pulledBackFrom',   label: 'Pulled back from', question: "What didn't land?" },
  { key: 'moreTrue',         label: 'More true',        question: 'What confirmed the MOVE?' },
  { key: 'lessTrue',         label: 'Less true',        question: 'What challenged the MOVE?' },
  { key: 'hypothesisUpdate', label: 'The shift',        question: 'How does the MOVE change?' },
]

const STATUSES = ['Active', 'Under Contract', 'Closed', 'On Hold']

const PREP_QUESTIONS = [
  "What's not working about where you are now?",
  "What does the right home change for you?",
  "What would make you walk away from a house?",
  "What matters most — the thing you won't compromise on?",
  "What would you give up to get that?",
]

const CONFIDENCE_STAGES = [
  { val: 'fuzzy',   label: 'Fuzzy',     sub: "Can't see the MOVE yet" },
  { val: 'forming', label: 'Forming',   sub: 'Starting to take shape' },
  { val: 'clear',   label: 'Clear',     sub: 'Strong hypothesis' },
  { val: 'true',    label: 'True MOVE', sub: 'Found it' },
]
// Muted grey → taupe → sage → olive green progression for the MOVE confidence scale
const STAGE_COLORS = [
  { base: '#9ca3af', light: '#f3f4f6', border: '#d1d5db' },
  { base: '#8a9e8a', light: '#f0f4f0', border: '#c5d4c5' },
  { base: '#6b8c6b', light: '#eaf3ea', border: '#aacbaa' },
  { base: '#5a7047', light: '#ecf2e6', border: '#a3bc89' },
]

const MOVE_PROMPTS = {
  motivation: ["What finally made them decide to move now?", "What's not working about where they are today?", "What would happen if they didn't move this year?"],
  outcome:    ["What does their life look like once they're in the right home?", "What changes for them the day after they close?", "What are they really buying — beyond the house?"],
  veto:       ["What would make them walk away from a deal they otherwise love?", "What's the one thing they absolutely won't compromise on?", "Have they walked away from a house before? Why?"],
  exchange:   ["What would they give up to get what matters most?", "If they had to choose between two things — which wins?", "What trade would feel worth it six months after closing?"],
}

// ─── COLORS ──────────────────────────────────────────────────────────────────
const C = {
  dark:       '#111827',
  darkMid:    '#1f2937',
  darkSub:    '#374151',
  gold:       '#d97706',
  goldLight:  '#fffbeb',
  goldBorder: '#fde68a',
  red:        '#dc2626',
  redLight:   '#fef2f2',
  green:      '#16a34a',
  greenLight: '#f0fdf4',
  greenBorder:'#bbf7d0',
  bg:         '#f9fafb',
  surface:    '#ffffff',
  border:     '#e5e7eb',
  text:       '#111827',
  textMid:    '#4b5563',
  textMuted:  '#9ca3af',
  onDark:     '#ffffff',
  onDarkMid:  '#9ca3af',
  onDarkSub:  '#6b7280',
}

const FONTS = {
  sans: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function dbToBuyer(r) {
  return {
    id: r.id, clientName: r.client_name || '', agentName: r.agent_name || '',
    status: r.status || 'Active',
    contacts: r.contacts?.length ? r.contacts : DEFAULT_CONTACTS.map(c => ({ ...c })),
    northStar: { ...DEFAULT_NS, ...(r.north_star || {}) },
    showings: r.showings || [],
    confidence: r.confidence || '',
    isMatch: r.is_match || false,
    createdAt: r.created_at,
  }
}

function buyerToDb(b) {
  return {
    client_name: b.clientName || '', agent_name: b.agentName || '', status: b.status || 'Active',
    contacts: b.contacts || [], north_star: b.northStar || {}, showings: b.showings || [],
    confidence: b.confidence || '', is_match: b.isMatch || false,
    updated_at: new Date().toISOString(),
  }
}

function newBuyer(agentName = '') {
  return {
    clientName: '', agentName, status: 'Active',
    contacts: DEFAULT_CONTACTS.map(c => ({ ...c })),
    northStar: { ...DEFAULT_NS }, showings: [], confidence: '', isMatch: false,
  }
}

function newShowing(agentName = '') {
  return {
    id: Date.now().toString(), date: new Date().toISOString().split('T')[0],
    address: '', agentName, testingToday: '', freeText: '',
    respondedTo: '', pulledBackFrom: '', moreTrue: '', lessTrue: '', hypothesisUpdate: '',
  }
}

function moveCount(ns) { return MOVE.filter(m => ns[m.key]).length }

function moveStatus(ns, isMatch, confidence) {
  if (isMatch || confidence === 'true') return { label: 'True MOVE', color: C.green }
  const c = moveCount(ns)
  if (c === 0) return { label: 'Not started', color: C.red }
  if (c < 4) return { label: `Building ${c}/4`, color: C.gold }
  return { label: 'MOVE complete', color: C.text }
}

function formatPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
}

function daysSince(dateStr) {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000)
}

async function callAI(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

// ─── SAMPLE DATA ──────────────────────────────────────────────────────────────
const SAMPLE_BUYERS = [
  {
    clientName: 'Martinez Family', agentName: 'Sarah Johnson', status: 'Active',
    contacts: [
      { id: '1', name: 'Carlos Martinez', phone: '(615) 482-3901', email: 'carlos@email.com', role: 'Buyer', isPrimary: true },
      { id: '2', name: 'Elena Martinez', phone: '(615) 482-3902', email: 'elena@email.com', role: 'Spouse / Partner', isPrimary: false },
    ],
    northStar: {
      propertyType: 'Single family home', location: 'Hillsboro Village',
      motivation: 'Lease ending April, outbid twice before, ready to commit',
      outcome: 'Right school zone, kids settled, feeling at home',
      veto: "Won't compromise on Hillsboro Village school district",
      exchange: 'Will trade yard size and commute to get the school zone',
      oneSentence: 'The Martinez family needs a 3-bed in Hillsboro Village — schools are non-negotiable and they\'ll trade commute entirely to get there.',
    },
    showings: [
      { id: '1', date: '2026-05-15', address: '2847 Belmont Blvd', agentName: 'Sarah Johnson', testingToday: 'Whether school proximity feels right', freeText: 'They loved the street. School proximity confirmed. But too small — he kept mentioning third bedroom.', respondedTo: 'Street feel, walkability', pulledBackFrom: 'Small third bedroom', moreTrue: 'School zone is the whole game', lessTrue: 'Yard size matters less than we thought', hypothesisUpdate: 'Size matters more than I thought — 3 beds non-negotiable' },
      { id: '2', date: '2026-05-22', address: '3104 Blakemore Ave', agentName: 'Sarah Johnson', testingToday: 'Whether they\'ll go further for more space', freeText: 'Great layout, strong 3 bed. Commute concern came up but softer than expected.', respondedTo: 'Layout, natural light, third bedroom', pulledBackFrom: 'Slightly further from school', moreTrue: 'He\'s flexible on commute', lessTrue: 'Distance to school is absolute hard limit', hypothesisUpdate: 'Commute flexibility confirmed — school zone still non-negotiable' },
    ],
    confidence: 'clear', isMatch: false,
  },
  {
    clientName: 'Thompson, James', agentName: 'Mike Davis', status: 'Active',
    contacts: [
      { id: '1', name: 'James Thompson', phone: '(615) 291-4422', email: 'james.t@gmail.com', role: 'Buyer', isPrimary: true },
      { id: '2', name: '', phone: '', email: '', role: 'Spouse / Partner', isPrimary: false },
    ],
    northStar: {
      propertyType: 'Condo or townhome', location: 'Midtown or 12South',
      motivation: 'Relocating from Chicago for new job, starts August',
      outcome: 'Walkable neighborhood, low maintenance, feels like a city',
      veto: '', exchange: '',
      oneSentence: '',
    },
    showings: [
      { id: '1', date: '2026-05-28', address: '1805 Caruthers Ave Unit 4', agentName: 'Mike Davis', testingToday: 'Whether 12South walkability meets his expectations', freeText: 'Loved the neighborhood energy. Unit felt small but he didn\'t complain. Parking came up twice.', respondedTo: 'Street, restaurants walking distance', pulledBackFrom: 'Parking situation', moreTrue: 'Walkability is the whole thing', lessTrue: 'Unit size matters less than location', hypothesisUpdate: 'Parking is emerging as a veto — needs to nail that down' },
    ],
    confidence: 'forming', isMatch: false,
  },
  {
    clientName: 'Chen, Lisa & David', agentName: 'Sarah Johnson', status: 'Under Contract',
    contacts: [
      { id: '1', name: 'Lisa Chen', phone: '(615) 334-7821', email: 'lisa.chen@work.com', role: 'Buyer', isPrimary: true },
      { id: '2', name: 'David Chen', phone: '(615) 334-7822', email: 'david.chen@work.com', role: 'Spouse / Partner', isPrimary: false },
    ],
    northStar: {
      propertyType: 'Single family home', location: 'Green Hills',
      motivation: 'First home, tired of renting, ready to build equity',
      outcome: 'Space to grow, home office for both, feels permanent',
      veto: 'No HOA, must have dedicated home office space',
      exchange: 'Will go smaller on yard to get the right neighborhood and office space',
      oneSentence: 'Lisa and David need a 3-bed with dual office space in Green Hills — permanence and no HOA are non-negotiable, yard is the trade.',
    },
    showings: [
      { id: '1', date: '2026-05-01', address: '4521 Lealand Ln', agentName: 'Sarah Johnson', testingToday: 'Office space viability', freeText: 'Good bones but only one room works as office.', respondedTo: 'Neighborhood feel', pulledBackFrom: 'Single office option', moreTrue: 'Dual office is non-negotiable', lessTrue: '', hypothesisUpdate: 'Must have two dedicated office spaces' },
      { id: '2', date: '2026-05-08', address: '3847 Whitland Ave', agentName: 'Sarah Johnson', testingToday: 'Whether this layout works for two offices', freeText: 'Perfect dual office setup. They were visibly excited. HOA confirmed as hard no.', respondedTo: 'Dual office layout, quiet street', pulledBackFrom: 'HOA fees mentioned', moreTrue: 'No HOA is absolute', lessTrue: '', hypothesisUpdate: 'This is it — dual office confirmed, no HOA confirmed' },
    ],
    confidence: 'true', isMatch: true,
  },
  {
    clientName: 'Williams, Robert', agentName: 'Mike Davis', status: 'Active',
    contacts: [
      { id: '1', name: 'Robert Williams', phone: '(615) 558-9034', email: 'rob.williams@firm.com', role: 'Buyer', isPrimary: true },
      { id: '2', name: 'Susan Williams', phone: '(615) 558-9035', email: 'susan.w@gmail.com', role: 'Spouse / Partner', isPrimary: false },
    ],
    northStar: {
      propertyType: '', location: 'Brentwood or Franklin',
      motivation: 'Downsizing — kids are out, current house is too much to maintain',
      outcome: '', veto: '', exchange: '',
      oneSentence: '',
    },
    showings: [],
    confidence: 'fuzzy', isMatch: false,
  },
]

// ─── VOICE HOOK ───────────────────────────────────────────────────────────────
function useVoice() {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recog = useRef(null)
  const timer = useRef(null)
  const latest = useRef('')

  const stop = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (recog.current) { try { recog.current.abort() } catch (_) {} recog.current = null }
    setListening(false)
  }, [])

  const start = useCallback((onDone) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice requires Chrome or Safari.'); return }
    latest.current = ''; setListening(true)
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-US'
    recog.current = r; let final = ''
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t; else interim = t
      }
      const full = (final + interim).trim()
      latest.current = full; setTranscript(full)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => { stop(); onDone(latest.current) }, 5000)
    }
    r.onerror = (e) => { if (e.error !== 'aborted') { stop(); onDone(latest.current) } }
    r.onend = () => setListening(false)
    r.start()
  }, [stop])

  const finish = useCallback((onDone) => { stop(); onDone(latest.current) }, [stop])
  return { start, stop, finish, listening, transcript, setTranscript }
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App({ session }) {
  const [buyers, setBuyers] = useState([])
  const [agents, setAgents] = useState([])
  const [currentAgent, setCurrentAgent] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('snapshot')
  const [tab, setTab] = useState('move')
  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showingDraft, setShowingDraft] = useState(null)
  const [editingShowingId, setEditingShowingId] = useState(null)
  const [aiNotif, setAiNotif] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const saveTimers = useRef({})
  const isAdmin = currentAgent?.role === 'admin'

  useEffect(() => {
    loadData()
    supabase.channel('rt').on('postgres_changes', { event: '*', schema: 'public', table: 'buyers' }, handleRT).subscribe()
  }, [])

  const loadData = async () => {
    setLoading(true)
    const [{ data: bRows }, { data: aRows }] = await Promise.all([
      supabase.from('buyers').select('*').order('created_at', { ascending: false }),
      supabase.from('agents').select('*').order('name'),
    ])
    setBuyers((bRows || []).map(dbToBuyer))
    setAgents(aRows || [])
    const me = (aRows || []).find(a => a.id === session.user.id)
    setCurrentAgent(me || null)
    setLoading(false)
  }

  const handleRT = (p) => {
    if (p.eventType === 'INSERT') setBuyers(prev => prev.find(b => b.id === p.new.id) ? prev : [dbToBuyer(p.new), ...prev])
    else if (p.eventType === 'UPDATE') setBuyers(prev => prev.map(b => b.id === p.new.id ? dbToBuyer(p.new) : b))
    else if (p.eventType === 'DELETE') setBuyers(prev => prev.filter(b => b.id !== p.old.id))
  }

  const save = useCallback((buyer) => {
    if (saveTimers.current[buyer.id]) clearTimeout(saveTimers.current[buyer.id])
    setSaving(true)
    saveTimers.current[buyer.id] = setTimeout(async () => {
      await supabase.from('buyers').update(buyerToDb(buyer)).eq('id', buyer.id)
      setSaving(false)
    }, 800)
  }, [])

  const patch = useCallback((p) => {
    setBuyers(prev => prev.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, ...p }; save(nb); return nb }))
  }, [selectedId, save])

  const patchNS = useCallback((nsp) => {
    setBuyers(prev => prev.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, northStar: { ...b.northStar, ...nsp } }; save(nb); return nb }))
  }, [selectedId, save])

  const addBuyer = async () => {
    const agentName = currentAgent?.name || ''
    try {
      const { data, error } = await supabase.from('buyers').insert(buyerToDb(newBuyer(agentName))).select().single()
      if (error) { alert('Could not create buyer: ' + error.message); return }
      if (data) { const b = dbToBuyer(data); setBuyers(p => [b, ...p]); setSelectedId(b.id); setTab('move'); setView('buyer') }
    } catch (err) { alert('Error: ' + err.message) }
  }

  const loadSampleData = async () => {
    if (!window.confirm('Load sample buyers? This will add 4 example buyers to your account.')) return
    const agentName = currentAgent?.name || ''
    for (const sample of SAMPLE_BUYERS) {
      const b = { ...sample, agentName: sample.agentName || agentName }
      await supabase.from('buyers').insert(buyerToDb(b))
    }
    loadData()
  }

  const saveShowing = useCallback(async (showing) => {
    let updated = null
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const exists = b.showings.find(s => s.id === showing.id)
      const showings = exists ? b.showings.map(s => s.id === showing.id ? showing : s) : [...b.showings, showing]
      const nb = { ...b, showings }; save(nb); updated = nb; return nb
    }))
    setShowingDraft(null); setEditingShowingId(null); setView('buyer'); setTab('showings')
    const hasContent = showing.freeText || showing.respondedTo || showing.hypothesisUpdate
    if (updated && hasContent) {
      setAiLoading(true)
      try {
        const data = await callAI({ type: 'debrief', northStar: updated.northStar, showing })
        if (data.result) {
          const { coachingQuestion, oneSentence, ...nsU } = data.result
          const prev = { ...updated.northStar }
          const changed = Object.keys(nsU).filter(k => nsU[k] && nsU[k] !== prev[k])
          if (changed.length > 0 || oneSentence) setAiNotif({ proposed: nsU, previous: prev, changed, coachingQuestion, oneSentence, pending: true })
          else if (coachingQuestion) setAiNotif({ proposed: {}, previous: prev, changed: [], coachingQuestion, oneSentence, pending: true })
        }
      } catch (_) {}
      setAiLoading(false)
    }
  }, [selectedId, save])

  const deleteShowing = useCallback((sid) => {
    setBuyers(p => p.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, showings: b.showings.filter(s => s.id !== sid) }; save(nb); return nb }))
  }, [selectedId, save])

  const deleteBuyer = async (id) => {
    if (!window.confirm('Delete this buyer?')) return
    await supabase.from('buyers').delete().eq('id', id)
    setBuyers(p => p.filter(b => b.id !== id)); setView('snapshot'); setSelectedId(null)
  }

  const openShowing = (sh = null) => {
    const agentName = currentAgent?.name || ''
    if (sh) { setShowingDraft({ ...sh }); setEditingShowingId(sh.id) }
    else { setShowingDraft(newShowing(agentName)); setEditingShowingId(null) }
    setView('showing'); setAiNotif(null)
  }

  const selected = buyers.find(b => b.id === selectedId)

  const filtered = buyers.filter(b => {
    const q = search.toLowerCase()
    return (!q || b.clientName.toLowerCase().includes(q) || b.agentName.toLowerCase().includes(q))
      && (agentFilter === 'all' || b.agentName === agentFilter)
      && (statusFilter === 'all' || b.status === statusFilter)
  })

  if (loading) return <div style={s.center}>Loading…</div>

  if (view === 'showing' && showingDraft)
    return <ShowingForm draft={showingDraft} setDraft={setShowingDraft} buyer={selected}
      onSave={saveShowing} onCancel={() => { setView('buyer'); setShowingDraft(null) }} isEdit={!!editingShowingId} />

  if (view === 'buyer' && selected)
    return <BuyerView buyer={selected} agents={agents} currentAgent={currentAgent} saving={saving}
      tab={tab} setTab={setTab} aiNotif={aiNotif} aiLoading={aiLoading} setAiNotif={setAiNotif}
      patch={patch} patchNS={patchNS} saveShowing={saveShowing} deleteShowing={deleteShowing}
      deleteBuyer={deleteBuyer} openShowing={openShowing} onBack={() => setView('snapshot')}
      onApplyAI={(updates) => { patchNS(updates); setAiNotif(null) }} />

  if (view === 'manager' && isAdmin)
    return <ManagerView buyers={buyers} agents={agents} onBack={() => setView('snapshot')}
      onSelect={(id) => { setSelectedId(id); setView('buyer'); setTab('move') }} />

  if (view === 'performance')
    return <PerformanceView buyers={buyers} agentName={currentAgent?.name || ''} onBack={() => setView('snapshot')} />

  if (view === 'users' && isAdmin)
    return <UserManagement agents={agents} session={session} onBack={() => setView('snapshot')} onRefresh={loadData} />

  return (
    <div style={s.screen}>
      <TopBar currentAgent={currentAgent} isAdmin={isAdmin}
        onAdd={addBuyer} onSignOut={() => supabase.auth.signOut()}
        onManager={() => setView('manager')} onPerformance={() => setView('performance')}
        onUsers={() => setView('users')} onSampleData={loadSampleData} buyers={buyers} />

      <div style={s.filterBar}>
        <input style={s.search} placeholder="Search buyers…" value={search} onChange={e => setSearch(e.target.value)} />
        <div style={s.pipe} />
        <select style={s.filterSel} value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
          <option value="all">All agents</option>
          {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <div style={s.pipe} />
        <div style={s.chips}>
          {['all', ...STATUSES].map(st => (
            <button key={st} style={{ ...s.chip, ...(statusFilter === st ? s.chipOn : {}) }} onClick={() => setStatusFilter(st)}>
              {st === 'all' ? 'All' : st === 'Under Contract' ? 'Contract' : st}
            </button>
          ))}
        </div>
        <span style={s.count}>{filtered.length} buyer{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div style={s.grid}>
        {filtered.length === 0 && (
          <div style={s.emptyGrid}>
            <div style={s.emptyTitle}>No buyers yet</div>
            <div style={s.emptySub}>Add your first buyer to start building their MOVE.</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button style={s.btnPrimary} onClick={addBuyer}>+ Add Buyer</button>
              <button style={s.btnSecondary} onClick={loadSampleData}>Load Sample Data</button>
            </div>
          </div>
        )}
        {filtered.map(b => (
          <BuyerCard key={b.id} buyer={b}
            onOpen={() => { setSelectedId(b.id); setTab('move'); setView('buyer'); setAiNotif(null) }}
            onSharpen={() => { setSelectedId(b.id); openShowing() }} />
        ))}
      </div>
    </div>
  )
}

// ─── TOP BAR ──────────────────────────────────────────────────────────────────
function TopBar({ currentAgent, isAdmin, onAdd, onSignOut, onManager, onPerformance, onUsers, onSampleData, buyers }) {
  const [mindset, setMindset] = useState(false)
  return (
    <>
      <div style={s.topBar}>
        <div style={s.topLeft}>
          <div style={s.brand}>BUILD THE HOUSE</div>
          <div style={s.brandTag}>Powered by MOVE</div>
        </div>
        <div style={s.topRight}>
          <span style={s.agentChip}>{currentAgent?.name || ''}</span>
          <button style={s.topBtn} onClick={() => setMindset(o => !o)}>Mindset</button>
          {isAdmin && <button style={s.topBtn} onClick={onManager}>Team</button>}
          {isAdmin && <button style={s.topBtn} onClick={onUsers}>Users</button>}
          <button style={s.topBtn} onClick={onPerformance}>My Stats</button>
          {buyers.length === 0 && <button style={s.topBtn} onClick={onSampleData}>Load Sample Data</button>}
          <button style={s.topBtnAccent} onClick={onAdd}>+ New Buyer</button>
          <button style={s.topBtnGhost} onClick={onSignOut}>Sign out</button>
        </div>
      </div>
      {mindset && (
        <div style={s.mindsetBar}>
          <div style={s.mindsetBlock}>
            <div style={s.mindsetHead}>THE FRAME</div>
            <div style={s.mindsetText}>You are not searching for a house. You are diagnosing a buyer. The MOVE is the diagnosis. Showings are the tests. The match is the prescription.</div>
          </div>
          <div style={s.mindsetBlock}>
            <div style={s.mindsetHead}>MOVE</div>
            {MOVE.map(m => <div key={m.key} style={s.mindsetRow}><span style={s.mindsetLetter}>{m.letter}</span><span style={s.mindsetText}>{m.question}</span></div>)}
          </div>
          <div style={s.mindsetBlock}>
            <div style={s.mindsetHead}>BEFORE THE CONSULTATION</div>
            {PREP_QUESTIONS.map((q, i) => <div key={i} style={s.mindsetRow}><span style={s.mindsetNum}>{i+1}</span><span style={s.mindsetText}>{q}</span></div>)}
          </div>
          <div style={s.mindsetBlock}>
            <div style={s.mindsetHead}>TWO ANCHORS</div>
            <div style={s.mindsetText}><strong style={{ color: C.gold }}>Destroy Ambiguity.</strong> Every conversation should create clarity.</div>
            <div style={{ ...s.mindsetText, marginTop: 6 }}><strong style={{ color: C.gold }}>Find the Best Answer.</strong> You are hired to find the best answer — not collect them.</div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── BUYER CARD ───────────────────────────────────────────────────────────────
function BuyerCard({ buyer, onOpen, onSharpen }) {
  const ms = moveStatus(buyer.northStar, buyer.isMatch, buyer.confidence)
  const lastShowing = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
  const days = lastShowing ? daysSince(lastShowing.date) : null
  const confStage = CONFIDENCE_STAGES.find(c => c.val === buyer.confidence)
  const urgent = !buyer.isMatch && moveCount(buyer.northStar) === 0

  return (
    <div style={{ ...s.card, ...(buyer.isMatch || buyer.confidence === 'true' ? s.cardMatch : urgent ? s.cardUrgent : {}) }}>
      <div style={s.cardTop}>
        <div style={s.cardTopLeft}>
          <div style={s.cardName}>{buyer.clientName || 'Unnamed Buyer'}</div>
          {buyer.contacts?.[1]?.name && <div style={s.cardSpouse}>& {buyer.contacts[1].name}</div>}
        </div>
        <div style={s.cardTopRight}>
          <div style={s.cardAgent}>{buyer.agentName || '—'}</div>
          <div style={s.cardStatus}>{buyer.status}</div>
        </div>
      </div>

      <div style={s.cardBody}>
        <div style={{ ...s.cardMoveStatus, color: ms.color }}>{ms.label}</div>
        {confStage && (
          <div style={s.cardConfStage}>
            <div style={s.confTrack}>
              {CONFIDENCE_STAGES.map((cs, i) => {
                const stageIdx = CONFIDENCE_STAGES.findIndex(x => x.val === buyer.confidence)
                const active = i <= stageIdx
                return <div key={cs.val} style={{ ...s.confDot, ...(active ? { background: buyer.confidence === 'true' ? C.green : C.gold } : {}) }} />
              })}
            </div>
            <span style={{ ...s.confLabel, color: buyer.confidence === 'true' ? C.green : C.gold }}>{confStage.label}</span>
          </div>
        )}
        {buyer.northStar.oneSentence
          ? <div style={s.cardSentence}>{buyer.northStar.oneSentence}</div>
          : buyer.northStar.motivation
          ? <div style={s.cardSentence}>{buyer.northStar.motivation}{buyer.northStar.outcome ? ` · ${buyer.northStar.outcome}` : ''}</div>
          : <div style={s.cardEmpty}>No diagnosis yet — start the MOVE.</div>}
        {lastShowing?.hypothesisUpdate && (
          <div style={s.cardShift}><span style={s.cardShiftLabel}>Latest shift: </span>{lastShowing.hypothesisUpdate}</div>
        )}
      </div>

      <div style={s.cardFoot}>
        <span style={s.cardMeta}>{buyer.showings.length} showing{buyer.showings.length !== 1 ? 's' : ''}{days !== null ? ` · ${days}d ago` : ''}</span>
        <div style={s.cardActions}>
          {!buyer.isMatch && buyer.confidence !== 'true' && (
            <button style={s.cardSharpen} onClick={e => { e.stopPropagation(); onSharpen() }}>Sharpen MOVE</button>
          )}
          <button style={s.cardOpen} onClick={onOpen}>{moveCount(buyer.northStar) === 0 ? 'Start →' : 'Open →'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── BUYER VIEW ───────────────────────────────────────────────────────────────
function BuyerView({ buyer, agents, currentAgent, saving, tab, setTab, aiNotif, aiLoading, setAiNotif, patch, patchNS, saveShowing, deleteShowing, deleteBuyer, openShowing, onBack, onApplyAI }) {
  return (
    <div style={s.buyerScreen}>
      <div style={s.buyerBar}>
        <button style={s.back} onClick={onBack}>← Buyers</button>
        <div style={s.buyerBarRight}>
          {buyer.confidence !== 'true' && !buyer.isMatch && (
            <button style={s.btnAccent} onClick={() => openShowing()}>Sharpen MOVE</button>
          )}
          {buyer.confidence !== 'true'
            ? <button style={s.btnOutline} onClick={() => patch({ isMatch: true, confidence: 'true', status: 'Under Contract' })}>✓ True MOVE Found</button>
            : <button style={s.btnGhost} onClick={() => patch({ isMatch: false, confidence: 'clear' })}>Unmark</button>}
          <select style={s.statusSel} value={buyer.status} onChange={e => patch({ status: e.target.value })}>
            {STATUSES.map(st => <option key={st}>{st}</option>)}
          </select>
          <button style={s.btnDanger} onClick={() => deleteBuyer(buyer.id)}>Delete</button>
        </div>
      </div>

      <div style={s.buyerHead}>
        <div style={s.buyerNameRow}>
          <div style={s.buyerName}>{buyer.clientName || 'Unnamed Buyer'}{buyer.contacts?.[1]?.name && <span style={s.buyerSpouse}> & {buyer.contacts[1].name}</span>}</div>
          <div style={s.buyerMetaRow}>
            <span style={s.buyerAgent}>{buyer.agentName || 'No agent'}</span>
            <span style={s.buyerDot}>·</span>
            <span style={s.buyerStatusText}>{buyer.status}</span>
            <span style={s.buyerDot}>·</span>
            <span style={{ color: saving ? C.gold : C.textMuted, fontSize: 12, fontFamily: FONTS.sans }}>{saving ? 'Saving…' : 'Saved'}</span>
          </div>
        </div>
        {buyer.northStar.oneSentence && (
          <div style={s.buyerDiagnosis}>{buyer.northStar.oneSentence}</div>
        )}
      </div>

      {aiLoading && <div style={s.aiLoad}>✦ Analyzing showing — updating the MOVE…</div>}
      {aiNotif?.pending && (
        <AiConfirm notif={aiNotif} onApply={onApplyAI} onDismiss={() => setAiNotif(null)} />
      )}

      <div style={s.tabRow}>
        {[['move','The MOVE'],['contacts','Contacts'],['showings',`Showings (${buyer.showings.length})`],['refinements','Arc']].map(([k,l]) => (
          <button key={k} style={{ ...s.tabBtn, ...(tab === k ? s.tabBtnOn : {}) }} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div style={s.tabBody}>
        {tab === 'move'        && <MoveTab buyer={buyer} patchNS={patchNS} patch={patch} />}
        {tab === 'contacts'    && <ContactsTab buyer={buyer} patch={patch} agents={agents} />}
        {tab === 'showings'    && <ShowingsTab buyer={buyer} openShowing={openShowing} deleteShowing={deleteShowing} />}
        {tab === 'refinements' && <RefinementsTab buyer={buyer} />}
      </div>
    </div>
  )
}

// ─── AI CONFIRM ───────────────────────────────────────────────────────────────
function AiConfirm({ notif, onApply, onDismiss }) {
  const { proposed, previous, changed, coachingQuestion, oneSentence } = notif
  const [accepted, setAccepted] = useState(() => (changed || []).reduce((a, k) => ({ ...a, [k]: true }), {}))

  const handleApply = () => {
    const updates = {}
    ;(changed || []).forEach(k => { if (accepted[k]) updates[k] = proposed[k] })
    if (oneSentence) updates.oneSentence = oneSentence
    onApply(updates)
  }

  return (
    <div style={s.aiPanel}>
      <div style={s.aiPanelTop}>
        <span style={s.aiPanelTitle}>✦ MOVE update suggested</span>
        <button style={s.aiX} onClick={onDismiss}>✕</button>
      </div>
      {oneSentence && <div style={s.aiSentence}>{oneSentence}</div>}
      {(changed || []).length > 0 ? (
        <>
          <div style={s.aiSub}>Review each change. Uncheck any you want to keep.</div>
          <div style={s.aiChanges}>
            {(changed || []).map(k => (
              <div key={k} style={s.aiChange}>
                <input type="checkbox" checked={!!accepted[k]} onChange={e => setAccepted(a => ({ ...a, [k]: e.target.checked }))} style={{ accentColor: C.gold, marginTop: 2, flexShrink: 0 }} />
                <span style={s.aiChangeKey}>{MOVE.find(m => m.key === k)?.label || k}</span>
                <span style={s.aiChangeOld}>{previous[k] || '—'}</span>
                <span style={s.aiArrow}>→</span>
                <span style={s.aiChangeNew}>{proposed[k]}</span>
              </div>
            ))}
          </div>
          <div style={s.aiActions}>
            <button style={s.btnPrimary} onClick={handleApply}>Apply changes</button>
            <button style={s.btnSecondary} onClick={onDismiss}>Keep current</button>
          </div>
        </>
      ) : <div style={s.aiNoChange}>No MOVE changes suggested.</div>}
      {coachingQuestion && <div style={s.aiCoach}><strong>Next: </strong>{coachingQuestion}</div>}
    </div>
  )
}

// ─── MOVE TAB ─────────────────────────────────────────────────────────────────
function MoveTab({ buyer, patchNS, patch }) {
  const ns = buyer.northStar
  const [intakeOpen, setIntakeOpen] = useState(false)
  const { start, finish, listening, transcript, setTranscript } = useVoice()
  const [rawText, setRawText] = useState('')
  const [phase, setPhase] = useState('idle')
  const [intakeError, setIntakeError] = useState('')
  const [extracted, setExtracted] = useState(null)

  const runVoice = () => {
    setPhase('listening')
    start((text) => { setRawText(text); setPhase('review') })
  }

  const stopVoice = () => finish((text) => { setRawText(text); setPhase('review') })

  const processIntake = async (text) => {
    if (!text.trim()) return
    setPhase('processing'); setIntakeError(''); setExtracted(null)
    try {
      const data = await callAI({ type: 'intake', transcript: text })
      console.log('Intake response:', data)
      if (data.extracted && Object.values(data.extracted).some(v => v)) {
        setExtracted(data.extracted); setPhase('confirm')
      } else if (data.error) {
        setIntakeError('API error: ' + data.error); setPhase('review')
      } else {
        setIntakeError('No data extracted. Try speaking more detail about the buyer.'); setPhase('review')
      }
    } catch (err) { setIntakeError('Request failed: ' + err.message); setPhase('review') }
  }

  const applyExtracted = () => {
    if (!extracted) return
    // Only fill empty fields — don't overwrite existing data
    const updates = {}
    Object.keys(extracted).forEach(k => { if (extracted[k] && !ns[k]) updates[k] = extracted[k] })
    // Always update oneSentence
    if (extracted.oneSentence) updates.oneSentence = extracted.oneSentence
    patchNS(updates)
    setIntakeOpen(false); setPhase('idle'); setRawText(''); setExtracted(null)
  }

  const confStageIdx = CONFIDENCE_STAGES.findIndex(c => c.val === buyer.confidence)

  return (
    <div style={s.pane}>
      {/* Voice intake at top */}
      <div style={s.intakeBox}>
        <div style={s.intakeBoxHead}>
          <div>
            <div style={s.intakeBoxTitle}>Tell me about this buyer</div>
            <div style={s.intakeBoxSub}>Talk freely after the consultation. AI builds the MOVE from what you say.</div>
          </div>
          <button style={s.intakeToggle} onClick={() => setIntakeOpen(o => !o)}>
            {intakeOpen ? 'Close' : 'Open'}
          </button>
        </div>

        {intakeOpen && (
          <div style={s.intakeBody}>
            {phase === 'idle' && (
              <>
                <button style={s.voiceBtnLarge} onClick={runVoice}>🎙 Tap and talk freely</button>
                {buyer.showings.length === 0 && (
                  <div style={s.prepHint}>
                    <div style={s.prepHintHead}>Before the consultation, listen for:</div>
                    {PREP_QUESTIONS.map((q, i) => <div key={i} style={s.prepHintRow}><span style={s.prepN}>{i+1}</span><span>{q}</span></div>)}
                  </div>
                )}
              </>
            )}
            {phase === 'listening' && (
              <>
                <textarea style={s.transcriptArea} value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Listening…" />
                <button style={s.voiceBtnStop} onClick={stopVoice}>⏹ Done speaking</button>
                <div style={s.hint}>Pause 5 seconds to finish automatically.</div>
              </>
            )}
            {phase === 'review' && (
              <>
                <textarea style={s.transcriptArea} value={rawText} onChange={e => setRawText(e.target.value)} />
                {intakeError && <div style={s.errorBox}>{intakeError}</div>}
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button style={s.btnPrimary} onClick={() => processIntake(rawText)}>Build the MOVE →</button>
                  <button style={s.btnSecondary} onClick={() => { setPhase('idle'); setRawText('') }}>Re-record</button>
                </div>
              </>
            )}
            {phase === 'processing' && <div style={s.processing}>✦ Building the MOVE…</div>}
            {phase === 'confirm' && extracted && (
              <div style={s.extractedBox}>
                <div style={s.extractedHead}>MOVE extracted — only empty fields will be filled</div>
                {MOVE.map(m => extracted[m.key] ? (
                  <div key={m.key} style={s.extractedRow}>
                    <span style={s.extractedLetter}>{m.letter}</span>
                    <span style={{ ...s.extractedVal, ...(ns[m.key] ? { color: C.textMuted, textDecoration: 'line-through' } : {}) }}>
                      {ns[m.key] ? `${ns[m.key]} (keeping)` : extracted[m.key]}
                    </span>
                  </div>
                ) : null)}
                {extracted.oneSentence && <div style={s.extractedSentence}>{extracted.oneSentence}</div>}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button style={s.btnPrimary} onClick={applyExtracted}>Apply to MOVE →</button>
                  <button style={s.btnSecondary} onClick={() => { setPhase('idle'); setExtracted(null) }}>Discard</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MOVE fields */}
      <div style={s.moveSectionHead}>MOVE</div>
      <div style={s.moveGrid}>
        {MOVE.map(m => (
          <MoveField key={m.key} m={m} value={ns[m.key] || ''} onChange={v => patchNS({ [m.key]: v })} />
        ))}
      </div>

      {/* Location + type */}
      <div style={s.twoCol}>
        <div>
          <FL>Property Type</FL>
          <input style={{ ...s.fieldLg, ...(ns.propertyType ? s.fieldFilled : {}) }}
            value={ns.propertyType || ''} placeholder="e.g. single family home"
            onChange={e => patchNS({ propertyType: e.target.value })} />
        </div>
        <div>
          <FL>Location</FL>
          <input style={{ ...s.fieldLg, ...(ns.location ? s.fieldFilled : {}) }}
            value={ns.location || ''} placeholder="e.g. Green Hills"
            onChange={e => patchNS({ location: e.target.value })} />
        </div>
      </div>

      {/* Confidence continuum */}
      <div style={s.confSection}>
        <div style={s.confSectionHead}>How clearly do you see their MOVE?</div>
        <div style={s.confTrackFull}>
          {CONFIDENCE_STAGES.map((cs, i) => {
            const active = confStageIdx >= i
            const isCurrent = confStageIdx === i
            const sc = STAGE_COLORS[i]
            return (
              <button key={cs.val} style={{
                ...s.confStage,
                ...(isCurrent ? { borderColor: sc.base, background: sc.light, boxShadow: `0 0 0 2px ${sc.border}` } : {}),
                ...(active && !isCurrent ? { borderColor: sc.border, background: C.bg } : {})
              }}
                onClick={() => patch({ confidence: cs.val })}>
                <div style={{ ...s.confStageNum, ...(active ? { background: sc.base, color: '#fff', borderColor: sc.base } : {}) }}>{i + 1}</div>
                <div style={{ ...s.confStageLabel, ...(isCurrent ? { color: sc.base, fontWeight: 700 } : {}) }}>{cs.label}</div>
                <div style={s.confStageSub}>{cs.sub}</div>
              </button>
            )
          })}
        </div>
        {buyer.confidence && (
          <div style={{ ...s.confNudge, borderColor: STAGE_COLORS[confStageIdx].border, background: STAGE_COLORS[confStageIdx].light }}>
            {buyer.confidence === 'fuzzy' && "What's the one thing still unclear? Make that the focus of the next showing."}
            {buyer.confidence === 'forming' && "Getting clearer. Keep testing. What would make you move from Forming to Clear?"}
            {buyer.confidence === 'clear' && "Strong hypothesis. Are you ready to prescribe the right home?"}
            {buyer.confidence === 'true' && "True MOVE found. This is the diagnosis that led to the match."}
          </div>
        )}
      </div>
    </div>
  )
}

function MoveField({ m, value, onChange }) {
  const { start, finish, listening, transcript } = useVoice()
  const [active, setActive] = useState(false)

  const handleStart = () => { setActive(true); start((t) => { setActive(false); if (t) onChange(t) }) }
  const handleStop = () => finish((t) => { setActive(false); if (t) onChange(t) })

  return (
    <div style={{ ...s.moveField, ...(value ? s.moveFieldOn : {}) }}>
      <div style={s.moveFieldTop}>
        <div style={s.moveFieldLeft}>
          <span style={s.moveFieldLetter}>{m.letter}</span>
          <div>
            <div style={s.moveFieldLabel}>{m.label}</div>
            <div style={s.moveFieldQ}>{m.question}</div>
          </div>
        </div>
        <button style={{ ...s.micSmall, ...(active ? s.micSmallActive : {}) }} onClick={active ? handleStop : handleStart}>
          {active ? '⏹' : '🎙'}
        </button>
      </div>
      {active && <div style={s.fieldLive}>{transcript || <span style={{ color: C.textMuted }}>Listening…</span>}</div>}
      <textarea style={s.moveFieldInput} value={value} placeholder="Type or speak →" rows={2}
        onChange={e => onChange(e.target.value)} />
    </div>
  )
}

// ─── CONTACTS TAB ─────────────────────────────────────────────────────────────
function ContactsTab({ buyer, patch, agents }) {
  const upd = (cid, key, val) => patch({ contacts: buyer.contacts.map(c => c.id === cid ? { ...c, [key]: val } : c) })
  const setPrimary = (cid) => patch({ contacts: buyer.contacts.map(c => ({ ...c, isPrimary: c.id === cid })), clientName: buyer.contacts.find(c => c.id === cid)?.name || '' })
  return (
    <div style={s.pane}>
      {buyer.contacts.map(c => (
        <div key={c.id} style={{ ...s.contactCard, ...(c.isPrimary ? s.contactCardOn : {}) }}>
          <div style={s.contactTop}>
            <input style={s.roleInput} value={c.role} onChange={e => upd(c.id, 'role', e.target.value)} />
            {c.isPrimary ? <span style={s.primaryTag}>Primary</span> : <button style={s.setPrimaryBtn} onClick={() => setPrimary(c.id)}>Set as primary</button>}
          </div>
          <div style={s.twoCol}>
            <div style={{ gridColumn: '1/-1' }}>
              <FL>Full Name</FL>
              <input style={s.field} value={c.name} placeholder="Full name"
                onChange={e => { upd(c.id, 'name', e.target.value); if (c.isPrimary) patch({ clientName: e.target.value }) }} />
            </div>
            <div><FL>Phone</FL><input style={s.field} value={c.phone} placeholder="(615) 000-0000" onChange={e => upd(c.id, 'phone', formatPhone(e.target.value))} /></div>
            <div><FL>Email</FL><input style={s.field} value={c.email} placeholder="email@example.com" onChange={e => upd(c.id, 'email', e.target.value)} /></div>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 8 }}>
        <FL>Assigned Agent</FL>
        <select style={s.field} value={buyer.agentName} onChange={e => patch({ agentName: e.target.value })}>
          <option value="">Select agent…</option>
          {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
      </div>
    </div>
  )
}

// ─── SHOWINGS TAB ─────────────────────────────────────────────────────────────
function ShowingsTab({ buyer, openShowing, deleteShowing }) {
  const sorted = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))
  return (
    <div style={s.pane}>
      {sorted.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptyTitle}>No showings yet</div>
          <div style={s.emptySub}>Sharpen the MOVE after the first showing.</div>
          <button style={s.btnPrimary} onClick={() => openShowing()}>Sharpen MOVE</button>
        </div>
      ) : (
        <>
          <button style={{ ...s.btnPrimary, marginBottom: 20 }} onClick={() => openShowing()}>+ Sharpen MOVE</button>
          {sorted.map(sh => (
            <div key={sh.id} style={s.showCard}>
              <div style={s.showTop}>
                <div>
                  <div style={s.showAddr}>{sh.address || 'No address'}</div>
                  <div style={s.showDate}>{sh.date ? new Date(sh.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}{sh.agentName ? ` · ${sh.agentName}` : ''}</div>
                  {sh.testingToday && <div style={s.showTesting}><span style={s.showTestLabel}>Testing: </span>{sh.testingToday}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={s.btnGhost} onClick={() => openShowing(sh)}>Edit</button>
                  <button style={s.btnDanger} onClick={() => { if (window.confirm('Delete?')) deleteShowing(sh.id) }}>Delete</button>
                </div>
              </div>
              {sh.hypothesisUpdate && (
                <div style={s.showShift}><span style={s.showShiftLabel}>MOVE shift: </span>{sh.hypothesisUpdate}</div>
              )}
              {(sh.freeText || sh.respondedTo) && (
                <div style={s.showNote}>{sh.freeText || sh.respondedTo}</div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─── REFINEMENTS TAB ─────────────────────────────────────────────────────────
function RefinementsTab({ buyer }) {
  const ns = buyer.northStar
  const count = moveCount(ns)
  const shifts = [...buyer.showings].sort((a, b) => new Date(a.date) - new Date(b.date)).filter(s => s.hypothesisUpdate)
  const isTrue = buyer.isMatch || buyer.confidence === 'true'
  return (
    <div style={s.pane}>
      {isTrue && (
        <div style={s.trueMove}>
          <div style={s.trueMoveHead}>
            <span style={s.trueMoveTitle}>✓ TRUE MOVE FOUND</span>
            <span style={s.trueMoveMeta}>{buyer.showings.length} showings · {shifts.length} shifts</span>
          </div>
          {ns.oneSentence && <div style={s.trueMoveSentence}>{ns.oneSentence}</div>}
          <div style={s.trueMoveArc}>
            <div style={s.arcItem}><div style={s.arcLabel}>Starting diagnosis</div><div style={s.arcOld}>{count > 0 ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}` : 'Not built'}</div></div>
            {shifts.map((sh, i) => (
              <div key={sh.id} style={s.arcItem}>
                <div style={s.arcLabel}>Showing {i+1}{sh.address ? ` · ${sh.address}` : ''}</div>
                <div style={{ ...s.arcText, ...(i === shifts.length - 1 ? s.arcFinal : {}) }}>{sh.hypothesisUpdate}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={s.refIntro}>How the team's understanding of their MOVE evolved.</div>
      {buyer.showings.length === 0 ? <div style={s.emptySub}>Sharpen the MOVE after showings to see the arc here.</div> : (
        <div style={s.timeline}>
          <div style={s.tlItem}><div style={s.tlDot} /><div><div style={s.tlLabel}>Starting diagnosis</div><div style={s.tlText}>{count > 0 ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}` : <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Not built</span>}</div></div></div>
          {shifts.length === 0 ? <div style={{ paddingLeft: 20, fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>No MOVE shifts yet.</div>
            : shifts.map((sh, i) => (
              <div key={sh.id} style={s.tlItem}>
                <div style={s.tlDot} />
                <div><div style={s.tlLabel}>Showing {i+1}{sh.address ? ` · ${sh.address}` : ''}{sh.agentName ? ` · ${sh.agentName}` : ''}</div><div style={s.tlText}>{sh.hypothesisUpdate}</div></div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

// ─── SHOWING FORM ─────────────────────────────────────────────────────────────
function ShowingForm({ draft, setDraft, buyer, onSave, onCancel, isEdit }) {
  const upd = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const { start, finish, listening, transcript, setTranscript } = useVoice()
  const [phase, setPhase] = useState('idle')
  const [showDetail, setShowDetail] = useState(false)
  const ns = buyer?.northStar
  const moveSummary = ns?.oneSentence || [ns?.propertyType, ns?.location, ns?.motivation].filter(Boolean).join(' · ')

  const runVoice = () => { setPhase('listening'); start((text) => { setPhase('idle'); upd('freeText', text); upd('respondedTo', text) }) }
  const stopVoice = () => finish((text) => { setPhase('idle'); upd('freeText', text); upd('respondedTo', text) })

  return (
    <div style={s.formScreen}>
      <div style={s.formBar}>
        <button style={s.back} onClick={onCancel}>← Back</button>
        <div style={s.formBarTitle}>Sharpen the MOVE</div>
        <div style={{ width: 60 }} />
      </div>
      <div style={s.formScroll}>
        <div style={s.formBody}>
          {moveSummary && (
            <div style={s.formCurrentMove}>
              <div style={s.formCurrentMoveLabel}>CURRENT MOVE</div>
              <div style={s.formCurrentMoveText}>{moveSummary}</div>
            </div>
          )}

          <div style={s.twoCol}>
            <div><FL>Date</FL><input type="date" style={s.field} value={draft.date} onChange={e => upd('date', e.target.value)} /></div>
            <div><FL>Logged by</FL><input style={s.field} value={draft.agentName} placeholder="Agent" onChange={e => upd('agentName', e.target.value)} /></div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <FL>Property Address</FL>
            <input style={s.field} value={draft.address} placeholder="123 Main St" onChange={e => upd('address', e.target.value)} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <FL>What are you testing today?</FL>
            <input style={{ ...s.field, borderColor: C.gold }} value={draft.testingToday || ''} placeholder="One thing you're testing on this showing…" onChange={e => upd('testingToday', e.target.value)} />
          </div>

          <div style={s.debriefSection}>
            <div style={s.debriefSectionHead}>WHAT DID YOU LEARN?</div>
            <div style={s.debriefSectionSub}>Talk freely or type. AI will update the MOVE automatically.</div>
            {phase === 'idle' && <button style={s.voiceBtnLarge} onClick={runVoice}>🎙 Talk freely about the showing</button>}
            {phase === 'listening' && (
              <>
                <textarea style={s.transcriptArea} value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Listening…" />
                <button style={s.voiceBtnStop} onClick={stopVoice}>⏹ Done speaking</button>
                <div style={s.hint}>Pause 5 seconds to finish automatically.</div>
              </>
            )}
            <div style={{ marginTop: 12 }}>
              <div style={s.orRow}><span style={s.orText}>or type</span></div>
              <textarea style={{ ...s.transcriptArea, marginTop: 10 }} value={draft.freeText || ''}
                placeholder="What happened? What did they respond to? Did the MOVE shift?"
                onChange={e => { upd('freeText', e.target.value); upd('respondedTo', e.target.value) }} />
            </div>
          </div>

          <button style={s.detailToggle} onClick={() => setShowDetail(o => !o)}>
            {showDetail ? '▲ Hide detail fields' : '▼ Add detail manually'}
          </button>
          {showDetail && (
            <div style={s.detailFields}>
              {DEBRIEF.map(d => (
                <div key={d.key} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5 }}>
                    <span style={s.detailKey}>{d.label}</span>
                    <span style={s.detailQ}>{d.question}</span>
                  </div>
                  <textarea style={{ ...s.field, minHeight: 64, resize: 'vertical', ...(d.key === 'hypothesisUpdate' ? { borderColor: C.gold } : {}) }}
                    value={draft[d.key] || ''} onChange={e => upd(d.key, e.target.value)} />
                </div>
              ))}
            </div>
          )}
          <button style={s.saveBtn} onClick={() => onSave(draft)}>Save Showing</button>
        </div>
      </div>
    </div>
  )
}

// ─── MANAGER VIEW ─────────────────────────────────────────────────────────────
function ManagerView({ buyers, agents, onBack, onSelect }) {
  const [insights, setInsights] = useState({})
  const [loadingInsights, setLoadingInsights] = useState(false)

  const agentBuyers = agents.map(a => ({ agent: a, buyers: buyers.filter(b => b.agentName === a.name) })).filter(ab => ab.buyers.length > 0)

  const getInsights = async () => {
    setLoadingInsights(true)
    const results = {}
    for (const ab of agentBuyers) {
      try {
        const data = await callAI({ type: 'coaching_insights', agentName: ab.agent.name, buyers: ab.buyers })
        if (data.insights) results[ab.agent.name] = data.insights
      } catch (_) {}
    }
    setInsights(results); setLoadingInsights(false)
  }

  const teamStats = { total: buyers.length, matched: buyers.filter(b => b.isMatch || b.confidence === 'true').length, fuzzy: buyers.filter(b => !b.isMatch && moveCount(b.northStar) === 0).length, active: buyers.filter(b => b.status === 'Active').length }

  return (
    <div style={s.screen}>
      <div style={s.topBar}>
        <div style={s.topLeft}><div style={s.brand}>BUILD THE HOUSE</div><div style={s.brandTag}>Team View</div></div>
        <div style={s.topRight}>
          <button style={s.topBtnAccent} onClick={getInsights} disabled={loadingInsights}>{loadingInsights ? 'Analyzing…' : '✦ Get Coaching Insights'}</button>
          <button style={s.topBtn} onClick={onBack}>← Back</button>
        </div>
      </div>
      <div style={s.managerBody}>
        <div style={s.statRow}>
          {[{ label: 'Total Buyers', val: teamStats.total }, { label: 'Active', val: teamStats.active }, { label: 'True MOVE Found', val: teamStats.matched }, { label: 'Not Started', val: teamStats.fuzzy, alert: teamStats.fuzzy > 0 }].map(st => (
            <div key={st.label} style={s.statCard}><div style={{ ...s.statVal, ...(st.alert ? { color: C.red } : {}) }}>{st.val}</div><div style={s.statLabel}>{st.label}</div></div>
          ))}
        </div>
        {agentBuyers.map(({ agent, buyers: ab }) => {
          const matched = ab.filter(b => b.isMatch || b.confidence === 'true').length
          const avgShowings = matched > 0 ? (ab.filter(b => b.isMatch).reduce((s, b) => s + b.showings.length, 0) / matched).toFixed(1) : '—'
          const ins = insights[agent.name]
          return (
            <div key={agent.id} style={s.agentSection}>
              <div style={s.agentSectionHead}>
                <div><div style={s.agentSectionName}>{agent.name}</div><div style={s.agentSectionMeta}>{ab.length} buyers · {matched} true MOVEs{ab.filter(b => moveCount(b.northStar) === 0).length > 0 ? <span style={{ color: C.red }}> · {ab.filter(b => moveCount(b.northStar) === 0).length} not started</span> : ''}</div></div>
                {matched > 0 && <div style={s.agentAvg}>{avgShowings} avg showings</div>}
              </div>
              {ins && (
                <div style={s.insightCard}>
                  <div style={s.insightRow}><span style={s.insightKey}>Weakest letter:</span><span>{ins.weakestLetter} — {MOVE.find(m => m.letter === ins.weakestLetter)?.label}</span></div>
                  <div style={s.insightRow}><span style={s.insightKey}>Pattern:</span><span>{ins.pattern}</span></div>
                  <div style={s.insightCoach}><strong>Coaching prompt: </strong>{ins.coachingPrompt}</div>
                </div>
              )}
              <div style={s.agentBuyerList}>
                {ab.map(b => { const ms = moveStatus(b.northStar, b.isMatch, b.confidence); return (
                  <div key={b.id} style={s.agentBuyerRow} onClick={() => onSelect(b.id)}>
                    <div style={s.agentBuyerName}>{b.clientName || 'Unnamed'}</div>
                    <div style={{ ...s.agentBuyerStatus, color: ms.color }}>{ms.label}</div>
                    <div style={s.agentBuyerMeta}>{b.showings.length} showings</div>
                    <div style={s.agentBuyerArrow}>→</div>
                  </div>
                )})}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── PERFORMANCE VIEW ─────────────────────────────────────────────────────────
function PerformanceView({ buyers, agentName, onBack }) {
  const mine = buyers.filter(b => b.agentName === agentName)
  const matched = mine.filter(b => b.isMatch || b.confidence === 'true')
  const avgShowings = matched.length > 0 ? (matched.reduce((s, b) => s + b.showings.length, 0) / matched.length).toFixed(1) : '—'
  const totalShifts = mine.reduce((s, b) => s + b.showings.filter(sh => sh.hypothesisUpdate).length, 0)
  const [coaching, setCoaching] = useState(null)
  const [loadingCoaching, setLoadingCoaching] = useState(false)

  const getCoaching = async () => {
    if (mine.length === 0) return
    setLoadingCoaching(true)
    try {
      const data = await callAI({ type: 'coaching_insights', agentName, buyers: mine })
      if (data.insights) setCoaching(data.insights)
    } catch (_) {}
    setLoadingCoaching(false)
  }

  return (
    <div style={s.screen}>
      <div style={s.topBar}>
        <div style={s.topLeft}><div style={s.brand}>BUILD THE HOUSE</div><div style={s.brandTag}>My Performance</div></div>
        <div style={s.topRight}>
          <button style={s.topBtnAccent} onClick={getCoaching} disabled={loadingCoaching || mine.length === 0}>{loadingCoaching ? 'Analyzing…' : '✦ Get My Coaching'}</button>
          <button style={s.topBtn} onClick={onBack}>← Back</button>
        </div>
      </div>
      <div style={s.managerBody}>
        <div style={s.perfIntro}>These numbers reflect the quality of your diagnostic thinking.</div>
        <div style={s.statRow}>
          {[{ label: 'Total Buyers', val: mine.length }, { label: 'True MOVEs Found', val: matched.length }, { label: 'Avg Showings to Match', val: avgShowings }, { label: 'Total MOVE Shifts', val: totalShifts }].map(st => (
            <div key={st.label} style={s.statCard}><div style={s.statVal}>{st.val}</div><div style={s.statLabel}>{st.label}</div></div>
          ))}
        </div>
        {coaching && (
          <div style={s.coachCard}>
            <div style={s.coachCardHead}>YOUR COACHING</div>
            <div style={s.coachRow}><span style={s.coachKey}>Weakest letter:</span><span>{coaching.weakestLetter} — {MOVE.find(m => m.letter === coaching.weakestLetter)?.label}</span></div>
            <div style={s.coachRow}><span style={s.coachKey}>Pattern:</span><span>{coaching.pattern}</span></div>
            <div style={s.coachPrompt}><div style={s.coachPromptLabel}>Focus:</div><div style={s.coachPromptText}>{coaching.coachingPrompt}</div></div>
            {coaching.weakestLetter && MOVE_PROMPTS[MOVE.find(m => m.letter === coaching.weakestLetter)?.key] && (
              <div style={s.coachQuestions}>
                <div style={s.coachQHead}>Questions to ask your buyer right now:</div>
                {MOVE_PROMPTS[MOVE.find(m => m.letter === coaching.weakestLetter)?.key].map((q, i) => (
                  <div key={i} style={s.coachQRow}><span style={s.coachQNum}>{i+1}</span><span>{q}</span></div>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={s.perfHistory}>
          <div style={s.perfHistoryHead}>RECENT BUYERS</div>
          {mine.length === 0 && <div style={{ padding: '14px 16px', color: C.textMuted, fontSize: 13 }}>No buyers yet.</div>}
          {[...mine].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(b => {
            const ms = moveStatus(b.northStar, b.isMatch, b.confidence)
            return (
              <div key={b.id} style={s.perfRow}>
                <div style={s.perfRowName}>{b.clientName || 'Unnamed'}</div>
                <div style={{ ...s.perfRowStatus, color: ms.color }}>{ms.label}</div>
                <div style={s.perfRowMeta}>{b.showings.length} showings · {b.showings.filter(sh => sh.hypothesisUpdate).length} shifts</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────
function UserManagement({ agents, session, onBack, onRefresh }) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const setRole = async (agentId, role) => {
    const { error } = await supabase.from('agents').update({ role }).eq('id', agentId)
    if (error) setError(error.message); else { setMsg('Role updated.'); onRefresh() }
  }

  const removeAgent = async (agentId) => {
    if (!window.confirm('Remove this agent? This does not delete their buyers.')) return
    const { error } = await supabase.from('agents').delete().eq('id', agentId)
    if (error) setError(error.message); else { setMsg('Agent removed.'); onRefresh() }
  }

  return (
    <div style={s.screen}>
      <div style={s.topBar}>
        <div style={s.topLeft}><div style={s.brand}>BUILD THE HOUSE</div><div style={s.brandTag}>User Management</div></div>
        <button style={s.topBtn} onClick={onBack}>← Back</button>
      </div>
      <div style={s.managerBody}>
        {msg && <div style={s.successMsg}>{msg}</div>}
        {error && <div style={s.errorBox}>{error}</div>}

        <div style={s.userTable}>
          <div style={s.userTableHead}>
            <span>Name</span><span>Email</span><span>Role</span><span>Actions</span>
          </div>
          {agents.map(a => (
            <div key={a.id} style={s.userRow}>
              <span style={s.userRowName}>{a.name || '—'}</span>
              <span style={s.userRowEmail}>{a.email}</span>
              <span>
                <select style={s.roleSelect} value={a.role || 'user'} onChange={e => setRole(a.id, e.target.value)}
                  disabled={a.id === session.user.id}>
                  <option value="user">Agent</option>
                  <option value="admin">Admin</option>
                </select>
              </span>
              <span>
                {a.id !== session.user.id && (
                  <button style={s.btnDanger} onClick={() => removeAgent(a.id)}>Remove</button>
                )}
                {a.id === session.user.id && <span style={{ fontSize: 12, color: C.textMuted }}>You</span>}
              </span>
            </div>
          ))}
        </div>

        <div style={s.inviteNote}>
          <div style={s.inviteNoteHead}>Adding new agents</div>
          <div style={s.inviteNoteText}>New agents sign up at the app URL using the Create Account option. Once they've signed in, they'll appear in this list and you can assign their role.</div>
        </div>
      </div>
    </div>
  )
}

// ─── SHARED ───────────────────────────────────────────────────────────────────
function FL({ children }) { return <div style={s.fl}>{children}</div> }

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  screen:      { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: FONTS.sans, overflow: 'hidden', color: C.text, fontSize: 14 },
  buyerScreen: { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: FONTS.sans, overflow: 'hidden', color: C.text, fontSize: 14 },
  formScreen:  { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: FONTS.sans, overflow: 'hidden', color: C.text, fontSize: 14 },
  center:      { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: FONTS.sans, color: C.textMuted },

  // Top bar
  topBar:       { background: C.dark, padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, height: 56 },
  topLeft:      {},
  brand:        { fontSize: 11, letterSpacing: '0.2em', color: '#fff', fontWeight: 700, fontFamily: FONTS.sans },
  brandTag:     { fontSize: 11, color: C.onDarkSub, marginTop: 1 },
  topRight:     { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  agentChip:    { fontSize: 12, color: C.onDarkMid, marginRight: 4 },
  topBtn:       { padding: '6px 12px', border: '1px solid #374151', borderRadius: 6, background: 'transparent', color: C.onDarkMid, fontSize: 12, cursor: 'pointer', fontFamily: FONTS.sans },
  topBtnAccent: { padding: '6px 14px', border: 'none', borderRadius: 6, background: C.gold, color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: FONTS.sans, fontWeight: 600 },
  topBtnGhost:  { padding: '6px 10px', border: 'none', background: 'transparent', color: C.onDarkSub, fontSize: 12, cursor: 'pointer', fontFamily: FONTS.sans },

  // Mindset bar
  mindsetBar:   { background: C.darkMid, borderBottom: '1px solid #374151', padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px 28px', flexShrink: 0, maxHeight: 240, overflowY: 'auto' },
  mindsetBlock: {},
  mindsetHead:  { fontSize: 10, letterSpacing: '0.14em', color: C.gold, fontWeight: 700, marginBottom: 8, fontFamily: FONTS.sans },
  mindsetText:  { fontSize: 12, color: C.onDarkMid, lineHeight: 1.6 },
  mindsetRow:   { display: 'flex', gap: 8, marginBottom: 4 },
  mindsetLetter:{ fontSize: 12, color: C.gold, fontWeight: 700, minWidth: 14 },
  mindsetNum:   { fontSize: 11, color: C.gold, minWidth: 16 },

  // Filter bar
  filterBar:  { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0 },
  search:     { padding: '8px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, fontSize: 13, fontFamily: FONTS.sans, color: C.text, outline: 'none', width: 200 },
  pipe:       { width: 1, height: 20, background: C.border, flexShrink: 0 },
  filterSel:  { padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, fontSize: 13, fontFamily: FONTS.sans, color: C.text, cursor: 'pointer' },
  chips:      { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip:       { padding: '6px 12px', fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', color: C.textMid, fontFamily: FONTS.sans },
  chipOn:     { background: C.dark, color: '#fff', borderColor: C.dark, fontWeight: 600 },
  count:      { marginLeft: 'auto', fontSize: 12, color: C.textMuted },

  // Grid
  grid: { flex: 1, overflowY: 'auto', padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, alignContent: 'start' },

  // Cards
  card:       { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)' },
  cardMatch:  { borderColor: C.green, boxShadow: `0 0 0 1px ${C.green}` },
  cardUrgent: { borderColor: C.red },
  cardTop:    { background: C.dark, padding: '14px 16px', display: 'flex', justifyContent: 'space-between' },
  cardTopLeft:{},
  cardTopRight:{ textAlign: 'right' },
  cardName:   { fontSize: 16, color: '#fff', fontWeight: 700, marginBottom: 2 },
  cardSpouse: { fontSize: 13, color: C.onDarkSub },
  cardAgent:  { fontSize: 12, color: C.onDarkSub, marginBottom: 2 },
  cardStatus: { fontSize: 11, color: C.onDarkMid },
  cardBody:   { padding: '14px 16px' },
  cardMoveStatus: { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 8 },
  cardConfStage:  { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  confTrack:      { display: 'flex', gap: 4, alignItems: 'center' },
  confDot:        { width: 8, height: 8, borderRadius: '50%', background: C.border, transition: 'background 0.2s' },
  confLabel:      { fontSize: 11, fontWeight: 600 },
  cardSentence:   { fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: 8 },
  cardEmpty:      { fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginBottom: 8 },
  cardShift:      { fontSize: 12, color: C.textMid, background: C.bg, borderRadius: 6, padding: '6px 10px', lineHeight: 1.5, borderLeft: `3px solid ${C.gold}`, paddingLeft: 10 },
  cardShiftLabel: { fontWeight: 600, color: C.gold },
  cardFoot:       { padding: '0 16px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardMeta:       { fontSize: 11, color: C.textMuted },
  cardActions:    { display: 'flex', gap: 8 },
  cardSharpen:    { padding: '7px 14px', background: C.dark, color: C.gold, border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: FONTS.sans, fontWeight: 600 },
  cardOpen:       { padding: '7px 12px', background: C.bg, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: FONTS.sans },

  // Buyer view
  buyerBar:     { background: C.dark, padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, height: 52 },
  back:         { fontSize: 13, color: C.gold, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONTS.sans, fontWeight: 600 },
  buyerBarRight:{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  buyerHead:    { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '18px 24px', flexShrink: 0 },
  buyerNameRow: { marginBottom: 6 },
  buyerName:    { fontSize: 22, fontWeight: 700, color: C.text, fontFamily: FONTS.sans },
  buyerSpouse:  { fontSize: 16, color: C.textMid, fontWeight: 400 },
  buyerMetaRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  buyerAgent:   { fontSize: 13, color: C.textMid },
  buyerDot:     { color: C.border, fontSize: 14 },
  buyerStatusText: { fontSize: 13, color: C.textMid },
  buyerDiagnosis: { fontSize: 15, color: C.text, lineHeight: 1.6, fontStyle: 'italic', borderLeft: `3px solid ${C.gold}`, paddingLeft: 14, marginTop: 8 },

  // AI Panel
  aiLoad:     { background: C.darkMid, padding: '10px 24px', flexShrink: 0, fontSize: 13, color: C.gold, fontStyle: 'italic' },
  aiPanel:    { background: C.goldLight, borderBottom: `1px solid ${C.goldBorder}`, padding: '14px 24px', flexShrink: 0 },
  aiPanelTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  aiPanelTitle:{ fontSize: 13, fontWeight: 700, color: '#92400e' },
  aiSentence: { fontSize: 14, color: '#78350f', fontStyle: 'italic', marginBottom: 10, lineHeight: 1.5 },
  aiSub:      { fontSize: 12, color: '#92400e', marginBottom: 10 },
  aiChanges:  { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 },
  aiChange:   { display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', fontSize: 13 },
  aiChangeKey:{ fontSize: 10, letterSpacing: '0.08em', color: C.gold, fontWeight: 700, textTransform: 'uppercase', minWidth: 100, flexShrink: 0, marginTop: 2 },
  aiChangeOld:{ fontSize: 12, color: C.textMuted, textDecoration: 'line-through' },
  aiArrow:    { color: C.gold, fontWeight: 700, flexShrink: 0 },
  aiChangeNew:{ fontSize: 13, color: '#78350f', fontWeight: 600 },
  aiNoChange: { fontSize: 13, color: '#92400e', fontStyle: 'italic' },
  aiX:        { fontSize: 16, color: '#a16207', background: 'none', border: 'none', cursor: 'pointer' },
  aiActions:  { display: 'flex', gap: 10, marginTop: 4 },
  aiCoach:    { fontSize: 13, color: '#78350f', borderTop: `1px solid ${C.goldBorder}`, paddingTop: 10, marginTop: 8, lineHeight: 1.5 },

  // Tabs
  tabRow:   { display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.surface, overflowX: 'auto' },
  tabBtn:   { padding: '14px 20px', background: 'none', border: 'none', borderBottom: '3px solid transparent', fontSize: 14, cursor: 'pointer', color: C.textMuted, fontFamily: FONTS.sans, fontWeight: 500, marginBottom: -1, whiteSpace: 'nowrap' },
  tabBtnOn: { color: C.text, borderBottomColor: C.dark, fontWeight: 700 },
  tabBody:  { flex: 1, overflowY: 'auto', padding: '24px' },
  pane:     { maxWidth: 860 },

  // MOVE tab
  intakeBox:      { border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 24 },
  intakeBoxHead:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: C.surface },
  intakeBoxTitle: { fontSize: 15, fontWeight: 700, color: C.text, fontFamily: FONTS.sans },
  intakeBoxSub:   { fontSize: 13, color: C.textMuted, marginTop: 2 },
  intakeToggle:   { padding: '6px 14px', border: `1px solid ${C.border}`, borderRadius: 6, background: C.bg, color: C.textMid, fontSize: 12, cursor: 'pointer', fontFamily: FONTS.sans, flexShrink: 0 },
  intakeBody:     { padding: '0 16px 16px', background: C.bg, borderTop: `1px solid ${C.border}` },
  prepHint:       { marginTop: 14, padding: '12px 14px', background: C.surface, borderRadius: 8, border: `1px solid ${C.border}` },
  prepHintHead:   { fontSize: 12, color: C.textMuted, marginBottom: 8 },
  prepHintRow:    { display: 'flex', gap: 10, marginBottom: 6, fontSize: 13, color: C.text },
  prepN:          { color: C.gold, fontWeight: 700, minWidth: 16, flexShrink: 0 },
  transcriptArea: { width: '100%', boxSizing: 'border-box', marginTop: 12, padding: '12px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, fontSize: 14, fontFamily: FONTS.sans, color: C.text, resize: 'vertical', minHeight: 100, lineHeight: 1.6, outline: 'none' },
  extractedBox:   { background: C.surface, border: `1px solid ${C.goldBorder}`, borderRadius: 8, padding: '14px', marginTop: 12 },
  extractedHead:  { fontSize: 11, letterSpacing: '0.1em', color: C.gold, fontWeight: 700, marginBottom: 12 },
  extractedRow:   { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  extractedLetter:{ fontSize: 18, fontWeight: 700, color: C.gold, minWidth: 20, flexShrink: 0 },
  extractedVal:   { fontSize: 14, color: C.text, lineHeight: 1.5 },
  extractedSentence: { fontSize: 13, color: C.textMid, fontStyle: 'italic', borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 8, lineHeight: 1.5 },

  moveSectionHead:{ fontSize: 12, letterSpacing: '0.14em', color: C.textMuted, fontWeight: 700, marginBottom: 14 },
  moveGrid:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 18 },
  moveField:      { border: `2px solid ${C.border}`, borderRadius: 10, padding: '14px', background: C.surface },
  moveFieldOn:    { borderColor: C.gold, background: C.goldLight },
  moveFieldTop:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  moveFieldLeft:  { display: 'flex', gap: 10, alignItems: 'flex-start' },
  moveFieldLetter:{ fontSize: 26, fontWeight: 800, color: C.gold, lineHeight: 1, flexShrink: 0, fontFamily: FONTS.sans },
  moveFieldLabel: { fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.sans },
  moveFieldQ:     { fontSize: 12, color: C.textMuted, marginTop: 2, lineHeight: 1.4 },
  moveFieldInput: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 6, background: C.bg, fontSize: 14, fontFamily: FONTS.sans, color: C.text, outline: 'none', resize: 'vertical', lineHeight: 1.5 },
  fieldLive:      { fontSize: 13, color: C.textMid, fontStyle: 'italic', padding: '6px 8px', background: C.bg, borderRadius: 4, marginBottom: 8, lineHeight: 1.5 },
  micSmall:       { padding: '5px 9px', background: 'none', border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer', fontSize: 14, color: C.textMuted, flexShrink: 0 },
  micSmallActive: { background: C.redLight, borderColor: '#fca5a5', color: C.red },
  twoCol:         { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: 20 },

  confSection:    { paddingTop: 20, borderTop: `1px solid ${C.border}` },
  confSectionHead:{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 16, fontFamily: FONTS.sans },
  confTrackFull:  { display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto' },
  confStage:      { flex: 1, minWidth: 80, padding: '12px 10px', border: `2px solid ${C.border}`, borderRadius: 10, background: C.surface, cursor: 'pointer', textAlign: 'center', fontFamily: FONTS.sans },
  confStageCurrent: { borderColor: C.gold, background: C.goldLight },
  confStagePast:  { borderColor: C.border, background: C.bg },
  confStageNum:   { width: 28, height: 28, borderRadius: '50%', border: `2px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, margin: '0 auto 6px', color: C.textMuted, fontFamily: FONTS.sans },
  confStageLabel: { fontSize: 12, fontWeight: 600, color: C.textMid, marginBottom: 2, fontFamily: FONTS.sans },
  confStageSub:   { fontSize: 11, color: C.textMuted, lineHeight: 1.3 },
  confNudge:      { padding: '12px 16px', borderRadius: 8, border: `1px solid`, fontSize: 13, color: C.textMid, lineHeight: 1.6 },

  // Contacts
  contactCard:    { border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px', marginBottom: 14, background: C.surface },
  contactCardOn:  { borderColor: C.gold, background: C.goldLight },
  contactTop:     { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 },
  roleInput:      { fontSize: 12, fontWeight: 600, color: C.textMid, background: 'transparent', border: 'none', borderBottom: `1px dashed ${C.border}`, outline: 'none', padding: '2px 4px', fontFamily: FONTS.sans, textTransform: 'uppercase', width: 160 },
  primaryTag:     { fontSize: 11, background: C.dark, color: C.gold, padding: '3px 10px', borderRadius: 20, fontFamily: FONTS.sans },
  setPrimaryBtn:  { fontSize: 11, background: 'none', border: `1px solid ${C.border}`, borderRadius: 20, color: C.textMuted, padding: '3px 10px', cursor: 'pointer', fontFamily: FONTS.sans },

  // Fields
  fl:       { fontSize: 11, letterSpacing: '0.06em', color: C.textMuted, textTransform: 'uppercase', marginBottom: 6, fontWeight: 600, fontFamily: FONTS.sans },
  field:    { width: '100%', boxSizing: 'border-box', padding: '10px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, fontSize: 14, fontFamily: FONTS.sans, color: C.text, outline: 'none' },
  fieldLg:  { width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, fontSize: 15, fontFamily: FONTS.sans, color: C.text, outline: 'none' },
  fieldFilled: { background: C.goldLight, borderColor: C.gold, color: C.dark },

  // Showings
  showCard:    { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px', marginBottom: 14 },
  showTop:     { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  showAddr:    { fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONTS.sans },
  showDate:    { fontSize: 12, color: C.textMuted, marginTop: 3 },
  showTesting: { fontSize: 13, color: C.textMid, marginTop: 4, fontStyle: 'italic' },
  showTestLabel:{ fontWeight: 600, color: C.gold, fontStyle: 'normal' },
  showShift:   { background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 6, padding: '10px 12px', marginBottom: 10, fontSize: 13, color: C.text, lineHeight: 1.5 },
  showShiftLabel:{ fontWeight: 600, color: C.gold },
  showNote:    { fontSize: 13, color: C.textMid, lineHeight: 1.7 },

  // Refinements
  refIntro:  { fontSize: 14, color: C.textMid, fontStyle: 'italic', marginBottom: 20, padding: '12px 16px', background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, lineHeight: 1.6 },
  timeline:  { borderLeft: `2px solid ${C.border}`, paddingLeft: 24, marginLeft: 6 },
  tlItem:    { position: 'relative', paddingBottom: 24, display: 'flex', gap: 16 },
  tlDot:     { width: 10, height: 10, borderRadius: '50%', background: C.border, flexShrink: 0, marginTop: 4, marginLeft: -29 },
  tlLabel:   { fontSize: 11, color: C.textMuted, marginBottom: 4, fontWeight: 600, letterSpacing: '0.04em' },
  tlText:    { fontSize: 14, color: C.text, lineHeight: 1.6 },

  trueMove:      { background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 10, padding: '18px', marginBottom: 20 },
  trueMoveHead:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  trueMoveTitle: { fontSize: 14, fontWeight: 700, color: C.green, letterSpacing: '0.06em', fontFamily: FONTS.sans },
  trueMoveMeta:  { fontSize: 12, color: C.textMuted },
  trueMoveSentence: { fontSize: 15, color: C.text, fontStyle: 'italic', marginBottom: 14, lineHeight: 1.6 },
  trueMoveArc:   { borderLeft: `2px solid ${C.greenBorder}`, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  arcItem:       {},
  arcLabel:      { fontSize: 11, color: C.textMuted, marginBottom: 3, fontWeight: 600 },
  arcOld:        { fontSize: 13, color: C.textMuted, textDecoration: 'line-through' },
  arcText:       { fontSize: 13, color: C.textMid, lineHeight: 1.5 },
  arcFinal:      { fontSize: 15, color: C.green, fontWeight: 700, lineHeight: 1.5 },

  // Showing form
  formBar:       { background: C.dark, padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, height: 52 },
  formBarTitle:  { fontSize: 15, color: '#fff', fontWeight: 700, fontFamily: FONTS.sans },
  formScroll:    { flex: 1, overflowY: 'auto' },
  formBody:      { padding: '24px', maxWidth: 680, margin: '0 auto' },
  formCurrentMove: { background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 8, padding: '12px 16px', marginBottom: 20 },
  formCurrentMoveLabel: { fontSize: 10, letterSpacing: '0.12em', color: C.gold, fontWeight: 700, marginBottom: 6 },
  formCurrentMoveText: { fontSize: 14, color: C.text, lineHeight: 1.5, fontStyle: 'italic' },
  debriefSection: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px', marginBottom: 16 },
  debriefSectionHead: { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4, fontFamily: FONTS.sans },
  debriefSectionSub:  { fontSize: 12, color: C.textMuted, marginBottom: 14 },
  orRow:      { display: 'flex', alignItems: 'center', gap: 10 },
  orText:     { fontSize: 12, color: C.textMuted },
  detailToggle:{ fontSize: 13, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONTS.sans, padding: '6px 0', marginBottom: 6 },
  detailFields:{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px', marginBottom: 16 },
  detailKey:  { fontSize: 13, fontWeight: 700, color: C.text, fontFamily: FONTS.sans },
  detailQ:    { fontSize: 12, color: C.textMuted },
  saveBtn:    { width: '100%', padding: '16px', border: 'none', borderRadius: 10, background: C.dark, color: '#fff', fontSize: 16, cursor: 'pointer', fontFamily: FONTS.sans, fontWeight: 700, marginTop: 8 },

  // Voice buttons
  voiceBtnLarge: { width: '100%', marginTop: 12, padding: '16px', background: C.dark, color: C.gold, border: 'none', borderRadius: 10, fontSize: 16, cursor: 'pointer', fontFamily: FONTS.sans, fontWeight: 700 },
  voiceBtnStop:  { width: '100%', padding: '16px', background: C.red, color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, cursor: 'pointer', fontFamily: FONTS.sans, fontWeight: 700, marginTop: 10 },

  // Buttons
  btnPrimary:  { padding: '10px 20px', border: 'none', borderRadius: 8, background: C.dark, color: '#fff', fontSize: 14, cursor: 'pointer', fontFamily: FONTS.sans, fontWeight: 600 },
  btnSecondary:{ padding: '10px 18px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, color: C.textMid, fontSize: 14, cursor: 'pointer', fontFamily: FONTS.sans },
  btnAccent:   { padding: '7px 14px', border: 'none', borderRadius: 6, background: C.gold, color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: FONTS.sans, fontWeight: 600 },
  btnOutline:  { padding: '7px 14px', border: `1px solid ${C.gold}`, borderRadius: 6, background: 'transparent', color: C.gold, fontSize: 13, cursor: 'pointer', fontFamily: FONTS.sans },
  btnGhost:    { padding: '7px 14px', border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, color: C.textMid, fontSize: 13, cursor: 'pointer', fontFamily: FONTS.sans },
  btnDanger:   { padding: '7px 12px', border: '1px solid #fca5a5', borderRadius: 6, background: 'transparent', color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: FONTS.sans },
  statusSel:   { padding: '7px 10px', borderRadius: 6, border: '1px solid #374151', background: '#1f2937', fontSize: 12, fontFamily: FONTS.sans, cursor: 'pointer', color: C.onDarkMid },

  // Manager/Performance
  managerBody:   { flex: 1, overflowY: 'auto', padding: '24px' },
  statRow:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 28 },
  statCard:      { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 16px', textAlign: 'center' },
  statVal:       { fontSize: 32, fontWeight: 800, color: C.text, marginBottom: 4, fontFamily: FONTS.sans },
  statLabel:     { fontSize: 11, color: C.textMuted, letterSpacing: '0.06em', fontWeight: 600 },
  agentSection:  { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 16, overflow: 'hidden' },
  agentSectionHead: { padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  agentSectionName: { fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 3, fontFamily: FONTS.sans },
  agentSectionMeta: { fontSize: 13, color: C.textMid },
  agentAvg:      { fontSize: 14, color: C.textMid, fontWeight: 600 },
  insightCard:   { background: C.goldLight, border: `1px solid ${C.goldBorder}`, margin: '12px 18px', borderRadius: 8, padding: '12px 14px' },
  insightRow:    { display: 'flex', gap: 10, marginBottom: 6, fontSize: 13, alignItems: 'flex-start' },
  insightKey:    { color: C.gold, fontWeight: 700, minWidth: 120, flexShrink: 0, fontSize: 11, letterSpacing: '0.04em' },
  insightCoach:  { fontSize: 13, color: '#78350f', borderTop: `1px solid ${C.goldBorder}`, paddingTop: 8, lineHeight: 1.5 },
  agentBuyerList:{ padding: '4px 0 8px' },
  agentBuyerRow: { display: 'flex', alignItems: 'center', padding: '10px 18px', borderTop: `1px solid ${C.border}`, cursor: 'pointer' },
  agentBuyerName:{ flex: 1, fontSize: 14, color: C.text, fontWeight: 500 },
  agentBuyerStatus: { fontSize: 12, fontWeight: 600, minWidth: 140, flexShrink: 0 },
  agentBuyerMeta:{ fontSize: 11, color: C.textMuted, minWidth: 80, flexShrink: 0 },
  agentBuyerArrow: { fontSize: 13, color: C.textMuted },

  perfIntro:     { fontSize: 14, color: C.textMid, fontStyle: 'italic', marginBottom: 24, padding: '12px 16px', background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, lineHeight: 1.6 },
  coachCard:     { background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: 10, padding: '18px', marginBottom: 24 },
  coachCardHead: { fontSize: 10, letterSpacing: '0.16em', color: C.gold, fontWeight: 700, marginBottom: 14, fontFamily: FONTS.sans },
  coachRow:      { display: 'flex', gap: 10, marginBottom: 8, fontSize: 13, alignItems: 'flex-start' },
  coachKey:      { color: C.gold, fontWeight: 700, minWidth: 120, flexShrink: 0, fontSize: 11 },
  coachPrompt:   { background: C.surface, border: `1px solid ${C.goldBorder}`, borderRadius: 8, padding: '12px 14px', marginBottom: 14 },
  coachPromptLabel: { fontSize: 10, letterSpacing: '0.1em', color: C.gold, fontWeight: 700, marginBottom: 6 },
  coachPromptText:  { fontSize: 14, color: C.text, lineHeight: 1.6 },
  coachQuestions:   { borderTop: `1px solid ${C.goldBorder}`, paddingTop: 14 },
  coachQHead:    { fontSize: 11, color: C.gold, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 10 },
  coachQRow:     { display: 'flex', gap: 10, marginBottom: 8, fontSize: 14, color: C.text, lineHeight: 1.5 },
  coachQNum:     { color: C.gold, fontWeight: 700, minWidth: 18, flexShrink: 0 },
  perfHistory:   { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' },
  perfHistoryHead: { padding: '12px 18px', borderBottom: `1px solid ${C.border}`, fontSize: 10, letterSpacing: '0.14em', color: C.textMuted, fontWeight: 700, fontFamily: FONTS.sans },
  perfRow:       { display: 'flex', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${C.border}` },
  perfRowName:   { flex: 1, fontSize: 14, color: C.text, fontWeight: 500 },
  perfRowStatus: { fontSize: 12, fontWeight: 600, minWidth: 140, flexShrink: 0 },
  perfRowMeta:   { fontSize: 12, color: C.textMuted },

  // User management
  userTable:     { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 24 },
  userTableHead: { display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', padding: '12px 18px', background: C.bg, borderBottom: `1px solid ${C.border}`, fontSize: 11, letterSpacing: '0.08em', color: C.textMuted, fontWeight: 700 },
  userRow:       { display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', padding: '14px 18px', borderBottom: `1px solid ${C.border}`, alignItems: 'center', fontSize: 14 },
  userRowName:   { fontWeight: 600, color: C.text },
  userRowEmail:  { color: C.textMid, fontSize: 13 },
  roleSelect:    { padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 6, background: C.bg, fontSize: 13, fontFamily: FONTS.sans, color: C.text, cursor: 'pointer' },
  inviteNote:    { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px' },
  inviteNoteHead:{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 8, fontFamily: FONTS.sans },
  inviteNoteText:{ fontSize: 14, color: C.textMid, lineHeight: 1.6 },

  // Misc
  hint:        { fontSize: 12, color: C.textMuted, textAlign: 'center', marginTop: 8 },
  processing:  { fontSize: 14, color: C.gold, fontStyle: 'italic', padding: '12px 0' },
  errorBox:    { fontSize: 13, color: C.red, background: C.redLight, border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginTop: 8, lineHeight: 1.5 },
  successMsg:  { fontSize: 13, color: C.green, background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, lineHeight: 1.5 },
  emptyGrid:   { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' },
  emptyState:  { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', textAlign: 'center' },
  emptyTitle:  { fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 8, fontFamily: FONTS.sans },
  emptySub:    { fontSize: 14, color: C.textMuted, marginBottom: 20, lineHeight: 1.6 },
}
