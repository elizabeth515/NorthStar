import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
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
  { key: 'respondedTo',    label: 'Responded to',    question: 'What created energy?' },
  { key: 'pulledBackFrom', label: 'Pulled back from', question: "What didn't land?" },
  { key: 'moreTrue',       label: 'More true',        question: 'What confirmed the MOVE?' },
  { key: 'lessTrue',       label: 'Less true',        question: 'What challenged the MOVE?' },
  { key: 'hypothesisUpdate', label: 'The shift',      question: 'How does the MOVE change?' },
]

const STATUSES = ['Active', 'Under Contract', 'Closed', 'On Hold']

const PREP_QUESTIONS = [
  "What's not working about where you are now?",
  "What does the right home change for you?",
  "What would make you walk away from a house?",
  "What matters most — the thing you won't compromise on?",
  "What would you give up to get that?",
]

// ─── COLORS — communication only ─────────────────────────────────────────────
const C = {
  // Structure
  dark:      '#1c1917',
  mid:       '#292524',
  // Surfaces — warm white only
  bg:        '#f8f6f3',
  surface:   '#ffffff',
  border:    '#e8e3dc',
  borderSoft:'#f0ece6',
  // Text — charcoal scale
  text:      '#1c1917',
  textMid:   '#57534e',
  textMuted: '#a8a29e',
  // On dark
  onDark:    '#ffffff',
  onDarkMid: '#a8a29e',
  onDarkSub: '#78716c',
  // Communication colors — used ONLY when saying something
  gold:      '#b8962e',   // MOVE-related, active thinking
  goldLight: '#fdf8ec',   // MOVE field background
  goldBorder:'#e8d090',   // MOVE field border
  red:       '#c0392b',   // action required
  redLight:  '#fdf0ef',   // urgent card background
  green:     '#2d7a4f',   // match found, confirmed
  greenLight:'#edf7f1',   // match card background
  greenBorder:'#a8d4b8',  // match card border
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
    client_name: b.clientName, agent_name: b.agentName, status: b.status,
    contacts: b.contacts, north_star: b.northStar, showings: b.showings,
    confidence: b.confidence || '', is_match: b.isMatch || false,
    updated_at: new Date().toISOString(),
  }
}

function newBuyer(agentName = '') {
  return {
    clientName: '', agentName, status: 'Active',
    contacts: DEFAULT_CONTACTS.map(c => ({ ...c })),
    northStar: { ...DEFAULT_NS }, showings: [],
    confidence: '', isMatch: false,
  }
}

function newShowing(agentName = '') {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    address: '', agentName, testingToday: '', freeText: '',
    respondedTo: '', pulledBackFrom: '', moreTrue: '', lessTrue: '', hypothesisUpdate: '',
  }
}

function moveCount(ns) { return MOVE.filter(m => ns[m.key]).length }

function moveStatus(ns, isMatch) {
  if (isMatch) return { label: 'Match found', color: C.green }
  const c = moveCount(ns)
  if (c === 0) return { label: 'MOVE not started', color: C.red }
  if (c < 4) return { label: `MOVE building ${c}/4`, color: C.gold }
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
    setTranscript(''); latest.current = ''; setListening(true)
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

  return { start, stop, finish, listening, transcript }
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App({ session }) {
  const [buyers, setBuyers] = useState([])
  const [agents, setAgents] = useState([])
  const [currentAgent, setCurrentAgent] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('snapshot') // snapshot | buyer | showing | manager | performance
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

  const patch = useCallback((patch) => {
    setBuyers(p => p.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, ...patch }; save(nb); return nb }))
  }, [selectedId, save])

  const patchNS = useCallback((nsPatch) => {
    setBuyers(p => p.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, northStar: { ...b.northStar, ...nsPatch } }; save(nb); return nb }))
  }, [selectedId, save])

  const addBuyer = async () => {
    const agentName = currentAgent?.name || ''
    const { data, error } = await supabase.from('buyers').insert(buyerToDb(newBuyer(agentName))).select().single()
    if (!error && data) { const b = dbToBuyer(data); setBuyers(p => [b, ...p]); setSelectedId(b.id); setTab('move'); setView('buyer') }
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
        const res = await fetch('/api/suggest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'debrief', northStar: updated.northStar, showing }),
        })
        const data = await res.json()
        if (data.result) {
          const { coachingQuestion, oneSentence, ...nsU } = data.result
          const prev = { ...updated.northStar }
          const changed = Object.keys(nsU).filter(k => nsU[k] && nsU[k] !== prev[k])
          // Show proposal — agent must confirm before applying
          setAiNotif({ proposed: nsU, previous: prev, changed, coachingQuestion, oneSentence, pending: true })
        }
      } catch (_) {}
      setAiLoading(false)
    }
  }, [selectedId, save])

  const deleteBuyer = async (id) => {
    if (!window.confirm('Delete this buyer?')) return
    await supabase.from('buyers').delete().eq('id', id)
    setBuyers(p => p.filter(b => b.id !== id)); setView('snapshot'); setSelectedId(null)
  }

  const deleteShowing = useCallback((sid) => {
    setBuyers(p => p.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, showings: b.showings.filter(s => s.id !== sid) }; save(nb); return nb }))
  }, [selectedId, save])

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
/>

  if (view === 'manager' && isAdmin)
    return <ManagerView buyers={buyers} agents={agents} onBack={() => setView('snapshot')} onSelect={(id) => { setSelectedId(id); setView('buyer'); setTab('move') }} />

  if (view === 'performance')
    return <PerformanceView buyers={buyers} agentName={currentAgent?.name || ''} onBack={() => setView('snapshot')} />

  // ── SNAPSHOT ──
  return (
    <div style={s.screen}>
      <TopBar currentAgent={currentAgent} isAdmin={isAdmin}
        onAdd={addBuyer} onSignOut={() => supabase.auth.signOut()}
        onManager={() => setView('manager')} onPerformance={() => setView('performance')} />

      <div style={s.filterBar}>
        <input style={s.search} placeholder="Search buyers…" value={search} onChange={e => setSearch(e.target.value)} />
        <div style={s.pipe} />
        <select style={s.select} value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
          <option value="all">All agents</option>
          {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <div style={s.pipe} />
        <div style={s.chips}>
          {['all', ...STATUSES].map(st => (
            <button key={st} style={{ ...s.chip, ...(statusFilter === st ? s.chipOn : {}) }}
              onClick={() => setStatusFilter(st)}>
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
            <button style={s.btn} onClick={addBuyer}>+ Add Buyer</button>
          </div>
        )}
        {filtered.map(b => (
          <BuyerCard key={b.id} buyer={b}
            onOpen={() => { setSelectedId(b.id); setTab('move'); setView('buyer'); setAiNotif(null) }}
            onLog={() => { setSelectedId(b.id); openShowing() }} />
        ))}
      </div>
    </div>
  )
}

// ─── TOP BAR ──────────────────────────────────────────────────────────────────
function TopBar({ currentAgent, isAdmin, onAdd, onSignOut, onManager, onPerformance }) {
  const [mindset, setMindset] = useState(false)
  return (
    <>
      <div style={s.topBar}>
        <div>
          <div style={s.brand}>BUILD THE HOUSE</div>
          <div style={s.brandSub}>Powered by MOVE</div>
        </div>
        <div style={s.topRight}>
          <span style={s.agentName}>{currentAgent?.name || ''}</span>
          <button style={s.topBtn} onClick={() => setMindset(o => !o)}>Mindset</button>
          {isAdmin && <button style={s.topBtn} onClick={onManager}>Manager</button>}
          <button style={s.topBtn} onClick={onPerformance}>My Stats</button>
          <button style={s.topBtnGold} onClick={onAdd}>+ New Buyer</button>
          <button style={s.topBtnGhost} onClick={onSignOut}>Sign out</button>
        </div>
      </div>
      {mindset && <MindsetBar />}
    </>
  )
}

function MindsetBar() {
  return (
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
        <div style={s.mindsetText}><strong style={{ color: C.gold }}>Destroy Ambiguity.</strong> Every conversation should create clarity. If the picture is still fuzzy, keep digging.</div>
        <div style={{ ...s.mindsetText, marginTop: 6 }}><strong style={{ color: C.gold }}>Find the Best Answer.</strong> You are hired to find the best answer — not collect them.</div>
      </div>
    </div>
  )
}

// ─── BUYER CARD ───────────────────────────────────────────────────────────────
function BuyerCard({ buyer, onOpen, onLog }) {
  const ms = moveStatus(buyer.northStar, buyer.isMatch)
  const lastShowing = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
  const days = lastShowing ? daysSince(lastShowing.date) : null
  const urgent = !buyer.isMatch && moveCount(buyer.northStar) === 0

  return (
    <div style={{ ...s.card, ...(buyer.isMatch ? s.cardMatch : urgent ? s.cardUrgent : {}) }}>
      <div style={s.cardTop}>
        <div>
          <div style={s.cardName}>{buyer.clientName || 'Unnamed Buyer'}</div>
          {buyer.contacts?.[1]?.name && <div style={s.cardSpouse}>& {buyer.contacts[1].name}</div>}
          <div style={s.cardAgent}>{buyer.agentName || 'No agent'} · {buyer.status}</div>
        </div>
      </div>
      <div style={s.cardBody}>
        <div style={{ ...s.cardStatus, color: ms.color }}>{ms.label}</div>
        {buyer.northStar.oneSentence
          ? <div style={s.cardSentence}>{buyer.northStar.oneSentence}</div>
          : buyer.northStar.motivation
          ? <div style={s.cardSentence}>{buyer.northStar.motivation}{buyer.northStar.outcome ? ` · ${buyer.northStar.outcome}` : ''}</div>
          : <div style={s.cardEmpty}>No diagnosis yet.</div>}
        {lastShowing?.hypothesisUpdate && (
          <div style={s.cardShift}><span style={s.cardShiftLabel}>Last shift: </span>{lastShowing.hypothesisUpdate}</div>
        )}
      </div>
      <div style={s.cardFoot}>
        <span style={s.cardMeta}>{buyer.showings.length} showing{buyer.showings.length !== 1 ? 's' : ''}{days !== null ? ` · ${days}d ago` : ''}</span>
        <div style={s.cardActions}>
          {!buyer.isMatch && <button style={s.cardLog} onClick={e => { e.stopPropagation(); onLog() }}>+ Log Showing</button>}
          <button style={s.cardOpen} onClick={onOpen}>{buyer.isMatch ? 'View →' : moveCount(buyer.northStar) === 0 ? 'Start MOVE →' : 'Open →'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── BUYER VIEW ───────────────────────────────────────────────────────────────
function BuyerView({ buyer, agents, currentAgent, saving, tab, setTab, aiNotif, aiLoading, setAiNotif, patch, patchNS, saveShowing, deleteShowing, deleteBuyer, openShowing, onBack }) {
  return (
    <div style={s.buyerScreen}>
      <div style={s.buyerBar}>
        <button style={s.back} onClick={onBack}>← Buyers</button>
        <div style={s.buyerBarRight}>
          {!buyer.isMatch && <button style={s.btnGold} onClick={() => openShowing()}>+ Log Showing</button>}
          {!buyer.isMatch
            ? <button style={s.btnOutline} onClick={() => patch({ isMatch: true, status: 'Under Contract' })}>✓ Found their MOVE</button>
            : <button style={s.btnGhost} onClick={() => patch({ isMatch: false })}>Unmark</button>}
          <select style={s.statusSel} value={buyer.status} onChange={e => patch({ status: e.target.value })}>
            {STATUSES.map(st => <option key={st}>{st}</option>)}
          </select>
          <button style={s.btnDanger} onClick={() => deleteBuyer(buyer.id)}>Delete</button>
        </div>
      </div>

      <div style={s.buyerHead}>
        <div style={s.buyerName}>{buyer.clientName || 'Unnamed Buyer'}{buyer.contacts?.[1]?.name && <span style={s.buyerSpouse}> & {buyer.contacts[1].name}</span>}</div>
        <div style={s.buyerMeta}>{buyer.agentName || 'No agent'} · {buyer.status} · <span style={{ color: saving ? C.gold : C.textMuted }}>{saving ? 'Saving…' : 'Saved'}</span></div>
        {buyer.northStar.oneSentence && <div style={s.buyerSentence}>{buyer.northStar.oneSentence}</div>}
      </div>

      {aiLoading && <div style={s.aiLoad}>✦ Analyzing showing — updating the MOVE…</div>}
      {aiNotif && <AiNotif notif={aiNotif}
        onApply={(updates) => { patchNS(updates); setAiNotif(null) }}
        onDismiss={() => setAiNotif(null)} />}

      <div style={s.tabs}>
        {[['move','The MOVE'],['contacts','Contacts'],['showings',`Showings (${buyer.showings.length})`],['refinements','Refinements']].map(([k,l]) => (
          <button key={k} style={{ ...s.tab, ...(tab === k ? s.tabOn : {}) }} onClick={() => setTab(k)}>{l}</button>
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

// ─── AI CONFIRMATION PANEL ────────────────────────────────────────────────────
function AiNotif({ notif, onApply, onDismiss }) {
  const { proposed, previous, changed, coachingQuestion, oneSentence, pending } = notif
  const [accepted, setAccepted] = useState(changed?.reduce((a, k) => ({ ...a, [k]: true }), {}) || {})

  const handleApply = () => {
    const toApply = {}
    changed?.forEach(k => { if (accepted[k]) toApply[k] = proposed[k] })
    if (oneSentence) toApply.oneSentence = oneSentence
    onApply(toApply)
  }

  if (!pending) return null

  return (
    <div style={s.aiPanel}>
      <div style={s.aiTop}>
        <span style={s.aiTitle}>✦ MOVE update suggested from showing</span>
        <button style={s.aiX} onClick={onDismiss}>✕</button>
      </div>
      {oneSentence && <div style={s.aiSentence}>{oneSentence}</div>}
      {changed?.length > 0 ? (
        <>
          <div style={s.aiSubtitle}>Review each change. Uncheck any you want to keep as-is.</div>
          <div style={s.aiChanges}>
            {changed.map(k => (
              <div key={k} style={s.aiChange}>
                <input type="checkbox" checked={!!accepted[k]}
                  onChange={e => setAccepted(a => ({ ...a, [k]: e.target.checked }))}
                  style={{ marginTop: 2, flexShrink: 0, accentColor: C.gold }} />
                <span style={s.aiKey}>{MOVE.find(m => m.key === k)?.label || k}</span>
                <span style={s.aiOld}>{previous[k] || <em style={{ color: C.textMuted }}>was empty</em>}</span>
                <span style={s.aiArrow}>→</span>
                <span style={s.aiNew}>{proposed[k]}</span>
              </div>
            ))}
          </div>
          <div style={s.aiActions}>
            <button style={s.aiApply} onClick={handleApply}>Apply selected changes</button>
            <button style={s.aiSkip} onClick={onDismiss}>Keep current MOVE</button>
          </div>
        </>
      ) : (
        <div style={{ ...s.aiCoach, borderTop: 'none', paddingTop: 0 }}>No MOVE changes suggested.</div>
      )}
      {coachingQuestion && (
        <div style={s.aiCoach}><span style={s.aiCoachLabel}>Next question to answer: </span>{coachingQuestion}</div>
      )}
    </div>
  )
}

// ─── VOICE BUTTON — consistent across app ────────────────────────────────────
function VoiceButton({ listening, onStart, onStop, label = 'Speak', size = 'normal' }) {
  const style = size === 'large'
    ? { ...s.voiceBtnLarge, ...(listening ? s.voiceBtnLargeActive : {}) }
    : { ...s.voiceBtn, ...(listening ? s.voiceBtnActive : {}) }
  return (
    <button style={style} onClick={listening ? onStop : onStart}>
      {listening ? '⏹' : '🎙'} {listening ? 'Done speaking' : label}
    </button>
  )
}

// ─── MOVE TAB ─────────────────────────────────────────────────────────────────
function MoveTab({ buyer, patchNS, patch }) {
  const ns = buyer.northStar
  const count = moveCount(ns)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const { start, finish, listening, transcript } = useVoice()
  const [processing, setProcessing] = useState(false)
  const [rawText, setRawText] = useState('')
  const [phase, setPhase] = useState('idle') // idle | listening | review | processing

  const runVoice = () => {
    setPhase('listening'); setRawText('')
    start((text) => { setRawText(text); setPhase('review') })
  }

  const stopVoice = () => finish((text) => { setRawText(text); setPhase('review') })

  const [intakeError, setIntakeError] = useState('')

  const processIntake = async (text) => {
    if (!text.trim()) return
    setPhase('processing')
    setIntakeError('')
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'intake', transcript: text }),
      })
      const data = await res.json()
      if (data.extracted) {
        patchNS(data.extracted)
        setIntakeOpen(false)
        setPhase('idle')
        setRawText('')
      } else if (data.error) {
        setIntakeError(data.error + (data.detail ? ': ' + data.detail : ''))
        setPhase('review')
      } else {
        setIntakeError('No data returned. Check that ANTHROPIC_API_KEY is set in Vercel.')
        setPhase('review')
      }
    } catch (err) {
      setIntakeError('Request failed — check your internet connection and Vercel API key.')
      setPhase('review')
    }
  }

  const CONFIDENCE = [
    { val: 'fuzzy', label: "Can't see the MOVE", sub: 'Still diagnosing' },
    { val: 'getting-clearer', label: 'MOVE is forming', sub: 'Tests confirming' },
    { val: 'sharp', label: 'MOVE is clear', sub: 'Ready to prescribe' },
  ]

  const nudge = {
    fuzzy: "What's the one thing still unclear? Make that the focus of the next showing.",
    'getting-clearer': 'Keep testing. The picture is forming.',
    sharp: 'Sharp diagnosis. Now prescribe the right home.',
  }

  return (
    <div style={s.pane}>

      {/* Voice intake — at top */}
      <div style={s.moveVoiceTop}>
        <div style={s.moveVoiceTopLabel}>Tell me about this buyer</div>
        <div style={s.moveVoiceTopSub}>Talk freely after the consultation. AI builds the MOVE from what you say.</div>
        <VoiceButton
          listening={phase === 'listening'}
          onStart={runVoice}
          onStop={stopVoice}
          label="Tap and talk freely"
          size="large"
        />
        {phase === 'listening' && (
          <div style={s.liveText}>{transcript || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Listening…</span>}</div>
        )}
        {phase === 'review' && (
          <div style={s.intakeReview}>
            <div style={s.reviewLabel}>What you said:</div>
            <textarea style={{ ...s.textarea, minHeight: 70, marginBottom: 10 }} value={rawText} onChange={e => setRawText(e.target.value)} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={s.btn} onClick={() => processIntake(rawText)}>Build the MOVE →</button>
              <button style={s.btnGhost} onClick={() => { setPhase('idle'); setRawText('') }}>Re-record</button>
            </div>
          </div>
        )}
        {phase === 'processing' && <div style={s.processing}>✦ Building the MOVE…</div>}
        <button style={s.prepToggle} onClick={() => setIntakeOpen(o => !o)}>
          {intakeOpen ? '▲ Hide consultation prep' : '▼ Consultation prep questions'}
        </button>
        {intakeOpen && (
          <div style={s.prepPanel}>
            <div style={s.prepPanelHead}>Before the consultation, listen for:</div>
            <div style={s.prepList}>
              {PREP_QUESTIONS.map((q, i) => (
                <div key={i} style={s.prepRow}><span style={s.prepN}>{i+1}</span><span style={s.prepQ}>{q}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* MOVE fields */}
      <div style={s.moveWord}>MOVE</div>
      <div style={s.moveGrid}>
        {MOVE.map(m => (
          <MoveField key={m.key} m={m} value={ns[m.key] || ''} onChange={v => patchNS({ [m.key]: v })} />
        ))}
      </div>

      {/* Location + type */}
      <div style={s.twoCol}>
        <div>
          <FL>Property Type</FL>
          <input style={{ ...s.field, ...(ns.propertyType ? s.fieldOn : {}) }} value={ns.propertyType || ''}
            placeholder="e.g. single family home" onChange={e => patchNS({ propertyType: e.target.value })} />
        </div>
        <div>
          <FL>Location</FL>
          <input style={{ ...s.field, ...(ns.location ? s.fieldOn : {}) }} value={ns.location || ''}
            placeholder="e.g. Green Hills" onChange={e => patchNS({ location: e.target.value })} />
        </div>
      </div>

      {/* Intake panel */}
      {intakeOpen && (
        <div style={s.intakePanel}>
          <div style={s.intakePrepHead}>Before the consultation, listen for:</div>
          <div style={s.prepList}>
            {PREP_QUESTIONS.map((q, i) => (
              <div key={i} style={s.prepRow}><span style={s.prepN}>{i+1}</span><span style={s.prepQ}>{q}</span></div>
            ))}
          </div>
          <div style={s.intakeDivide}>After the consultation —</div>
          <div style={s.intakePrompt}>Tell me about this buyer.</div>

          {phase === 'idle' && (
            <button style={s.micReady} onClick={runVoice}>🎙 Tap and talk freely</button>
          )}
          {phase === 'listening' && (
            <>
              <div style={s.liveText}>{transcript || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Listening…</span>}</div>
              <button style={s.micActive} onClick={stopVoice}>⏹ Done speaking</button>
              <div style={s.hint}>Pause 5 seconds to finish automatically.</div>
            </>
          )}
          {phase === 'review' && (
            <>
              <div style={s.reviewLabel}>What you said:</div>
              <textarea style={{ ...s.textarea, minHeight: 80, marginBottom: 12 }} value={rawText}
                onChange={e => setRawText(e.target.value)} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={s.btn} onClick={() => processIntake(rawText)}>Build the MOVE →</button>
                <button style={s.btnGhost} onClick={() => { setPhase('idle'); setRawText('') }}>Re-record</button>
              </div>
            </>
          )}
          {phase === 'processing' && <div style={s.processing}>✦ Building the MOVE…</div>}
        </div>
      )}

      {/* Confidence signal */}
      <div style={s.confSection}>
        <div style={s.confLabel}>How clearly do you see their MOVE?</div>
        <div style={s.confOptions}>
          {CONFIDENCE.map(opt => (
            <button key={opt.val}
              style={{ ...s.confOpt, ...(buyer.confidence === opt.val ? s.confOptOn : {}) }}
              onClick={() => patch({ confidence: opt.val })}>
              <div style={{ ...s.confOptLabel, ...(buyer.confidence === opt.val ? { color: C.gold } : {}) }}>{opt.label}</div>
              <div style={s.confOptSub}>{opt.sub}</div>
            </button>
          ))}
        </div>
        {buyer.confidence && nudge[buyer.confidence] && (
          <div style={s.confNudge}>{nudge[buyer.confidence]}</div>
        )}
      </div>

    </div>
  )
}

function MoveField({ m, value, onChange }) {
  const { start, finish, listening, transcript } = useVoice()
  const [active, setActive] = useState(false)

  const handleStart = () => { setActive(true); start((t) => { setActive(false); if (t) onChange(t) }) }
  const handleStop = () => { finish((t) => { setActive(false); if (t) onChange(t) }) }

  return (
    <div style={{ ...s.moveField, ...(value ? s.moveFieldOn : {}) }}>
      <div style={s.moveFieldHead}>
        <span style={s.moveLetter}>{m.letter}</span>
        <div style={{ flex: 1 }}>
          <div style={s.moveLabel}>{m.label}</div>
          <div style={s.moveQ}>{m.question}</div>
        </div>
        <VoiceButton listening={active} onStart={handleStart} onStop={handleStop} label="" size="small" />
      </div>
      {active && <div style={s.fieldLive}>{transcript || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Listening…</span>}</div>}
      <input style={s.moveInput} value={value} placeholder="Type or speak →" onChange={e => onChange(e.target.value)} />
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
            {c.isPrimary ? <span style={s.primaryTag}>Primary</span> : <button style={s.setPrimary} onClick={() => setPrimary(c.id)}>Set as primary</button>}
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
        <div style={s.empty}>
          <div style={s.emptyTitle}>No showings yet</div>
          <div style={s.emptySub}>Log the first showing to start testing the MOVE.</div>
          <button style={s.btn} onClick={() => openShowing()}>+ Log First Showing</button>
        </div>
      ) : (
        <>
          <button style={{ ...s.btn, marginBottom: 20 }} onClick={() => openShowing()}>+ Log Showing</button>
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
  return (
    <div style={s.pane}>
      {buyer.isMatch && (
        <div style={s.matchCard}>
          <div style={s.matchHead}>
            <span style={s.matchTitle}>✓ MOVE FOUND</span>
            <span style={s.matchMeta}>{buyer.showings.length} showings · {shifts.length} shifts</span>
          </div>
          {ns.oneSentence && <div style={s.matchSentence}>{ns.oneSentence}</div>}
          <div style={s.matchArc}>
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
      {buyer.showings.length === 0
        ? <div style={s.emptySub}>Log showings to see the MOVE evolve here.</div>
        : (
          <div style={s.timeline}>
            <div style={s.tlItem}><div style={s.tlDot} /><div><div style={s.tlLabel}>Starting diagnosis</div><div style={s.tlText}>{count > 0 ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}` : <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Not yet built</span>}</div></div></div>
            {shifts.length === 0
              ? <div style={{ paddingLeft: 20, fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>No MOVE shifts yet.</div>
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
  const { start, finish, listening, transcript } = useVoice()
  const [phase, setPhase] = useState('idle') // idle | listening | processing
  const [showDetail, setShowDetail] = useState(false)
  const ns = buyer?.northStar
  const moveSummary = ns?.oneSentence || [ns?.propertyType, ns?.location, ns?.motivation].filter(Boolean).join(' · ')

  const runVoice = () => {
    setPhase('listening')
    start((text) => { setPhase('idle'); upd('freeText', text); upd('respondedTo', text) })
  }

  const stopVoice = () => finish((text) => { setPhase('idle'); upd('freeText', text); upd('respondedTo', text) })

  return (
    <div style={s.formScreen}>
      <div style={s.formBar}>
        <button style={s.back} onClick={onCancel}>← Back</button>
        <div style={s.formTitle}>{isEdit ? 'Edit Showing' : 'Log a Showing'}</div>
        <div style={{ width: 60 }} />
      </div>
      <div style={s.formScroll}>
        <div style={s.formBody}>

          {/* Current MOVE */}
          {moveSummary && (
            <div style={s.formMove}>
              <div style={s.formMoveLabel}>CURRENT MOVE</div>
              <div style={s.formMoveText}>{moveSummary}</div>
            </div>
          )}

          {/* Date + address */}
          <div style={s.twoCol}>
            <div><FL>Date</FL><input type="date" style={s.field} value={draft.date} onChange={e => upd('date', e.target.value)} /></div>
            <div><FL>Logged by</FL><input style={s.field} value={draft.agentName} placeholder="Agent" onChange={e => upd('agentName', e.target.value)} /></div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <FL>Property Address</FL>
            <input style={s.field} value={draft.address} placeholder="123 Main St" onChange={e => upd('address', e.target.value)} />
          </div>

          {/* Testing today */}
          <div style={{ marginBottom: 20 }}>
            <FL>What are you testing today?</FL>
            <input style={{ ...s.field, borderColor: C.gold }} value={draft.testingToday || ''}
              placeholder="e.g. Whether school proximity matters more than the home…"
              onChange={e => upd('testingToday', e.target.value)} />
          </div>

          {/* Main debrief */}
          <div style={s.debriefBox}>
            <div style={s.debriefBoxHead}>WHAT DID YOU LEARN?</div>
            <div style={s.debriefBoxSub}>Talk freely or type. AI updates the MOVE automatically.</div>

            <VoiceButton
              listening={phase === 'listening'}
              onStart={runVoice}
              onStop={stopVoice}
              label="Tap and talk freely"
              size="large"
            />
            {phase === 'listening' && (
              <div style={s.liveText}>{transcript || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Listening… speak naturally.</span>}</div>
            )}

            <div style={s.orRow}><span style={s.orText}>or type</span></div>
            <textarea style={{ ...s.textarea, minHeight: 110 }} value={draft.freeText || ''}
              placeholder="What happened? What did they respond to? Did the MOVE shift?"
              onChange={e => { upd('freeText', e.target.value); upd('respondedTo', e.target.value) }} />
          </div>

          {/* Detail toggle */}
          <button style={s.detailToggle} onClick={() => setShowDetail(o => !o)}>
            {showDetail ? '▲ Hide detail fields' : '▼ Add detail manually'}
          </button>
          {showDetail && (
            <div style={s.detailFields}>
              {DEBRIEF.map(d => (
                <div key={d.key} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={s.detailKey}>{d.label}</span>
                    <span style={s.detailQ}>{d.question}</span>
                  </div>
                  <textarea style={{ ...s.textarea, minHeight: 60, ...(d.key === 'hypothesisUpdate' ? { borderColor: C.gold } : {}) }}
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

  const agentBuyers = agents.map(a => ({
    agent: a,
    buyers: buyers.filter(b => b.agentName === a.name),
  })).filter(ab => ab.buyers.length > 0)

  const loadInsights = async () => {
    setLoadingInsights(true)
    const results = {}
    for (const ab of agentBuyers) {
      try {
        const res = await fetch('/api/suggest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'coaching_insights', agentName: ab.agent.name, buyers: ab.buyers }),
        })
        const data = await res.json()
        if (data.insights) results[ab.agent.name] = data.insights
      } catch (_) {}
    }
    setInsights(results)
    setLoadingInsights(false)
  }

  const teamStats = {
    total: buyers.length,
    matched: buyers.filter(b => b.isMatch).length,
    fuzzy: buyers.filter(b => !b.isMatch && moveCount(b.northStar) === 0).length,
    active: buyers.filter(b => b.status === 'Active').length,
  }

  return (
    <div style={s.screen}>
      <div style={s.topBar}>
        <div>
          <div style={s.brand}>BUILD THE HOUSE</div>
          <div style={s.brandSub}>Manager View</div>
        </div>
        <div style={s.topRight}>
          <button style={s.topBtn} onClick={onBack}>← Back</button>
          <button style={s.topBtnGold} onClick={loadInsights} disabled={loadingInsights}>
            {loadingInsights ? 'Analyzing…' : '✦ Get Coaching Insights'}
          </button>
        </div>
      </div>

      <div style={s.managerBody}>
        {/* Team summary */}
        <div style={s.statRow}>
          {[
            { label: 'Total Buyers', val: teamStats.total },
            { label: 'Active', val: teamStats.active },
            { label: 'Matches Found', val: teamStats.matched },
            { label: 'MOVE Not Started', val: teamStats.fuzzy, alert: teamStats.fuzzy > 0 },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={{ ...s.statVal, ...(stat.alert ? { color: C.red } : {}) }}>{stat.val}</div>
              <div style={s.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Agent sections */}
        {agentBuyers.map(({ agent, buyers: ab }) => {
          const matched = ab.filter(b => b.isMatch).length
          const fuzzy = ab.filter(b => !b.isMatch && moveCount(b.northStar) === 0).length
          const avgShowings = ab.filter(b => b.isMatch && b.showings.length > 0).reduce((sum, b) => sum + b.showings.length, 0) / (matched || 1)
          const ins = insights[agent.name]

          return (
            <div key={agent.id} style={s.agentSection}>
              <div style={s.agentSectionHead}>
                <div>
                  <div style={s.agentSectionName}>{agent.name}</div>
                  <div style={s.agentSectionMeta}>{ab.length} buyers · {matched} matches · {fuzzy > 0 ? <span style={{ color: C.red }}>{fuzzy} MOVE not started</span> : 'all started'}</div>
                </div>
                {matched > 0 && <div style={s.agentAvg}>{avgShowings.toFixed(1)} avg showings to match</div>}
              </div>

              {ins && (
                <div style={s.insightCard}>
                  <div style={s.insightRow}>
                    <span style={s.insightLabel}>Weakest letter:</span>
                    <span style={s.insightVal}>{ins.weakestLetter}</span>
                  </div>
                  <div style={s.insightRow}>
                    <span style={s.insightLabel}>Pattern:</span>
                    <span style={s.insightVal}>{ins.pattern}</span>
                  </div>
                  <div style={s.insightCoach}>
                    <span style={s.insightCoachLabel}>Coaching prompt: </span>
                    {ins.coachingPrompt}
                  </div>
                </div>
              )}

              <div style={s.agentBuyerList}>
                {ab.map(b => {
                  const ms = moveStatus(b.northStar, b.isMatch)
                  return (
                    <div key={b.id} style={s.agentBuyerRow} onClick={() => onSelect(b.id)}>
                      <div style={s.agentBuyerName}>{b.clientName || 'Unnamed'}</div>
                      <div style={{ ...s.agentBuyerStatus, color: ms.color }}>{ms.label}</div>
                      <div style={s.agentBuyerShowing}>{b.showings.length} showings</div>
                      <div style={s.agentBuyerArrow}>→</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── PERFORMANCE VIEW ─────────────────────────────────────────────────────────
const MOVE_PROMPTS = {
  motivation: ["What finally made them decide to move now?", "What's not working about where they are today?", "What would happen if they didn't move this year?"],
  outcome:    ["What does their life look like once they're in the right home?", "What changes for them the day after they close?", "What are they really buying — beyond the house?"],
  veto:       ["What would make them walk away from a deal they otherwise love?", "What's the one thing they absolutely won't compromise on?", "Have they walked away from a house before? Why?"],
  exchange:   ["What would they give up to get what matters most?", "If they had to choose between X and Y — which wins?", "What trade would feel worth it six months after closing?"],
}

function PerformanceView({ buyers, agentName, onBack }) {
  const mine = buyers.filter(b => b.agentName === agentName)
  const matched = mine.filter(b => b.isMatch)
  const avgShowings = matched.length > 0 ? (matched.reduce((s, b) => s + b.showings.length, 0) / matched.length).toFixed(1) : '—'
  const totalShifts = mine.reduce((s, b) => s + b.showings.filter(sh => sh.hypothesisUpdate).length, 0)
  const avgShifts = matched.length > 0 ? (matched.reduce((s, b) => s + b.showings.filter(sh => sh.hypothesisUpdate).length, 0) / matched.length).toFixed(1) : '—'
  const [coaching, setCoaching] = useState(null)
  const [loadingCoaching, setLoadingCoaching] = useState(false)

  const getCoaching = async () => {
    if (mine.length === 0) return
    setLoadingCoaching(true)
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'coaching_insights', agentName, buyers: mine }),
      })
      const data = await res.json()
      if (data.insights) setCoaching(data.insights)
    } catch (_) {}
    setLoadingCoaching(false)
  }

  return (
    <div style={s.screen}>
      <div style={s.topBar}>
        <div>
          <div style={s.brand}>BUILD THE HOUSE</div>
          <div style={s.brandSub}>Your Diagnostic Performance</div>
        </div>
        <div style={s.topRight}>
          <button style={s.topBtnGold} onClick={getCoaching} disabled={loadingCoaching || mine.length === 0}>
            {loadingCoaching ? 'Analyzing…' : '✦ Get My Coaching'}
          </button>
          <button style={s.topBtn} onClick={onBack}>← Back</button>
        </div>
      </div>

      <div style={s.managerBody}>
        <div style={s.perfIntro}>Your diagnosis is getting sharper. These numbers reflect the quality of your thinking — not just your activity.</div>

        <div style={s.statRow}>
          {[
            { label: 'Total Buyers', val: mine.length },
            { label: 'Matches Found', val: matched.length },
            { label: 'Avg Showings to Match', val: avgShowings },
            { label: 'Total MOVE Shifts', val: totalShifts },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={s.statVal}>{stat.val}</div>
              <div style={s.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* AI Coaching */}
        {coaching && (
          <div style={s.coachingCard}>
            <div style={s.coachingCardHead}>YOUR COACHING</div>
            <div style={s.coachingRow}>
              <span style={s.coachingKey}>Weakest letter:</span>
              <span style={s.coachingVal}>{coaching.weakestLetter} — {MOVE.find(m => m.letter === coaching.weakestLetter)?.label}</span>
            </div>
            <div style={s.coachingRow}>
              <span style={s.coachingKey}>Pattern:</span>
              <span style={s.coachingVal}>{coaching.pattern}</span>
            </div>
            <div style={s.coachingPromptBlock}>
              <div style={s.coachingPromptLabel}>Coaching focus:</div>
              <div style={s.coachingPromptText}>{coaching.coachingPrompt}</div>
            </div>
            {coaching.weakestLetter && MOVE_PROMPTS[MOVE.find(m => m.letter === coaching.weakestLetter)?.key] && (
              <div style={s.coachingQList}>
                <div style={s.coachingQListLabel}>Questions to ask your buyer right now:</div>
                {MOVE_PROMPTS[MOVE.find(m => m.letter === coaching.weakestLetter)?.key].map((q, i) => (
                  <div key={i} style={s.coachingQItem}><span style={s.coachingQNum}>{i+1}</span><span>{q}</span></div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={s.perfHistory}>
          <div style={s.perfHistoryHead}>RECENT BUYERS</div>
          {mine.length === 0 && <div style={s.emptySub}>No buyers yet.</div>}
          {[...mine].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(b => {
            const ms = moveStatus(b.northStar, b.isMatch)
            const shifts = b.showings.filter(s => s.hypothesisUpdate).length
            return (
              <div key={b.id} style={s.perfRow}>
                <div style={s.perfRowName}>{b.clientName || 'Unnamed'}</div>
                <div style={{ ...s.perfRowStatus, color: ms.color }}>{ms.label}</div>
                <div style={s.perfRowMeta}>{b.showings.length} showings · {shifts} shifts</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── SHARED ───────────────────────────────────────────────────────────────────
function FL({ children }) { return <div style={s.fl}>{children}</div> }

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  // Layout
  screen:      { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text, fontSize: 14 },
  buyerScreen: { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text, fontSize: 14 },
  formScreen:  { display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: 'hidden', color: C.text, fontSize: 14 },
  center:      { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Georgia, serif', color: C.textMuted, fontSize: 14 },

  // Top bar
  topBar:    { background: C.dark, padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  brand:     { fontSize: 10, letterSpacing: '0.22em', color: C.gold, fontWeight: 'bold', marginBottom: 2 },
  brandSub:  { fontSize: 11, color: C.onDarkSub },
  topRight:  { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  agentName: { fontSize: 12, color: C.onDarkMid },
  topBtn:    { padding: '6px 12px', border: '1px solid #3c3835', borderRadius: 4, background: 'transparent', color: C.onDarkMid, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  topBtnGold:{ padding: '6px 14px', border: 'none', borderRadius: 4, background: C.gold, color: C.dark, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  topBtnGhost:{ padding: '6px 10px', border: 'none', borderRadius: 4, background: 'transparent', color: C.onDarkSub, fontSize: 11, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Mindset bar
  mindsetBar:   { background: C.mid, borderBottom: '1px solid #3c3835', padding: '14px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px 24px', flexShrink: 0, overflowY: 'auto', maxHeight: 240 },
  mindsetBlock: {},
  mindsetHead:  { fontSize: 9, letterSpacing: '0.16em', color: C.gold, fontWeight: 'bold', marginBottom: 8 },
  mindsetText:  { fontSize: 12, color: C.onDarkMid, lineHeight: 1.6 },
  mindsetRow:   { display: 'flex', gap: 8, marginBottom: 4 },
  mindsetLetter:{ fontSize: 12, color: C.gold, fontWeight: 'bold', minWidth: 12 },
  mindsetNum:   { fontSize: 11, color: C.gold, minWidth: 14 },

  // Filter bar
  filterBar: { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 },
  search:    { padding: '7px 12px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.bg, fontSize: 13, fontFamily: 'Georgia, serif', color: C.text, outline: 'none', width: 180 },
  pipe:      { width: 1, height: 18, background: C.border, flexShrink: 0 },
  select:    { padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.bg, fontSize: 12, fontFamily: 'Georgia, serif', color: C.text, cursor: 'pointer' },
  chips:     { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip:      { padding: '5px 11px', fontSize: 12, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', color: C.textMid, fontFamily: 'Georgia, serif' },
  chipOn:    { background: C.dark, color: C.gold, borderColor: C.dark },
  count:     { marginLeft: 'auto', fontSize: 12, color: C.textMuted },

  // Grid
  grid: { flex: 1, overflowY: 'auto', padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, alignContent: 'start' },

  // Cards
  card:       { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' },
  cardMatch:  { borderColor: C.gold },
  cardUrgent: { borderColor: C.red },
  cardTop:    { background: C.dark, padding: '12px 14px' },
  cardName:   { fontSize: 15, color: C.onDark, fontWeight: 'bold', marginBottom: 2 },
  cardSpouse: { fontSize: 12, color: C.onDarkSub, marginBottom: 2 },
  cardAgent:  { fontSize: 11, color: C.onDarkMid },
  cardBody:   { padding: '12px 14px' },
  cardStatus: { fontSize: 11, fontWeight: 'bold', marginBottom: 6 },
  cardSentence:{ fontSize: 13, color: C.text, lineHeight: 1.6, marginBottom: 8 },
  cardEmpty:  { fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginBottom: 8 },
  cardShift:  { fontSize: 12, color: C.textMid, background: C.bg, borderRadius: 4, padding: '5px 9px', lineHeight: 1.5 },
  cardShiftLabel: { fontWeight: 'bold', color: C.gold },
  cardFoot:   { padding: '0 14px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardMeta:   { fontSize: 11, color: C.textMuted },
  cardActions:{ display: 'flex', gap: 8 },
  cardLog:    { padding: '7px 12px', background: C.dark, color: C.gold, border: 'none', borderRadius: 5, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  cardOpen:   { padding: '7px 12px', background: C.bg, color: C.textMid, border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Buyer view
  buyerBar:      { background: C.dark, padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  back:          { fontSize: 12, color: C.gold, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  buyerBarRight: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  buyerHead:     { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '14px 20px', flexShrink: 0 },
  buyerName:     { fontSize: 20, fontWeight: 'bold', color: C.text, marginBottom: 4 },
  buyerSpouse:   { fontSize: 15, color: C.textMid, fontWeight: 'normal' },
  buyerMeta:     { fontSize: 12, color: C.textMid, marginBottom: 4 },
  buyerSentence: { fontSize: 14, color: C.text, lineHeight: 1.6, fontStyle: 'italic', borderLeft: `3px solid ${C.gold}`, paddingLeft: 12, marginTop: 6 },

  // AI notification
  aiLoad:    { background: C.mid, padding: '8px 20px', flexShrink: 0, fontSize: 12, color: C.gold, fontStyle: 'italic' },
  aiPanel:   { background: C.goldLight, borderBottom: `1px solid ${C.goldBorder}`, padding: '12px 20px', flexShrink: 0 },
  aiTop:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  aiTitle:   { fontSize: 12, color: '#78501a', fontWeight: 'bold' },
  aiSentence:{ fontSize: 14, color: '#5a3a0a', fontStyle: 'italic', marginBottom: 8, lineHeight: 1.5 },
  aiChanges: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 6 },
  aiChange:  { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  aiKey:     { fontSize: 10, letterSpacing: '0.06em', color: C.gold, fontWeight: 'bold', textTransform: 'uppercase', minWidth: 110, flexShrink: 0 },
  aiOld:     { fontSize: 12, color: C.textMuted, textDecoration: 'line-through' },
  aiArrow:   { color: C.gold, fontWeight: 'bold', flexShrink: 0 },
  aiNew:     { fontSize: 13, color: '#5a3a0a', fontWeight: 'bold' },
  aiUndo:    { padding: '3px 10px', border: `1px solid ${C.gold}`, borderRadius: 4, background: 'transparent', color: '#78501a', fontSize: 11, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  aiX:       { fontSize: 14, color: '#a8925a', background: 'none', border: 'none', cursor: 'pointer' },
  aiCoach:   { fontSize: 13, color: '#78501a', borderTop: `1px solid ${C.goldBorder}`, paddingTop: 8, lineHeight: 1.5 },
  aiCoachLabel: { fontWeight: 'bold' },

  // Tabs
  tabs:    { display: 'flex', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.surface, overflowX: 'auto' },
  tab:     { padding: '11px 18px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 13, cursor: 'pointer', color: C.textMuted, fontFamily: 'Georgia, serif', marginBottom: -1, whiteSpace: 'nowrap' },
  tabOn:   { color: C.text, borderBottomColor: C.gold, fontWeight: 'bold' },
  tabBody: { flex: 1, overflowY: 'auto', padding: '20px' },
  pane:    { maxWidth: 840 },

  // MOVE tab
  moveWord:     { fontSize: 30, fontWeight: 'bold', color: C.dark, letterSpacing: '0.16em', marginBottom: 14 },
  moveGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: 10, marginBottom: 14 },
  moveField:    { border: `1px solid ${C.border}`, borderRadius: 7, padding: '12px', background: C.surface },
  moveFieldOn:  { borderColor: C.gold, background: C.goldLight },
  moveFieldHead:{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  moveLetter:   { fontSize: 22, fontWeight: 'bold', color: C.gold, lineHeight: 1, flexShrink: 0 },
  moveLabel:    { fontSize: 11, fontWeight: 'bold', color: C.text, letterSpacing: '0.04em' },
  moveQ:        { fontSize: 11, color: C.textMuted, marginTop: 2 },
  moveInput:    { width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.bg, fontSize: 13, fontFamily: 'Georgia, serif', color: C.text, outline: 'none' },
  fieldLive:    { fontSize: 12, color: C.textMid, fontStyle: 'italic', padding: '6px 8px', background: C.bg, borderRadius: 3, marginBottom: 6, lineHeight: 1.5 },
  micBtn:       { padding: '4px 8px', background: 'none', border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 13, color: C.textMuted, flexShrink: 0 },
  micBtnActive: { background: C.redLight, borderColor: '#fca5a5', color: C.red },
  twoCol:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px', marginBottom: 14 },
  intakeToggle: { fontSize: 13, color: C.textMid, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer', padding: '9px 14px', width: '100%', textAlign: 'left', fontFamily: 'Georgia, serif', marginBottom: 12 },
  intakePanel:  { background: C.dark, borderRadius: 8, padding: '16px 18px', marginBottom: 16 },
  intakePrepHead:{ fontSize: 12, color: C.onDarkMid, marginBottom: 10 },
  prepList:     { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 },
  prepRow:      { display: 'flex', gap: 10, alignItems: 'flex-start' },
  prepN:        { fontSize: 11, color: C.gold, fontWeight: 'bold', minWidth: 16, marginTop: 1 },
  prepQ:        { fontSize: 13, color: C.onDark, lineHeight: 1.5 },
  intakeDivide: { fontSize: 11, color: C.onDarkSub, borderTop: '1px solid #3c3835', paddingTop: 12, marginBottom: 10 },
  intakePrompt: { fontSize: 16, color: C.onDark, fontWeight: 'bold', marginBottom: 14 },
  micReady:     { width: '100%', padding: '13px', background: C.gold, color: C.dark, border: 'none', borderRadius: 7, fontSize: 15, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  micActive:    { width: '100%', padding: '13px', background: C.red, color: '#fff', border: 'none', borderRadius: 7, fontSize: 15, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', marginTop: 10 },
  liveText:     { background: '#292524', borderRadius: 5, padding: '10px 12px', fontSize: 13, color: C.onDark, lineHeight: 1.6, minHeight: 60, marginBottom: 8 },
  hint:         { fontSize: 11, color: C.onDarkSub, textAlign: 'center', marginTop: 8 },
  reviewLabel:  { fontSize: 10, letterSpacing: '0.1em', color: C.onDarkSub, marginBottom: 6 },
  processing:   { fontSize: 13, color: C.gold, fontStyle: 'italic', padding: '8px 0' },

  confSection: { marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.border}` },
  confLabel:   { fontSize: 13, color: C.textMid, marginBottom: 12 },
  confOptions: { display: 'flex', gap: 10, marginBottom: 10 },
  confOpt:     { flex: 1, border: '2px solid transparent', borderRadius: 7, padding: '12px 10px', textAlign: 'center', background: C.surface, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  confOptOn:   { border: `2px solid ${C.gold}`, background: C.goldLight, boxShadow: `0 0 0 1px ${C.gold}` },
  confOptLabel:{ fontSize: 12, color: C.text, fontWeight: 'bold', marginBottom: 4 },
  confOptSub:  { fontSize: 10, color: C.textMuted },
  confNudge:   { background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 4, padding: '10px 12px', fontSize: 13, color: '#78501a', lineHeight: 1.6 },

  // Contacts
  contactCard:   { border: `1px solid ${C.border}`, borderRadius: 7, padding: '14px', marginBottom: 12, background: C.surface },
  contactCardOn: { borderColor: C.gold, background: C.goldLight },
  contactTop:    { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  roleInput:     { fontSize: 11, fontWeight: 'bold', letterSpacing: '0.06em', color: C.textMid, background: 'transparent', border: 'none', borderBottom: `1px dashed ${C.border}`, outline: 'none', padding: '2px 4px', fontFamily: 'Georgia, serif', textTransform: 'uppercase', width: 150 },
  primaryTag:    { fontSize: 10, background: C.dark, color: C.gold, padding: '2px 8px', borderRadius: 10 },
  setPrimary:    { fontSize: 10, background: 'none', border: `1px solid ${C.border}`, borderRadius: 10, color: C.textMuted, padding: '2px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Fields
  fl:        { fontSize: 11, letterSpacing: '0.06em', color: C.textMuted, textTransform: 'uppercase', marginBottom: 5 },
  field:     { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 5, background: C.bg, fontSize: 14, fontFamily: 'Georgia, serif', color: C.text, outline: 'none' },
  fieldOn:   { background: C.goldLight, borderColor: C.gold, color: C.dark },
  textarea:  { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 5, background: C.bg, fontSize: 14, fontFamily: 'Georgia, serif', color: C.text, outline: 'none', resize: 'vertical', lineHeight: 1.6 },

  // Showings
  showCard:      { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '14px', marginBottom: 12 },
  showTop:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  showAddr:      { fontSize: 15, fontWeight: 'bold', color: C.text },
  showDate:      { fontSize: 12, color: C.textMuted, marginTop: 2 },
  showTesting:   { fontSize: 12, color: C.textMid, marginTop: 4, fontStyle: 'italic' },
  showTestLabel: { fontWeight: 'bold', color: C.gold, fontStyle: 'normal' },
  showShift:     { background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 4, padding: '8px 10px', marginBottom: 8, fontSize: 13, color: C.text, lineHeight: 1.5 },
  showShiftLabel:{ fontWeight: 'bold', color: C.gold },
  showNote:      { fontSize: 13, color: C.textMid, lineHeight: 1.6 },

  // Refinements
  refIntro:  { fontSize: 13, color: C.textMid, fontStyle: 'italic', marginBottom: 20, padding: '10px 14px', background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, lineHeight: 1.6 },
  timeline:  { borderLeft: `2px solid ${C.border}`, paddingLeft: 20, marginLeft: 6 },
  tlItem:    { position: 'relative', paddingBottom: 20, display: 'flex', gap: 14 },
  tlDot:     { width: 10, height: 10, borderRadius: '50%', background: C.border, flexShrink: 0, marginTop: 3, marginLeft: -25 },
  tlLabel:   { fontSize: 11, color: C.textMuted, marginBottom: 4 },
  tlText:    { fontSize: 14, color: C.text, lineHeight: 1.6 },

  matchCard:    { background: C.greenLight, border: `1px solid ${C.greenBorder}`, borderRadius: 8, padding: '16px', marginBottom: 20 },
  matchHead:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  matchTitle:   { fontSize: 13, fontWeight: 'bold', color: C.green, letterSpacing: '0.08em' },
  matchMeta:    { fontSize: 12, color: C.textMuted },
  matchSentence:{ fontSize: 15, color: C.text, fontStyle: 'italic', marginBottom: 14, lineHeight: 1.6 },
  matchArc:     { borderLeft: `2px solid ${C.greenBorder}`, paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  arcItem:      {},
  arcLabel:     { fontSize: 10, color: C.textMuted, marginBottom: 3 },
  arcOld:       { fontSize: 13, color: '#a8a29e', textDecoration: 'line-through' },
  arcText:      { fontSize: 13, color: C.textMid, lineHeight: 1.5 },
  arcFinal:     { fontSize: 15, color: C.green, fontWeight: 'bold', lineHeight: 1.5 },

  // Showing form
  formBar:    { background: C.dark, padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  formTitle:  { fontSize: 14, color: C.onDark, fontWeight: 'bold' },
  formScroll: { flex: 1, overflowY: 'auto' },
  formBody:   { padding: '20px', maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 0 },
  formMove:   { background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 6, padding: '10px 14px', marginBottom: 16 },
  formMoveLabel: { fontSize: 9, letterSpacing: '0.14em', color: C.gold, fontWeight: 'bold', marginBottom: 4 },
  formMoveText:  { fontSize: 14, color: C.text, lineHeight: 1.5, fontStyle: 'italic' },
  debriefBox:    { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '16px', marginBottom: 14 },
  debriefBoxHead:{ fontSize: 10, letterSpacing: '0.14em', color: C.textMuted, fontWeight: 'bold', marginBottom: 4 },
  debriefBoxSub: { fontSize: 12, color: C.textMid, marginBottom: 14, lineHeight: 1.5 },
  debriefMic:    { width: '100%', padding: '13px', background: C.dark, color: C.gold, border: 'none', borderRadius: 7, fontSize: 14, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', marginBottom: 10 },
  debriefMicOn:  { width: '100%', padding: '13px', background: C.red, color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', marginTop: 8 },
  orRow:         { display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 10px' },
  orText:        { fontSize: 11, color: C.textMuted },
  detailToggle:  { fontSize: 12, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', padding: '6px 0', marginBottom: 6 },
  detailFields:  { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '12px', marginBottom: 14 },
  detailKey:     { fontSize: 12, fontWeight: 'bold', color: C.text },
  detailQ:       { fontSize: 11, color: C.textMuted },
  saveBtn:       { width: '100%', padding: '14px', border: 'none', borderRadius: 7, background: C.dark, color: C.gold, fontSize: 16, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', marginTop: 8 },

  // Buttons
  btn:       { padding: '9px 18px', border: 'none', borderRadius: 5, background: C.dark, color: C.gold, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  btnGold:   { padding: '7px 14px', border: 'none', borderRadius: 4, background: C.gold, color: C.dark, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  btnOutline:{ padding: '7px 14px', border: `1px solid ${C.gold}`, borderRadius: 4, background: 'transparent', color: C.gold, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  btnGhost:  { padding: '7px 14px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.surface, color: C.textMid, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  btnDanger: { padding: '7px 12px', border: '1px solid #fca5a5', borderRadius: 4, background: 'transparent', color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  statusSel: { padding: '6px 10px', borderRadius: 4, border: '1px solid #3c3835', background: '#292524', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer', color: C.onDarkMid },

  // Manager / Performance
  managerBody:   { flex: 1, overflowY: 'auto', padding: '20px' },
  statRow:       { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 },
  statCard:      { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '16px', textAlign: 'center' },
  statVal:       { fontSize: 28, fontWeight: 'bold', color: C.dark, marginBottom: 4 },
  statLabel:     { fontSize: 11, color: C.textMuted, letterSpacing: '0.06em' },
  agentSection:  { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 16, overflow: 'hidden' },
  agentSectionHead:{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  agentSectionName:{ fontSize: 15, fontWeight: 'bold', color: C.text, marginBottom: 3 },
  agentSectionMeta:{ fontSize: 12, color: C.textMid },
  agentAvg:      { fontSize: 13, color: C.textMid, fontWeight: 'bold' },
  insightCard:   { background: C.goldLight, border: `1px solid ${C.goldBorder}`, margin: '12px 16px', borderRadius: 6, padding: '12px 14px' },
  insightRow:    { display: 'flex', gap: 8, marginBottom: 6, fontSize: 13 },
  insightLabel:  { color: C.gold, fontWeight: 'bold', minWidth: 120, flexShrink: 0 },
  insightVal:    { color: C.text },
  insightCoach:  { fontSize: 13, color: '#78501a', borderTop: `1px solid ${C.goldBorder}`, paddingTop: 8, lineHeight: 1.5 },
  insightCoachLabel: { fontWeight: 'bold' },
  agentBuyerList:{ padding: '0 0 8px' },
  agentBuyerRow: { display: 'flex', alignItems: 'center', padding: '10px 16px', borderTop: `1px solid ${C.border}`, cursor: 'pointer' },
  agentBuyerName:{ flex: 1, fontSize: 14, color: C.text },
  agentBuyerStatus:{ fontSize: 11, fontWeight: 'bold', minWidth: 140, flexShrink: 0 },
  agentBuyerShowing:{ fontSize: 11, color: C.textMuted, minWidth: 80, flexShrink: 0 },
  agentBuyerArrow:{ fontSize: 12, color: C.textMuted },

  perfIntro:     { fontSize: 13, color: C.textMid, fontStyle: 'italic', marginBottom: 20, padding: '10px 14px', background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, lineHeight: 1.6 },
  perfInsightRow:{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 },
  perfInsight:   { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: '20px', textAlign: 'center' },
  perfInsightVal:{ fontSize: 32, fontWeight: 'bold', color: C.dark, marginBottom: 6 },
  perfInsightLabel:{ fontSize: 13, color: C.text, fontWeight: 'bold', marginBottom: 4 },
  perfInsightSub:{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 },
  perfHistory:   { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, overflow: 'hidden' },
  perfHistoryHead:{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 10, letterSpacing: '0.14em', color: C.textMuted, fontWeight: 'bold' },
  perfRow:       { display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: `1px solid ${C.border}` },
  perfRowName:   { flex: 1, fontSize: 14, color: C.text },
  perfRowStatus: { fontSize: 11, fontWeight: 'bold', minWidth: 140, flexShrink: 0 },
  perfRowMeta:   { fontSize: 11, color: C.textMuted },

  // VoiceButton
  voiceBtn:         { padding: '5px 10px', border: `1px solid ${C.border}`, borderRadius: 4, background: C.surface, color: C.textMid, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif', display: 'flex', alignItems: 'center', gap: 5 },
  voiceBtnActive:   { background: C.redLight, borderColor: '#fca5a5', color: C.red },
  voiceBtnLarge:    { width: '100%', padding: '13px', background: C.dark, color: C.gold, border: 'none', borderRadius: 7, fontSize: 15, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  voiceBtnLargeActive: { width: '100%', padding: '13px', background: C.red, color: '#fff', border: 'none', borderRadius: 7, fontSize: 15, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  voiceBtnSmall:    { padding: '3px 7px', border: `1px solid ${C.border}`, borderRadius: 4, background: 'none', color: C.textMuted, fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // MOVE tab voice top
  moveVoiceTop:     { background: C.dark, borderRadius: 8, padding: '16px', marginBottom: 20 },
  moveVoiceTopLabel:{ fontSize: 14, color: C.onDark, fontWeight: 'bold', marginBottom: 4 },
  moveVoiceTopSub:  { fontSize: 12, color: C.onDarkMid, marginBottom: 14, lineHeight: 1.5 },
  intakeReview:     { marginTop: 12 },
  intakeError:      { fontSize: 12, color: C.red, background: C.redLight, border: `1px solid #fca5a5`, borderRadius: 4, padding: '8px 12px', marginBottom: 10, lineHeight: 1.5 },
  prepToggle:       { fontSize: 12, color: C.onDarkSub, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', padding: '8px 0 0', width: '100%', textAlign: 'left' },
  prepPanel:        { marginTop: 10, paddingTop: 10, borderTop: '1px solid #3c3835' },
  prepPanelHead:    { fontSize: 12, color: C.onDarkMid, marginBottom: 10 },

  // AI confirmation panel
  aiSubtitle:  { fontSize: 12, color: '#78501a', marginBottom: 10, lineHeight: 1.5 },
  aiActions:   { display: 'flex', gap: 10, marginTop: 12 },
  aiApply:     { padding: '8px 16px', border: 'none', borderRadius: 5, background: C.dark, color: C.gold, fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold' },
  aiSkip:      { padding: '8px 14px', border: `1px solid ${C.goldBorder}`, borderRadius: 5, background: 'transparent', color: '#78501a', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Coaching card
  coachingCard:      { background: C.goldLight, border: `1px solid ${C.goldBorder}`, borderRadius: 8, padding: '16px 18px', marginBottom: 20 },
  coachingCardHead:  { fontSize: 9, letterSpacing: '0.16em', color: C.gold, fontWeight: 'bold', marginBottom: 12 },
  coachingRow:       { display: 'flex', gap: 10, marginBottom: 8, fontSize: 13, alignItems: 'flex-start' },
  coachingKey:       { color: C.gold, fontWeight: 'bold', minWidth: 120, flexShrink: 0, fontSize: 11, letterSpacing: '0.04em' },
  coachingVal:       { color: C.text, lineHeight: 1.5 },
  coachingPromptBlock: { background: C.surface, border: `1px solid ${C.goldBorder}`, borderRadius: 5, padding: '10px 12px', marginBottom: 14 },
  coachingPromptLabel: { fontSize: 10, letterSpacing: '0.1em', color: C.gold, fontWeight: 'bold', marginBottom: 4 },
  coachingPromptText: { fontSize: 14, color: C.text, lineHeight: 1.6 },
  coachingQList:     { borderTop: `1px solid ${C.goldBorder}`, paddingTop: 12 },
  coachingQListLabel:{ fontSize: 11, color: C.gold, fontWeight: 'bold', letterSpacing: '0.06em', marginBottom: 10 },
  coachingQItem:     { display: 'flex', gap: 10, marginBottom: 8, fontSize: 13, color: C.text, lineHeight: 1.5 },
  coachingQNum:      { color: C.gold, fontWeight: 'bold', minWidth: 16, flexShrink: 0 },

  // Empty states
  
  emptyGrid: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' },
  empty:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' },
  emptyTitle:{ fontSize: 18, fontWeight: 'bold', color: C.text, marginBottom: 8 },
  emptySub:  { fontSize: 14, color: C.textMuted, marginBottom: 20, lineHeight: 1.6 },
}
