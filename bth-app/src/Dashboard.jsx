import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const DEFAULT_NS = { propertyType: '', location: '', motivation: '', whatMattersMost: '', willingToTrade: '', tradeFor: '' }
const DEFAULT_PROFILE = { friction: '', gain: '', nonNegotiables: '', patterns: '' }
const DEFAULT_CONTACTS = [
  { id: '1', name: '', phone: '', email: '', role: 'Buyer', isPrimary: true },
  { id: '2', name: '', phone: '', email: '', role: 'Spouse / Partner', isPrimary: false },
]

function dbToBuyer(row) {
  return {
    id: row.id,
    clientName: row.client_name || '',
    agentName: row.agent_name || '',
    status: row.status || 'Active',
    contacts: row.contacts?.length ? row.contacts : DEFAULT_CONTACTS.map(c => ({ ...c })),
    propertyAddress: row.property_address || '',
    northStar: { ...DEFAULT_NS, ...(row.north_star || {}) },
    profile: { ...DEFAULT_PROFILE, ...(row.profile || {}) },
    showings: row.showings || [],
    createdAt: row.created_at,
  }
}

function buyerToDb(b) {
  return {
    client_name: b.clientName, agent_name: b.agentName, status: b.status,
    contacts: b.contacts, property_address: b.propertyAddress,
    north_star: b.northStar, profile: b.profile, showings: b.showings,
    updated_at: new Date().toISOString(),
  }
}

function newBuyerObj(agentName = '') {
  return {
    clientName: '', agentName, status: 'Active',
    contacts: DEFAULT_CONTACTS.map(c => ({ ...c })),
    propertyAddress: '', northStar: { ...DEFAULT_NS },
    profile: { ...DEFAULT_PROFILE }, showings: [],
  }
}

function newShowing() {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    address: '', respondedTo: '', pulledBackFrom: '',
    moreTure: '', lessTure: '', hypothesisUpdate: '',
  }
}

function nsComplete(ns) {
  return [ns.propertyType, ns.location, ns.motivation, ns.whatMattersMost, ns.willingToTrade, ns.tradeFor].filter(Boolean).length
}

function formatPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
}

const STATUSES = ['Active', 'Under Contract', 'Closed', 'On Hold']

const MINDSET = {
  anchors: [
    { title: 'Destroy Ambiguity', body: 'Everything starts unclear. Your job is to reduce uncertainty until the picture becomes clear. Every conversation and showing should create clarity. If the picture is still fuzzy, keep digging.' },
    { title: 'Find the Best Answer', body: 'The first answer is rarely the best answer. Buyers tell you what they think they want. Experts identify what actually matters. You are hired to find the best answer — not collect them.' },
  ],
  steps: [
    { n: '01', title: 'Build the Hypothesis', body: 'After the first conversation, complete the North Star. Listen for friction, gain, non-negotiables, and patterns.' },
    { n: '02', title: 'Test the Hypothesis', body: 'Every showing is research. Watch what they linger on, what they dismiss, what creates excitement or hesitation.' },
    { n: '03', title: 'Refine the Hypothesis', body: 'Expert agents don\'t defend their first hypothesis. They improve it. The goal is clarity, not confirmation.' },
  ],
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function Dashboard({ session }) {
  const [buyers, setBuyers] = useState([])
  const [agents, setAgents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('buyer')
  const [showingOpen, setShowingOpen] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mindsetOpen, setMindsetOpen] = useState(false)
  const [refinePrompt, setRefinePrompt] = useState(null)
  const saveTimers = useRef({})

  useEffect(() => {
    loadData()
    const channel = supabase.channel('buyers-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buyers' }, handleRT)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const loadData = async () => {
    setLoading(true)
    const [{ data: bRows }, { data: aRows }] = await Promise.all([
      supabase.from('buyers').select('*').order('created_at', { ascending: false }),
      supabase.from('agents').select('*').order('name'),
    ])
    const loaded = (bRows || []).map(dbToBuyer)
    setBuyers(loaded)
    setAgents(aRows || [])
    if (loaded.length) setSelectedId(loaded[0].id)
    setLoading(false)
  }

  const handleRT = (payload) => {
    if (payload.eventType === 'INSERT') setBuyers(p => p.find(b => b.id === payload.new.id) ? p : [dbToBuyer(payload.new), ...p])
    else if (payload.eventType === 'UPDATE') setBuyers(p => p.map(b => b.id === payload.new.id ? dbToBuyer(payload.new) : b))
    else if (payload.eventType === 'DELETE') setBuyers(p => p.filter(b => b.id !== payload.old.id))
  }

  const debouncedSave = useCallback((buyer) => {
    if (saveTimers.current[buyer.id]) clearTimeout(saveTimers.current[buyer.id])
    setSaving(true)
    saveTimers.current[buyer.id] = setTimeout(async () => {
      await supabase.from('buyers').update(buyerToDb(buyer)).eq('id', buyer.id)
      setSaving(false)
    }, 900)
  }, [])

  const addBuyer = async () => {
    const agentName = agents[0]?.name || ''
    const { data, error } = await supabase.from('buyers').insert(buyerToDb(newBuyerObj(agentName))).select().single()
    if (!error && data) { const b = dbToBuyer(data); setBuyers(p => [b, ...p]); setSelectedId(b.id); setTab('buyer') }
  }

  const updateBuyer = useCallback((patch) => {
    setBuyers(p => p.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, ...patch }; debouncedSave(nb); return nb }))
  }, [selectedId, debouncedSave])

  const updateNS = useCallback((key, val) => {
    setBuyers(p => p.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, northStar: { ...b.northStar, [key]: val } }; debouncedSave(nb); return nb }))
  }, [selectedId, debouncedSave])

  const updateProfile = useCallback((key, val) => {
    setBuyers(p => p.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, profile: { ...b.profile, [key]: val } }; debouncedSave(nb); return nb }))
  }, [selectedId, debouncedSave])

  const saveShowing = useCallback((showing) => {
    setBuyers(p => p.map(b => {
      if (b.id !== selectedId) return b
      const exists = b.showings.find(s => s.id === showing.id)
      const showings = exists ? b.showings.map(s => s.id === showing.id ? showing : s) : [...b.showings, showing]
      const nb = { ...b, showings }; debouncedSave(nb); return nb
    }))
    setShowingOpen(null)
  }, [selectedId, debouncedSave])

  const deleteShowing = useCallback((sid) => {
    setBuyers(p => p.map(b => { if (b.id !== selectedId) return b; const nb = { ...b, showings: b.showings.filter(s => s.id !== sid) }; debouncedSave(nb); return nb }))
  }, [selectedId, debouncedSave])

  const deleteBuyer = async (id) => {
    await supabase.from('buyers').delete().eq('id', id)
    setBuyers(p => { const u = p.filter(b => b.id !== id); setSelectedId(u.length ? u[0].id : null); return u })
  }

  const selected = buyers.find(b => b.id === selectedId)
  const currentAgent = agents.find(a => a.id === session.user.id)

  const filtered = buyers
    .filter(b => b.clientName.toLowerCase().includes(search.toLowerCase()) || b.agentName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.clientName || '').localeCompare(b.clientName || ''))

  if (loading) return <div style={s.center}>Loading...</div>

  return (
    <div style={s.shell}>
      {/* SIDEBAR */}
      <aside style={s.sidebar}>
        <div style={s.sidebarBrand}>
          <div>
            <div style={s.brandMark}>BUILD THE HOUSE</div>
            <div style={s.brandSub}>Buyer Framework</div>
          </div>
          <div style={s.userMeta}>
            <span style={s.userName}>{currentAgent?.name || session.user.email}</span>
            <button style={s.signOutBtn} onClick={() => supabase.auth.signOut()}>out</button>
          </div>
        </div>

        {/* Mindset toggle */}
        <button style={s.mindsetToggle} onClick={() => setMindsetOpen(o => !o)}>
          <span>MINDSET</span>
          <span style={{ fontSize: 10 }}>{mindsetOpen ? '▲' : '▼'}</span>
        </button>
        {mindsetOpen && (
          <div style={s.mindsetPanel}>
            {MINDSET.anchors.map(a => (
              <div key={a.title} style={s.mindsetBlock}>
                <div style={s.mindsetTitle}>{a.title}</div>
                <div style={s.mindsetBody}>{a.body}</div>
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              {MINDSET.steps.map(st => (
                <div key={st.n} style={s.mindsetStep}>
                  <span style={s.stepNum}>{st.n}</span>
                  <div><div style={s.stepTitle}>{st.title}</div><div style={s.stepBody}>{st.body}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={s.sidebarDivider} />

        {/* Buyer list */}
        <div style={s.buyerSection}>
          <div style={s.buyerSectionHeader}>
            <input style={s.search} placeholder="Search buyers..." value={search} onChange={e => setSearch(e.target.value)} />
            <button style={s.addBtn} onClick={addBuyer} title="New buyer">+</button>
          </div>
          <div style={s.buyerList}>
            {filtered.length === 0 && <div style={s.empty}>No buyers yet.</div>}
            {filtered.map(b => {
              const isActive = b.id === selectedId
              const bMap = { Active: { bg: '#eef6e8', color: '#3a6a2a', border: '#b0c8a0' }, 'Under Contract': { bg: '#e8f0f8', color: '#2a4a7a', border: '#a0b8d8' }, Closed: { bg: '#edeae5', color: '#5a5550', border: '#c8c4bc' }, 'On Hold': { bg: '#fef3e2', color: '#7a4f10', border: '#e0c080' } }
              const badge = bMap[b.status] || bMap.Closed
              return (
                <div key={b.id} style={{ ...s.buyerItem, ...(isActive ? s.buyerItemActive : {}) }}
                  onClick={() => { setSelectedId(b.id); setTab('buyer') }}>
                  <div style={s.buyerName}>{b.clientName || 'Unnamed Buyer'}</div>
                  {b.contacts?.[1]?.name && <div style={s.buyerSpouse}>& {b.contacts[1].name}</div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <div style={s.buyerAgent}>{b.agentName || 'No agent'}</div>
                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: badge.bg, color: badge.color, border: '1px solid ' + badge.border, letterSpacing: '0.06em' }}>{b.status}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={s.main}>
        {!selected ? (
          <div style={s.center}>
            <div style={{ textAlign: 'center' }}>
              <div style={s.emptyTitle}>Build the House</div>
              <div style={s.emptySub}>Add a buyer to get started.</div>
              <button style={s.primaryBtn} onClick={addBuyer}>+ Add buyer</button>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={s.header}>
              <div style={s.headerLeft}>
                <div style={s.headerName}>
                  {selected.clientName || 'Unnamed Buyer'}
                  {selected.contacts?.[1]?.name && <span style={s.headerSpouse}> & {selected.contacts[1].name}</span>}
                </div>
                <div style={s.headerMeta}>
                  {selected.agentName || 'No agent'} · {selected.showings.length} showing{selected.showings.length !== 1 ? 's' : ''} ·{' '}
                  <span style={{ color: saving ? '#c4813a' : '#4a6e3a' }}>{saving ? 'Saving…' : 'Saved'}</span>
                </div>
              </div>
              <div style={s.headerRight}>
                <select style={s.statusSelect} value={selected.status} onChange={e => updateBuyer({ status: e.target.value })}>
                  {STATUSES.map(st => <option key={st}>{st}</option>)}
                </select>
                <button style={s.ghostBtn} onClick={() => { if (window.confirm('Delete this buyer?')) deleteBuyer(selected.id) }}>Delete</button>
              </div>
            </div>

            {/* NORTH STAR — pinned */}
            <NorthStarPinned buyer={selected} updateNS={updateNS} />

            {/* Tabs */}
            <div style={s.tabBar}>
              {[['buyer', 'Buyer Info'], ['showings', 'Showings'], ['refinements', 'Refinements']].map(([k, l]) => (
                <button key={k} style={{ ...s.tab, ...(tab === k ? s.tabActive : {}) }} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>

            <div style={s.tabContent}>
              {tab === 'buyer' && <BuyerTab buyer={selected} updateBuyer={updateBuyer} updateProfile={updateProfile} agents={agents} />}
              {tab === 'showings' && (
                <ShowingsTab
                  buyer={selected} showingOpen={showingOpen} setShowingOpen={setShowingOpen}
                  saveShowing={saveShowing} deleteShowing={deleteShowing}
                  onRefine={p => { setRefinePrompt(p); setTab('buyer') }}
                />
              )}
              {tab === 'refinements' && <RefinementsTab buyer={selected} />}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ─── NORTH STAR PINNED ───────────────────────────────────────────────────────
function NorthStarPinned({ buyer, updateNS }) {
  const ns = buyer.northStar
  const count = nsComplete(ns)
  const pct = Math.round((count / 6) * 100)

  return (
    <div style={s.nsPinned}>
      <div style={s.nsHeader}>
        <span style={s.nsLabel}>NORTH STAR HYPOTHESIS</span>
        <div style={s.nsStrengthWrap}>
          <div style={s.nsStrengthBar}>
            <div style={{ ...s.nsStrengthFill, width: `${pct}%`, background: count < 3 ? '#c4813a' : count < 6 ? '#a09a3a' : '#4a6e3a' }} />
          </div>
          <span style={s.nsStrengthPct}>{count}/6</span>
        </div>
      </div>
      <div style={s.nsStatement}>
        <div style={s.nsRow}>
          <span style={s.nsWord}>We believe this buyer will purchase a</span>
          <NSInput value={ns.propertyType} placeholder="property type" onChange={v => updateNS('propertyType', v)} />
          <span style={s.nsWord}>in</span>
          <NSInput value={ns.location} placeholder="location" onChange={v => updateNS('location', v)} />
        </div>
        <div style={s.nsRow}>
          <span style={s.nsWord}>because they are trying to</span>
          <NSInput value={ns.motivation} placeholder="core motivation" onChange={v => updateNS('motivation', v)} wide />
        </div>
        <div style={s.nsRow}>
          <span style={s.nsWord}>What matters most is</span>
          <NSInput value={ns.whatMattersMost} placeholder="top priority" onChange={v => updateNS('whatMattersMost', v)} wide />
        </div>
        <div style={s.nsRow}>
          <span style={s.nsWord}>They will trade</span>
          <NSInput value={ns.willingToTrade} placeholder="what they'll give up" onChange={v => updateNS('willingToTrade', v)} />
          <span style={s.nsWord}>for</span>
          <NSInput value={ns.tradeFor} placeholder="what they'll gain" onChange={v => updateNS('tradeFor', v)} />
        </div>
      </div>
    </div>
  )
}

function NSInput({ value, placeholder, onChange, wide }) {
  return (
    <input
      style={{ ...s.nsInput, ...(wide ? s.nsInputWide : {}) }}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
    />
  )
}

// ─── BUYER TAB ───────────────────────────────────────────────────────────────
function BuyerTab({ buyer, updateBuyer, updateProfile, agents }) {
  return (
    <div style={s.pane}>
      <Section title="CONTACTS">
        {buyer.contacts.map(contact => {
          const upd = (key, val) => updateBuyer({ contacts: buyer.contacts.map(c => c.id === contact.id ? { ...c, [key]: val } : c) })
          const setPrimary = () => updateBuyer({ contacts: buyer.contacts.map(c => ({ ...c, isPrimary: c.id === contact.id })), clientName: contact.name })
          return (
            <div key={contact.id} style={{ ...s.contactCard, ...(contact.isPrimary ? s.contactCardPrimary : {}) }}>
              <div style={s.contactCardHeader}>
                <input style={s.roleInput} value={contact.role} onChange={e => upd('role', e.target.value)} />
                {contact.isPrimary
                  ? <span style={s.primaryBadge}>Primary</span>
                  : <button style={s.setPrimaryBtn} onClick={setPrimary}>Set as primary</button>}
              </div>
              <div style={s.contactGrid}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Label>Full Name</Label>
                  <input style={s.field} value={contact.name} placeholder="Full name"
                    onChange={e => { upd('name', e.target.value); if (contact.isPrimary) updateBuyer({ clientName: e.target.value }) }} />
                </div>
                <div>
                  <Label>Phone</Label>
                  <input style={s.field} value={contact.phone} placeholder="(615) 000-0000"
                    onChange={e => upd('phone', formatPhone(e.target.value))} />
                </div>
                <div>
                  <Label>Email</Label>
                  <input style={s.field} value={contact.email} placeholder="email@example.com"
                    onChange={e => upd('email', e.target.value)} />
                </div>
              </div>
            </div>
          )
        })}
      </Section>

      <Section title="DETAILS">
        <div style={s.twoCol}>
          <div>
            <Label>Assigned Agent</Label>
            <select style={s.field} value={buyer.agentName} onChange={e => updateBuyer({ agentName: e.target.value })}>
              <option value="">Select agent...</option>
              {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Status</Label>
            <select style={s.field} value={buyer.status} onChange={e => updateBuyer({ status: e.target.value })}>
              {STATUSES.map(st => <option key={st}>{st}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <Label>Property Address (if known)</Label>
            <AddressAutocomplete value={buyer.propertyAddress || ''} onChange={v => updateBuyer({ propertyAddress: v })} />
          </div>
        </div>
      </Section>

      <Section title="BUYER PROFILE">
        <div style={s.twoCol}>
          <div>
            <Label>The Friction — what are they moving away from?</Label>
            <textarea style={s.textarea} value={buyer.profile.friction} placeholder="What's broken or unsustainable?" onChange={e => updateProfile('friction', e.target.value)} />
          </div>
          <div>
            <Label>The Gain — what are they moving toward?</Label>
            <textarea style={s.textarea} value={buyer.profile.gain} placeholder="What does success look like?" onChange={e => updateProfile('gain', e.target.value)} />
          </div>
          <div>
            <Label>Non-Negotiables</Label>
            <textarea style={s.textarea} value={buyer.profile.nonNegotiables} placeholder="Deal-breakers, hard limits..." onChange={e => updateProfile('nonNegotiables', e.target.value)} />
          </div>
          <div>
            <Label>Patterns — what keeps coming up?</Label>
            <textarea style={s.textarea} value={buyer.profile.patterns} placeholder="Recurring themes..." onChange={e => updateProfile('patterns', e.target.value)} />
          </div>
        </div>
      </Section>
    </div>
  )
}

// ─── SHOWINGS TAB ─────────────────────────────────────────────────────────────
function ShowingsTab({ buyer, showingOpen, setShowingOpen, saveShowing, deleteShowing, onRefine }) {
  const [draft, setDraft] = useState(null)
  const upd = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const sorted = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))

  if (showingOpen !== null && draft) {
    return (
      <div style={s.pane}>
        <div style={s.showingFormHeader}>
          <div style={s.sectionTitle}>{showingOpen === 'new' ? 'Log a Showing' : 'Edit Showing'}</div>
          <button style={s.ghostBtn} onClick={() => { setShowingOpen(null); setDraft(null) }}>Cancel</button>
        </div>

        <div style={s.showingFormGrid}>
          <div>
            <Label>Date</Label>
            <input type="date" style={s.field} value={draft.date} onChange={e => upd('date', e.target.value)} />
          </div>
          <div>
            <Label>Property Address</Label>
            <AddressAutocomplete value={draft.address} onChange={v => upd('address', v)} />
          </div>
        </div>

        <div style={s.showingFields}>
          <div>
            <Label>What they responded to — lingered on, got excited about</Label>
            <textarea style={{ ...s.textarea, minHeight: 90 }} value={draft.respondedTo} placeholder="Features, rooms, moments that created energy..." onChange={e => upd('respondedTo', e.target.value)} />
          </div>
          <div>
            <Label>What they pulled back from — dismissed or hesitated on</Label>
            <textarea style={{ ...s.textarea, minHeight: 90 }} value={draft.pulledBackFrom} placeholder="What they brushed past, questioned, or rejected..." onChange={e => upd('pulledBackFrom', e.target.value)} />
          </div>
          <div>
            <Label>What became more true about the hypothesis</Label>
            <textarea style={{ ...s.textarea, minHeight: 80 }} value={draft.moreTure} placeholder="Evidence that confirmed what we believed..." onChange={e => upd('moreTure', e.target.value)} />
          </div>
          <div>
            <Label>What became less true about the hypothesis</Label>
            <textarea style={{ ...s.textarea, minHeight: 80 }} value={draft.lessTure} placeholder="Evidence that challenged what we believed..." onChange={e => upd('lessTure', e.target.value)} />
          </div>
          <div>
            <Label>Hypothesis update — how does the North Star change?</Label>
            <textarea style={{ ...s.textarea, minHeight: 80, borderColor: '#b0c8a0' }} value={draft.hypothesisUpdate} placeholder="How does this shift the picture?" onChange={e => upd('hypothesisUpdate', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button style={s.primaryBtn} onClick={() => saveShowing(draft)}>Save showing</button>
          <button style={s.ghostBtn} onClick={() => { setShowingOpen(null); setDraft(null) }}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.pane}>
      <div style={s.showingsHeader}>
        <div style={s.sectionTitle}>SHOWINGS ({buyer.showings.length})</div>
        <button style={s.primaryBtn} onClick={() => { setDraft(newShowing()); setShowingOpen('new') }}>+ Log showing</button>
      </div>
      {sorted.length === 0 && <div style={s.empty}>No showings logged yet.</div>}
      {sorted.map(sh => (
        <div key={sh.id} style={s.showingCard}>
          <div style={s.showingCardTop}>
            <div>
              <div style={s.showingAddr}>{sh.address || 'No address'}</div>
              <div style={s.showingDate}>{sh.date ? new Date(sh.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {sh.hypothesisUpdate && <button style={s.refineBtn} onClick={() => onRefine(sh.hypothesisUpdate)}>Refine North Star →</button>}
              <button style={s.ghostBtn} onClick={() => { setDraft({ ...sh }); setShowingOpen(sh.id) }}>Edit</button>
              <button style={s.dangerBtn} onClick={() => { if (window.confirm('Delete this showing?')) deleteShowing(sh.id) }}>Delete</button>
            </div>
          </div>
          {sh.hypothesisUpdate && <div style={s.hypothesisUpdateBlock}><span style={s.updateLabel}>North Star update: </span>{sh.hypothesisUpdate}</div>}
          <div style={s.showingDebrief}>
            {sh.respondedTo && <div><span style={s.debriefLabel}>Responded to: </span>{sh.respondedTo}</div>}
            {sh.pulledBackFrom && <div><span style={s.debriefLabel}>Pulled back from: </span>{sh.pulledBackFrom}</div>}
            {sh.moreTure && <div><span style={s.debriefLabel}>↑ More true: </span>{sh.moreTure}</div>}
            {sh.lessTure && <div><span style={s.debriefLabel}>↓ Less true: </span>{sh.lessTure}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── REFINEMENTS TAB ─────────────────────────────────────────────────────────
function RefinementsTab({ buyer }) {
  const ns = buyer.northStar
  const count = nsComplete(ns)
  const withUpdates = [...buyer.showings].sort((a, b) => new Date(a.date) - new Date(b.date)).filter(s => s.hypothesisUpdate)

  return (
    <div style={s.pane}>
      <Section title="HYPOTHESIS EVOLUTION">
        {buyer.showings.length === 0
          ? <div style={s.empty}>Log showings to track how the hypothesis evolves over time.</div>
          : (
            <div style={s.timeline}>
              <TimelineItem label="Initial hypothesis" date="">
                {count > 0
                  ? <span style={s.timelineText}>{ns.propertyType || '—'} in {ns.location || '—'} · {ns.motivation || '—'}</span>
                  : <span style={{ color: '#a09a8e', fontStyle: 'italic' }}>Not yet built.</span>}
              </TimelineItem>
              {withUpdates.map((sh, i) => (
                <TimelineItem key={sh.id} label={`After showing ${i + 1}`} date={sh.address || ''}>
                  <span style={s.timelineText}>{sh.hypothesisUpdate}</span>
                </TimelineItem>
              ))}
              {withUpdates.length === 0 && (
                <div style={{ paddingLeft: 24, fontSize: 12, color: '#a09a8e', fontStyle: 'italic' }}>No hypothesis updates logged yet. Add them when debriefing each showing.</div>
              )}
            </div>
          )}
      </Section>
    </div>
  )
}

function TimelineItem({ label, date, children }) {
  return (
    <div style={s.timelineItem}>
      <div style={s.timelineDot} />
      <div style={s.timelineContent}>
        <div style={s.timelineLabel}>{label}{date ? ` · ${date}` : ''}</div>
        {children}
      </div>
    </div>
  )
}

// ─── SHARED ───────────────────────────────────────────────────────────────────
function Section({ title, children }) {
  return <div style={s.section}><div style={s.sectionTitle}>{title}</div>{children}</div>
}

function Label({ children }) {
  return <div style={s.fieldLabel}>{children}</div>
}

function AddressAutocomplete({ value, onChange, placeholder = 'Start typing an address...' }) {
  const [query, setQuery] = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  const search = q => {
    if (timer.current) clearTimeout(timer.current)
    if (q.length < 4) { setSuggestions([]); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=us`, { headers: { 'Accept-Language': 'en' } })
        const data = await res.json()
        setSuggestions(data.map(r => r.display_name))
        setOpen(true)
      } catch (_) {}
      setLoading(false)
    }, 350)
  }

  const select = addr => {
    const clean = addr.split(', United States')[0]
    setQuery(clean); onChange(clean); setSuggestions([]); setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input style={{ ...s.field, paddingRight: 28 }} value={query} placeholder={placeholder} autoComplete="off"
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); search(e.target.value) }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)} />
      {loading && <span style={s.addrSpinner}>⟳</span>}
      {open && suggestions.length > 0 && (
        <div style={s.addrDropdown}>
          {suggestions.map((sg, i) => <div key={i} style={s.addrOption} onMouseDown={() => select(sg)}>{sg.split(', United States')[0]}</div>)}
        </div>
      )}
    </div>
  )
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  shell: { display: 'flex', height: '100vh', fontFamily: "Georgia, 'Times New Roman', serif", background: '#f5f2ee', color: '#1e1c1a', overflow: 'hidden' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1 },

  // Sidebar
  sidebar: { width: 230, minWidth: 230, background: '#edeae5', borderRight: '1px solid #ddd8d0', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarBrand: { padding: '14px 14px 10px', borderBottom: '1px solid #ddd8d0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  brandMark: { fontSize: 9, letterSpacing: '0.22em', color: '#4a6e3a', fontWeight: 'bold', marginBottom: 2 },
  brandSub: { fontSize: 10, color: '#a09a8e' },
  userMeta: { textAlign: 'right' },
  userName: { display: 'block', fontSize: 10, color: '#6a6460', marginBottom: 2 },
  signOutBtn: { fontSize: 9, color: '#a09a8e', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', letterSpacing: '0.05em' },

  mindsetToggle: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid #ddd8d0', cursor: 'pointer', width: '100%', fontFamily: 'Georgia, serif', fontSize: 9, letterSpacing: '0.16em', color: '#6a6460', fontWeight: 'bold' },
  mindsetPanel: { padding: '12px 14px', borderBottom: '1px solid #ddd8d0', background: '#e8e4de', maxHeight: 320, overflowY: 'auto' },
  mindsetBlock: { marginBottom: 12 },
  mindsetTitle: { fontSize: 11, fontWeight: 'bold', color: '#2a2521', marginBottom: 3 },
  mindsetBody: { fontSize: 11, color: '#5a5550', lineHeight: 1.6 },
  mindsetStep: { display: 'flex', gap: 8, marginBottom: 8 },
  stepNum: { fontSize: 9, color: '#4a6e3a', fontWeight: 'bold', marginTop: 2, flexShrink: 0 },
  stepTitle: { fontSize: 11, fontWeight: 'bold', color: '#2a2521', marginBottom: 2 },
  stepBody: { fontSize: 11, color: '#5a5550', lineHeight: 1.5 },

  sidebarDivider: { height: 1, background: '#ddd8d0' },
  buyerSection: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '10px 0 0' },
  buyerSectionHeader: { display: 'flex', gap: 6, padding: '0 12px 8px', alignItems: 'center' },
  search: { flex: 1, padding: '6px 10px', border: '1px solid #d0cbc4', borderRadius: 3, background: '#f5f2ee', fontSize: 12, fontFamily: 'Georgia, serif', color: '#1e1c1a', outline: 'none' },
  addBtn: { width: 28, height: 28, background: '#4a6e3a', color: '#fff', border: 'none', borderRadius: 3, fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  buyerList: { flex: 1, overflowY: 'auto' },
  buyerItem: { padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #ddd8d0' },
  buyerItemActive: { background: '#f5f2ee', borderLeft: '3px solid #4a6e3a', paddingLeft: 11 },
  buyerName: { fontSize: 13, fontWeight: 'bold', color: '#1e1c1a', marginBottom: 1 },
  buyerSpouse: { fontSize: 11, color: '#6a6460', marginBottom: 1 },
  buyerMeta: { fontSize: 10, color: '#a09a8e' },
  buyerAgent: { fontSize: 10, color: '#a09a8e' },
  empty: { fontSize: 12, color: '#a09a8e', padding: '12px 14px', fontStyle: 'italic' },

  // Main
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 28px 14px', borderBottom: '1px solid #ddd8d0', flexShrink: 0 },
  headerLeft: {},
  headerName: { fontSize: 22, fontWeight: 'bold', color: '#1e1c1a', marginBottom: 3 },
  headerSpouse: { fontSize: 17, color: '#7a7570', fontWeight: 'normal' },
  headerMeta: { fontSize: 12, color: '#a09a8e' },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center' },
  statusSelect: { padding: '5px 10px', borderRadius: 3, border: '1px solid #d0cbc4', background: '#f5f2ee', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer' },

  // North Star pinned
  nsPinned: { background: '#fff', borderBottom: '1px solid #ddd8d0', padding: '14px 28px', flexShrink: 0 },
  nsHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  nsLabel: { fontSize: 9, letterSpacing: '0.18em', color: '#4a6e3a', fontWeight: 'bold' },
  nsStrengthWrap: { display: 'flex', alignItems: 'center', gap: 8 },
  nsStrengthBar: { width: 80, height: 4, background: '#e8e4de', borderRadius: 2, overflow: 'hidden' },
  nsStrengthFill: { height: '100%', borderRadius: 2, transition: 'width 0.3s' },
  nsStrengthPct: { fontSize: 10, color: '#a09a8e' },
  nsStatement: { display: 'flex', flexDirection: 'column', gap: 4 },
  nsRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  nsWord: { fontSize: 14, color: '#5a5550' },
  nsInput: { fontSize: 14, color: '#2a5a1a', background: '#f0f7ea', border: '1px solid #c0d8b0', borderRadius: 3, padding: '3px 10px', outline: 'none', fontFamily: 'Georgia, serif', minWidth: 100 },
  nsInputWide: { minWidth: 200, flex: 1 },

  // Tabs
  tabBar: { display: 'flex', padding: '0 28px', borderBottom: '1px solid #ddd8d0', flexShrink: 0, background: '#faf8f5' },
  tab: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 13, cursor: 'pointer', color: '#8a8480', fontFamily: 'Georgia, serif', marginBottom: -1 },
  tabActive: { color: '#1e1c1a', borderBottomColor: '#4a6e3a', fontWeight: 'bold' },
  tabContent: { flex: 1, overflowY: 'auto', padding: '24px 28px' },
  pane: { maxWidth: 860 },

  // Sections
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 10, letterSpacing: '0.14em', color: '#8a8480', fontWeight: 'bold', marginBottom: 14 },

  // Contacts
  contactCard: { border: '1px solid #e0dbd4', borderRadius: 5, padding: '16px', marginBottom: 12, background: '#faf8f5' },
  contactCardPrimary: { borderColor: '#b0c8a0', background: '#f5faf2' },
  contactCardHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  roleInput: { fontSize: 11, fontWeight: 'bold', letterSpacing: '0.08em', color: '#5a5550', background: 'transparent', border: 'none', borderBottom: '1px dashed #ccc8c0', outline: 'none', padding: '2px 4px', fontFamily: 'Georgia, serif', textTransform: 'uppercase', width: 160 },
  primaryBadge: { fontSize: 10, background: '#4a6e3a', color: '#fff', padding: '2px 8px', borderRadius: 10 },
  setPrimaryBtn: { fontSize: 10, background: 'none', border: '1px solid #ccc8c0', borderRadius: 10, color: '#8a8480', padding: '2px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  contactGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },

  // Form fields
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' },
  fieldLabel: { fontSize: 10, letterSpacing: '0.08em', color: '#8a8480', textTransform: 'uppercase', marginBottom: 5 },
  field: { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #e0dbd4', borderRadius: 4, background: '#fff', fontSize: 13, fontFamily: 'Georgia, serif', color: '#1e1c1a', outline: 'none' },
  textarea: { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1px solid #e0dbd4', borderRadius: 4, background: '#fff', fontSize: 13, fontFamily: 'Georgia, serif', color: '#1e1c1a', outline: 'none', resize: 'vertical', minHeight: 80, lineHeight: 1.6 },

  // Buttons
  primaryBtn: { padding: '8px 18px', borderRadius: 3, border: 'none', background: '#4a6e3a', color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  ghostBtn: { padding: '7px 14px', borderRadius: 3, border: '1px solid #d0cbc4', background: 'transparent', color: '#6a6460', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  dangerBtn: { padding: '7px 14px', borderRadius: 3, border: '1px solid #d0b0a8', background: 'transparent', color: '#a06050', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  refineBtn: { padding: '5px 10px', borderRadius: 3, border: '1px solid #b0c8a0', background: '#eef6e8', color: '#3a5a2a', fontSize: 11, cursor: 'pointer', fontFamily: 'Georgia, serif' },

  // Showings
  showingFormHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  showingFormGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', marginBottom: 20 },
  showingFields: { display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 },
  showingsHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  showingCard: { background: '#fff', border: '1px solid #e0dbd4', borderRadius: 5, padding: '16px', marginBottom: 12 },
  showingCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  showingAddr: { fontSize: 14, fontWeight: 'bold', color: '#1e1c1a' },
  showingDate: { fontSize: 11, color: '#a09a8e', marginTop: 2 },
  hypothesisUpdateBlock: { background: '#eef6e8', borderRadius: 3, padding: '8px 12px', fontSize: 12, color: '#2a4a1a', marginBottom: 8 },
  updateLabel: { fontWeight: 'bold', color: '#4a6e3a' },
  showingDebrief: { fontSize: 12, color: '#5a5550', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 3 },
  debriefLabel: { fontWeight: 'bold' },

  // Refinements / timeline
  timeline: { borderLeft: '2px solid #e0dbd4', paddingLeft: 20, marginLeft: 6 },
  timelineItem: { position: 'relative', paddingBottom: 20, display: 'flex', gap: 14 },
  timelineDot: { width: 10, height: 10, borderRadius: '50%', background: '#4a6e3a', flexShrink: 0, marginTop: 3, marginLeft: -25 },
  timelineContent: { flex: 1 },
  timelineLabel: { fontSize: 11, color: '#a09a8e', marginBottom: 3 },
  timelineText: { fontSize: 13, color: '#1e1c1a', lineHeight: 1.5 },

  // Empty states
  emptyTitle: { fontSize: 22, fontWeight: 'bold', color: '#1e1c1a', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#a09a8e', marginBottom: 20 },

  // Address autocomplete
  addrSpinner: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#a09a8e' },
  addrDropdown: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #d0cbc4', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', zIndex: 100, maxHeight: 220, overflowY: 'auto' },
  addrOption: { padding: '9px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f0ede8', color: '#1e1c1a', fontFamily: 'Georgia, serif', lineHeight: 1.4 },
}
