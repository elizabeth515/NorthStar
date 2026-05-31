import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

// ─── DATA HELPERS ────────────────────────────────────────────────────────────
const DEFAULT_NORTH_STAR = { propertyType: '', location: '', motivation: '', whatMattersMost: '', willingToTrade: '', tradeFor: '', updatedAt: new Date().toISOString() }
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
    northStar: { ...DEFAULT_NORTH_STAR, ...(row.north_star || {}) },
    profile: { ...DEFAULT_PROFILE, ...(row.profile || {}) },
    showings: row.showings || [],
    createdAt: row.created_at,
  }
}

function buyerToDb(buyer) {
  return {
    client_name: buyer.clientName,
    agent_name: buyer.agentName,
    status: buyer.status,
    contacts: buyer.contacts,
    property_address: buyer.propertyAddress,
    north_star: buyer.northStar,
    profile: buyer.profile,
    showings: buyer.showings,
    updated_at: new Date().toISOString(),
  }
}

function newBuyerObj(agentName = '') {
  return {
    clientName: '',
    agentName,
    status: 'Active',
    contacts: DEFAULT_CONTACTS.map(c => ({ ...c })),
    propertyAddress: '',
    northStar: { ...DEFAULT_NORTH_STAR },
    profile: { ...DEFAULT_PROFILE },
    showings: [],
  }
}

function newShowing() {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().split('T')[0],
    address: '',
    lingeredOn: '',
    dismissed: '',
    excitement: '',
    hesitation: '',
    becameMoreTrue: '',
    becameLessTrue: '',
    learned: '',
    hypothesisUpdate: '',
  }
}

function hypothesisComplete(ns) {
  return [ns.propertyType, ns.location, ns.motivation, ns.whatMattersMost, ns.willingToTrade, ns.tradeFor].filter(Boolean).length
}
function hypothesisLabel(count) {
  if (count === 0) return { text: 'Not started', color: '#c8a8a0' }
  if (count < 3) return { text: 'Building', color: '#c4813a' }
  if (count < 6) return { text: 'In progress', color: '#a09a3a' }
  return { text: 'Complete', color: '#5a7a4a' }
}

const STATUSES = ['Active', 'Under Contract', 'Closed', 'On Hold']

// ─── MAIN DASHBOARD ──────────────────────────────────────────────────────────
export default function Dashboard({ session }) {
  const [buyers, setBuyers] = useState([])
  const [agents, setAgents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [agentFilter, setAgentFilter] = useState('All Agents')
  const [statusFilter, setStatusFilter] = useState('All')
  const [sortBy, setSortBy] = useState('name')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('hypothesis')
  const [showingOpen, setShowingOpen] = useState(null)
  const [refinePrompt, setRefinePrompt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const saveTimers = useRef({})

  // ── LOAD DATA ──
  useEffect(() => {
    loadData()
    const channel = supabase
      .channel('buyers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buyers' }, handleRealtimeChange)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const loadData = async () => {
    setLoading(true)
    const [{ data: buyerRows }, { data: agentRows }] = await Promise.all([
      supabase.from('buyers').select('*').order('created_at', { ascending: false }),
      supabase.from('agents').select('*').order('name'),
    ])
    setBuyers((buyerRows || []).map(dbToBuyer))
    setAgents(agentRows || [])
    if (buyerRows?.length) setSelectedId(buyerRows[0].id)
    setLoading(false)
  }

  const handleRealtimeChange = (payload) => {
    if (payload.eventType === 'INSERT') {
      setBuyers(prev => {
        if (prev.find(b => b.id === payload.new.id)) return prev
        return [dbToBuyer(payload.new), ...prev]
      })
    } else if (payload.eventType === 'UPDATE') {
      setBuyers(prev => prev.map(b => b.id === payload.new.id ? dbToBuyer(payload.new) : b))
    } else if (payload.eventType === 'DELETE') {
      setBuyers(prev => prev.filter(b => b.id !== payload.old.id))
    }
  }

  // ── SAVE (debounced) ──
  const debouncedSave = useCallback((buyer) => {
    if (saveTimers.current[buyer.id]) clearTimeout(saveTimers.current[buyer.id])
    setSaving(true)
    saveTimers.current[buyer.id] = setTimeout(async () => {
      await supabase.from('buyers').update(buyerToDb(buyer)).eq('id', buyer.id)
      setSaving(false)
    }, 900)
  }, [])

  // ── CRUD ──
  const addBuyer = async () => {
    const agentName = agentFilter !== 'All Agents' ? agentFilter : (agents[0]?.name || '')
    const newData = newBuyerObj(agentName)
    const { data, error } = await supabase.from('buyers').insert(buyerToDb(newData)).select().single()
    if (!error && data) {
      const buyer = dbToBuyer(data)
      setBuyers(prev => [buyer, ...prev])
      setSelectedId(buyer.id)
      setTab('hypothesis')
    }
  }

  const updateBuyer = useCallback((patch) => {
    setBuyers(prev => {
      const updated = prev.map(b => {
        if (b.id !== selectedId) return b
        const newBuyer = { ...b, ...patch }
        debouncedSave(newBuyer)
        return newBuyer
      })
      return updated
    })
  }, [selectedId, debouncedSave])

  const updateNorthStar = useCallback((key, val) => {
    setBuyers(prev => {
      const updated = prev.map(b => {
        if (b.id !== selectedId) return b
        const newBuyer = { ...b, northStar: { ...b.northStar, [key]: val, updatedAt: new Date().toISOString() } }
        debouncedSave(newBuyer)
        return newBuyer
      })
      return updated
    })
  }, [selectedId, debouncedSave])

  const updateProfile = useCallback((key, val) => {
    setBuyers(prev => {
      const updated = prev.map(b => {
        if (b.id !== selectedId) return b
        const newBuyer = { ...b, profile: { ...b.profile, [key]: val } }
        debouncedSave(newBuyer)
        return newBuyer
      })
      return updated
    })
  }, [selectedId, debouncedSave])

  const saveShowing = useCallback((showing) => {
    setBuyers(prev => {
      const updated = prev.map(b => {
        if (b.id !== selectedId) return b
        const exists = b.showings.find(s => s.id === showing.id)
        const showings = exists ? b.showings.map(s => s.id === showing.id ? showing : s) : [...b.showings, showing]
        const newBuyer = { ...b, showings }
        debouncedSave(newBuyer)
        return newBuyer
      })
      return updated
    })
    setShowingOpen(null)
  }, [selectedId, debouncedSave])

  const deleteShowing = useCallback((sid) => {
    setBuyers(prev => {
      const updated = prev.map(b => {
        if (b.id !== selectedId) return b
        const newBuyer = { ...b, showings: b.showings.filter(s => s.id !== sid) }
        debouncedSave(newBuyer)
        return newBuyer
      })
      return updated
    })
  }, [selectedId, debouncedSave])

  const deleteBuyer = async (id) => {
    await supabase.from('buyers').delete().eq('id', id)
    setBuyers(prev => {
      const updated = prev.filter(b => b.id !== id)
      setSelectedId(updated.length ? updated[0].id : null)
      return updated
    })
  }

  const signOut = () => supabase.auth.signOut()

  const selected = buyers.find(b => b.id === selectedId)
  const currentAgent = agents.find(a => a.id === session.user.id)

  const filteredBuyers = buyers
    .filter(b => {
      const matchAgent = agentFilter === 'All Agents' || b.agentName === agentFilter
      const matchStatus = statusFilter === 'All' || b.status === statusFilter
      const matchSearch = b.clientName.toLowerCase().includes(search.toLowerCase()) ||
        b.agentName.toLowerCase().includes(search.toLowerCase())
      return matchAgent && matchStatus && matchSearch
    })
    .sort((a, b) => {
      if (sortBy === 'name') return (a.clientName || '').localeCompare(b.clientName || '')
      if (sortBy === 'date') return new Date(b.createdAt) - new Date(a.createdAt)
      if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '')
      return 0
    })

  if (loading) return <div style={s.center}>Loading...</div>

  return (
    <div style={s.shell}>
      {/* ── SIDEBAR ── */}
      <aside style={s.sidebar}>
        <div style={s.sidebarTop}>
          <div>
            <div style={s.brandMark}>BUILD THE HOUSE</div>
            <div style={s.brandSub}>Buyer Framework</div>
          </div>
          <div style={s.userRow}>
            <span style={s.userName}>{currentAgent?.name || session.user.email}</span>
            <button style={s.signOutBtn} onClick={signOut}>Sign out</button>
          </div>
        </div>

        {/* Agent filter */}
        <div style={s.section}>
          <div style={s.sectionLabel}>AGENTS</div>
          <button
            style={{ ...s.agentBtn, ...(agentFilter === 'All Agents' ? s.agentBtnActive : {}) }}
            onClick={() => setAgentFilter('All Agents')}
          >All Agents</button>
          {agents.map(a => (
            <button
              key={a.id}
              style={{ ...s.agentBtn, ...(agentFilter === a.name ? s.agentBtnActive : {}) }}
              onClick={() => setAgentFilter(a.name)}
            >{a.name}</button>
          ))}
        </div>

        <div style={s.divider} />

        {/* Buyer list */}
        <div style={{ ...s.section, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={s.sectionLabel}>BUYERS</div>
            <button style={s.addBuyerBtn} onClick={addBuyer}>+ New</button>
          </div>

          <input style={s.search} placeholder="Search by name or agent..." value={search} onChange={e => setSearch(e.target.value)} />

          <select
            style={s.clientQuickSelect}
            value={selectedId || ''}
            onChange={e => { if (e.target.value) { setSelectedId(e.target.value); setTab('hypothesis') } }}
          >
            <option value="">Jump to client...</option>
            {[...buyers].sort((a, b) => (a.clientName || '').localeCompare(b.clientName || '')).map(b => (
              <option key={b.id} value={b.id}>{b.clientName || 'Unnamed'}{b.agentName ? ` — ${b.agentName}` : ''}</option>
            ))}
          </select>

          <div style={s.filterRow}>
            {['All', 'Active', 'Under Contract', 'Closed', 'On Hold'].map(st => (
              <button
                key={st}
                style={{ ...s.filterBtn, ...(statusFilter === st ? s.filterBtnActive : {}) }}
                onClick={() => setStatusFilter(st)}
              >{st === 'Under Contract' ? 'Contract' : st}</button>
            ))}
          </div>

          <div style={s.sortRow}>
            <span style={s.sortLabel}>Sort:</span>
            <select style={s.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="name">Name A–Z</option>
              <option value="date">Date added</option>
              <option value="status">Status</option>
            </select>
          </div>

          <div style={s.buyerList}>
            {filteredBuyers.length === 0 && <div style={s.emptyState}>No buyers found.</div>}
            {filteredBuyers.map(b => {
              const count = hypothesisComplete(b.northStar)
              const { text, color } = hypothesisLabel(count)
              return (
                <div
                  key={b.id}
                  style={{ ...s.buyerItem, ...(b.id === selectedId ? s.buyerItemActive : {}) }}
                  onClick={() => { setSelectedId(b.id); setTab('hypothesis') }}
                >
                  <div style={s.buyerName}>{b.clientName || 'Unnamed Buyer'}</div>
                  {b.contacts?.[1]?.name && <div style={s.buyerSpouse}>& {b.contacts[1].name}</div>}
                  <div style={s.buyerAgent}>{b.agentName || 'No agent'}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    <span style={{ ...s.dot, background: color }} />
                    <span style={{ fontSize: 10, color }}>{text}</span>
                    <span style={s.showingCount}>{b.showings.length} showing{b.showings.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={s.main}>
        {!selected ? (
          <div style={s.center}>
            <div style={s.emptyMain}>
              <div style={s.emptyMainTitle}>Build the House</div>
              <div style={s.emptyMainSub}>Select a buyer or add one to get started.</div>
              <button style={s.primaryBtn} onClick={addBuyer}>+ Add buyer</button>
            </div>
          </div>
        ) : (
          <>
            <div style={s.mainHeader}>
              <div>
                <div style={s.mainTitle}>
                  {selected.clientName || 'Unnamed Buyer'}
                  {selected.contacts?.[1]?.name && <span style={s.mainTitleSpouse}> & {selected.contacts[1].name}</span>}
                </div>
                <div style={s.mainMeta}>
                  Agent: {selected.agentName || '—'} · {selected.showings.length} showing{selected.showings.length !== 1 ? 's' : ''}
                  {' · '}
                  <span style={{ color: saving ? '#c4813a' : '#5a7a4a' }}>{saving ? 'Saving…' : 'Saved'}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select style={s.select} value={selected.status} onChange={e => updateBuyer({ status: e.target.value })}>
                  {STATUSES.map(st => <option key={st}>{st}</option>)}
                </select>
                <button style={s.deleteBtn} onClick={() => { if (window.confirm(`Delete ${selected.clientName || 'this buyer'}?`)) deleteBuyer(selected.id) }}>Delete</button>
              </div>
            </div>

            <div style={s.tabRow}>
              {[['hypothesis', 'North Star'], ['showings', 'Showings'], ['coaching', 'Coaching']].map(([key, label]) => (
                <button key={key} style={{ ...s.tab, ...(tab === key ? s.tabActive : {}) }} onClick={() => setTab(key)}>{label}</button>
              ))}
            </div>

            <div style={s.tabContent}>
              {tab === 'hypothesis' && (
                <HypothesisTab
                  buyer={selected}
                  updateNorthStar={updateNorthStar}
                  updateBuyer={updateBuyer}
                  updateProfile={updateProfile}
                  refinePrompt={refinePrompt}
                  clearRefinePrompt={() => setRefinePrompt(null)}
                  agents={agents}
                />
              )}
              {tab === 'showings' && (
                <ShowingsTab
                  buyer={selected}
                  showingOpen={showingOpen}
                  setShowingOpen={setShowingOpen}
                  saveShowing={saveShowing}
                  deleteShowing={deleteShowing}
                  onRefineNorthStar={prompt => { setRefinePrompt(prompt); setTab('hypothesis') }}
                />
              )}
              {tab === 'coaching' && <CoachingTab buyer={selected} />}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ─── HYPOTHESIS TAB ──────────────────────────────────────────────────────────
function HypothesisTab({ buyer, updateNorthStar, updateBuyer, updateProfile, refinePrompt, clearRefinePrompt, agents }) {
  const ns = buyer.northStar
  const count = hypothesisComplete(ns)
  const { text, color } = hypothesisLabel(count)

  return (
    <div style={s.tabPane}>
      {refinePrompt && (
        <div style={s.refinePromptBanner}>
          <div style={s.refinePromptTitle}>Refine your hypothesis based on the last showing:</div>
          <div style={s.refinePromptText}>"{refinePrompt}"</div>
          <button style={s.refinePromptClose} onClick={clearRefinePrompt}>✕ Dismiss</button>
        </div>
      )}

      <Section title="BUYER">
        {(buyer.contacts || []).map((contact) => {
          const updateContact = (key, val) => {
            const updated = buyer.contacts.map(c => c.id === contact.id ? { ...c, [key]: val } : c)
            updateBuyer({ contacts: updated })
          }
          const setPrimary = () => {
            const updated = buyer.contacts.map(c => ({ ...c, isPrimary: c.id === contact.id }))
            updateBuyer({ contacts: updated, clientName: contact.name })
          }
          return (
            <div key={contact.id} style={{ ...s.contactBlock, ...(contact.isPrimary ? s.contactBlockPrimary : {}) }}>
              <div style={s.contactHeader}>
                <div style={s.contactRole}>
                  <input style={s.roleInput} value={contact.role} onChange={e => updateContact('role', e.target.value)} placeholder="Role" />
                  {contact.isPrimary
                    ? <span style={s.primaryBadge}>Primary Contact</span>
                    : <button style={s.setPrimaryBtn} onClick={setPrimary}>Set as primary</button>}
                </div>
              </div>
              <div style={s.threeCol}>
                <Field label="Full Name" full>
                  <input style={s.inputLg} value={contact.name} placeholder="Full name"
                    onChange={e => { updateContact('name', e.target.value); if (contact.isPrimary) updateBuyer({ clientName: e.target.value }) }} />
                </Field>
                <Field label="Phone">
                  <input style={s.inputLg} value={contact.phone} placeholder="(310) 000-0000" onChange={e => updateContact('phone', e.target.value)} />
                </Field>
                <Field label="Email">
                  <input style={s.inputLg} value={contact.email} placeholder="email@example.com" onChange={e => updateContact('email', e.target.value)} />
                </Field>
              </div>
            </div>
          )
        })}
        <div style={{ marginTop: 16 }}>
          <Field label="Assigned Agent">
            <select style={s.inputLg} value={buyer.agentName} onChange={e => updateBuyer({ agentName: e.target.value })}>
              <option value="">Select agent...</option>
              {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Property Address (if known)">
            <AddressAutocomplete value={buyer.propertyAddress || ''} onChange={v => updateBuyer({ propertyAddress: v })} />
          </Field>
        </div>
      </Section>

      <Section title="NORTH STAR HYPOTHESIS" badge={<span style={{ ...s.badge, color, borderColor: color }}>{text} ({count}/6)</span>}>
        <div style={s.hypothesisStatement}>
          <div style={s.hsRow}><span style={s.hsText}>We believe this buyer will purchase a</span><InlineInput value={ns.propertyType} placeholder="property type" onChange={v => updateNorthStar('propertyType', v)} /></div>
          <div style={s.hsRow}><span style={s.hsText}>in</span><InlineInput value={ns.location} placeholder="location / neighborhood" onChange={v => updateNorthStar('location', v)} /></div>
          <div style={s.hsRow}><span style={s.hsText}>because they are trying to</span><InlineInput value={ns.motivation} placeholder="core motivation" onChange={v => updateNorthStar('motivation', v)} /></div>
          <div style={s.hsRow}><span style={s.hsText}>What matters most is</span><InlineInput value={ns.whatMattersMost} placeholder="top priority" onChange={v => updateNorthStar('whatMattersMost', v)} /></div>
          <div style={s.hsRow}><span style={s.hsText}>They are willing to trade</span><InlineInput value={ns.willingToTrade} placeholder="what they'll give up" onChange={v => updateNorthStar('willingToTrade', v)} /></div>
          <div style={s.hsRow}><span style={s.hsText}>for</span><InlineInput value={ns.tradeFor} placeholder="what they'll gain" onChange={v => updateNorthStar('tradeFor', v)} /></div>
        </div>
        <div style={s.hypothesisNote}>This is your current best hypothesis — not a fact. Everything that follows tests and refines it.</div>
      </Section>

      <Section title="BUYER PROFILE">
        <div style={s.twoCol}>
          <Field label="The Friction — what are they moving away from?">
            <textarea style={s.textarea} value={buyer.profile.friction} placeholder="What's broken or unsustainable?" onChange={e => updateProfile('friction', e.target.value)} />
          </Field>
          <Field label="The Gain — what are they moving toward?">
            <textarea style={s.textarea} value={buyer.profile.gain} placeholder="What does success look like?" onChange={e => updateProfile('gain', e.target.value)} />
          </Field>
          <Field label="Non-Negotiables — what kills a house immediately?">
            <textarea style={s.textarea} value={buyer.profile.nonNegotiables} placeholder="Deal-breakers, hard limits..." onChange={e => updateProfile('nonNegotiables', e.target.value)} />
          </Field>
          <Field label="Patterns — what keeps coming up?">
            <textarea style={s.textarea} value={buyer.profile.patterns} placeholder="Recurring themes..." onChange={e => updateProfile('patterns', e.target.value)} />
          </Field>
        </div>
      </Section>
    </div>
  )
}

// ─── SHOWINGS TAB ─────────────────────────────────────────────────────────────
function ShowingsTab({ buyer, showingOpen, setShowingOpen, saveShowing, deleteShowing, onRefineNorthStar }) {
  const [draft, setDraft] = useState(null)

  const openNew = () => { setDraft(newShowing()); setShowingOpen('new') }
  const openEdit = (showing) => { setDraft({ ...showing }); setShowingOpen(showing.id) }
  const updateDraft = (key, val) => setDraft(d => ({ ...d, [key]: val }))
  const sorted = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))

  if (showingOpen !== null && draft) {
    return (
      <div style={s.tabPane}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={s.sectionTitle}>{showingOpen === 'new' ? 'New Showing' : `Showing — ${draft.address || 'No address'}`}</div>
          <button style={s.deleteBtn} onClick={() => { setShowingOpen(null); setDraft(null) }}>Cancel</button>
        </div>
        <Section title="SHOWING DETAILS">
          <div style={s.twoCol}>
            <Field label="Date"><input type="date" style={s.input} value={draft.date} onChange={e => updateDraft('date', e.target.value)} /></Field>
            <Field label="Property Address"><AddressAutocomplete value={draft.address} onChange={v => updateDraft('address', v)} /></Field>
          </div>
        </Section>
        <Section title="OBSERVATIONS">
          <div style={s.twoCol}>
            <Field label="What they lingered on"><textarea style={s.textarea} value={draft.lingeredOn} placeholder="Features, rooms, details they spent time on..." onChange={e => updateDraft('lingeredOn', e.target.value)} /></Field>
            <Field label="What they dismissed"><textarea style={s.textarea} value={draft.dismissed} placeholder="What they brushed past or rejected..." onChange={e => updateDraft('dismissed', e.target.value)} /></Field>
            <Field label="What created excitement"><textarea style={s.textarea} value={draft.excitement} placeholder="Positive reactions, energy..." onChange={e => updateDraft('excitement', e.target.value)} /></Field>
            <Field label="What created hesitation"><textarea style={s.textarea} value={draft.hesitation} placeholder="Doubts, concerns, body language shifts..." onChange={e => updateDraft('hesitation', e.target.value)} /></Field>
          </div>
        </Section>
        <Section title="HYPOTHESIS DEBRIEF">
          <div style={{ marginBottom: 12, padding: '10px 14px', background: '#f0ede8', borderRadius: 4, fontSize: 12, color: '#5a5550', fontStyle: 'italic' }}>
            After every showing: What became more true? What became less true? What did I learn?
          </div>
          <div style={s.twoCol}>
            <Field label="What became more true?"><textarea style={s.textarea} value={draft.becameMoreTrue} placeholder="Evidence that confirmed the hypothesis..." onChange={e => updateDraft('becameMoreTrue', e.target.value)} /></Field>
            <Field label="What became less true?"><textarea style={s.textarea} value={draft.becameLessTrue} placeholder="Evidence that challenged the hypothesis..." onChange={e => updateDraft('becameLessTrue', e.target.value)} /></Field>
            <Field label="What did I learn?" full><textarea style={{ ...s.textarea, minHeight: 70 }} value={draft.learned} placeholder="New insight about this buyer..." onChange={e => updateDraft('learned', e.target.value)} /></Field>
            <Field label="Hypothesis update" full><textarea style={{ ...s.textarea, minHeight: 70 }} value={draft.hypothesisUpdate} placeholder="How does the North Star Hypothesis change?" onChange={e => updateDraft('hypothesisUpdate', e.target.value)} /></Field>
          </div>
        </Section>
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button style={s.primaryBtn} onClick={() => saveShowing(draft)}>Save showing</button>
          <button style={s.deleteBtn} onClick={() => { setShowingOpen(null); setDraft(null) }}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div style={s.tabPane}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={s.sectionTitle}>SHOWINGS ({buyer.showings.length})</div>
        <button style={s.primaryBtn} onClick={openNew}>+ Log showing</button>
      </div>
      {sorted.length === 0 && <div style={s.emptyState}>No showings logged yet.</div>}
      {sorted.map(showing => (
        <div key={showing.id} style={s.showingCard}>
          <div style={s.showingCardHeader}>
            <div>
              <div style={s.showingAddress}>{showing.address || 'No address'}</div>
              <div style={s.showingDate}>{showing.date ? new Date(showing.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {showing.hypothesisUpdate && <button style={s.refineBtn} onClick={() => onRefineNorthStar(showing.hypothesisUpdate)}>Refine North Star →</button>}
              <button style={s.editBtn} onClick={() => openEdit(showing)}>Edit</button>
              <button style={s.deleteBtn} onClick={() => { if (window.confirm('Delete this showing?')) deleteShowing(showing.id) }}>Delete</button>
            </div>
          </div>
          {showing.hypothesisUpdate && <div style={s.hypothesisUpdateBlock}><span style={s.updateLabel}>Hypothesis update: </span>{showing.hypothesisUpdate}</div>}
          {(showing.becameMoreTrue || showing.becameLessTrue || showing.learned) && (
            <div style={s.showingDebrief}>
              {showing.becameMoreTrue && <div><span style={s.debriefLabel}>↑ More true: </span>{showing.becameMoreTrue}</div>}
              {showing.becameLessTrue && <div style={{ marginTop: 4 }}><span style={s.debriefLabel}>↓ Less true: </span>{showing.becameLessTrue}</div>}
              {showing.learned && <div style={{ marginTop: 4 }}><span style={s.debriefLabel}>Learned: </span>{showing.learned}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── COACHING TAB ─────────────────────────────────────────────────────────────
function CoachingTab({ buyer }) {
  const ns = buyer.northStar
  const count = hypothesisComplete(ns)
  const lastShowing = [...buyer.showings].sort((a, b) => new Date(b.date) - new Date(a.date))[0]

  return (
    <div style={s.tabPane}>
      <Section title="MENTAL ANCHORS">
        <div style={s.anchorGrid}>
          <div style={s.anchor}><div style={s.anchorTitle}>Destroy Ambiguity</div><div style={s.anchorText}>Everything starts unclear. Your job is to reduce uncertainty until the picture becomes clear. Every conversation, showing, and question should create clarity. If the picture is still fuzzy, keep digging.</div></div>
          <div style={s.anchor}><div style={s.anchorTitle}>Find the Best Answer</div><div style={s.anchorText}>The first answer is rarely the best answer. Buyers tell you what they think they want. Experts identify what actually matters. You are not hired to collect answers. You are hired to find the best answer.</div></div>
        </div>
      </Section>
      <Section title="COACHING CHECK-IN">
        <div style={s.checkGrid}>
          <CoachingCheck label="Can I complete the North Star Hypothesis?" status={count === 6 ? 'yes' : count > 0 ? 'partial' : 'no'} detail={count === 6 ? 'Hypothesis is complete.' : count > 0 ? `${count}/6 fields filled. Go back and destroy the ambiguity.` : 'Start here. Complete the North Star before anything else.'} />
          <CoachingCheck label="After the last showing — did my hypothesis get stronger?" status={lastShowing?.hypothesisUpdate ? 'yes' : 'no'} detail={lastShowing?.hypothesisUpdate ? `Last update: "${lastShowing.hypothesisUpdate}"` : lastShowing ? 'You logged a showing but no hypothesis update. Go back and reflect.' : 'No showings logged yet.'} />
          <CoachingCheck label="Am I looking for clarity or confirmation?" status="remind" detail="Expert agents do not defend their first hypothesis. They improve it." />
        </div>
      </Section>
      <Section title="HYPOTHESIS EVOLUTION">
        {buyer.showings.length === 0 ? <div style={s.emptyState}>Log showings to track how the hypothesis evolves.</div> : (
          <div style={s.timeline}>
            <div style={s.timelineItem}><div style={s.timelineDot} /><div style={s.timelineContent}><div style={s.timelineLabel}>Initial hypothesis</div><div style={s.timelineText}>{count > 0 ? `${ns.propertyType || '—'} in ${ns.location || '—'} · ${ns.motivation || '—'}` : 'Not yet built.'}</div></div></div>
            {[...buyer.showings].sort((a, b) => new Date(a.date) - new Date(b.date)).filter(s => s.hypothesisUpdate).map((show, i) => (
              <div key={show.id} style={s.timelineItem}><div style={s.timelineDot} /><div style={s.timelineContent}><div style={s.timelineLabel}>After showing {i + 1} · {show.address || 'No address'}</div><div style={s.timelineText}>{show.hypothesisUpdate}</div></div></div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function CoachingCheck({ label, status, detail }) {
  const colors = { yes: '#5a7a4a', partial: '#c4813a', no: '#c05040', remind: '#5a6a8a' }
  const icons = { yes: '✓', partial: '◑', no: '○', remind: '→' }
  return (
    <div style={s.checkItem}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ color: colors[status], fontSize: 16, marginTop: 1, flexShrink: 0 }}>{icons[status]}</span>
        <div><div style={s.checkLabel}>{label}</div><div style={s.checkDetail}>{detail}</div></div>
      </div>
    </div>
  )
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function Section({ title, badge, children }) {
  return (
    <div style={s.sectionBlock}>
      <div style={s.sectionHeader}><div style={s.sectionTitle}>{title}</div>{badge}</div>
      {children}
    </div>
  )
}

function Field({ label, children, full }) {
  return <div style={{ ...s.fieldGroup, ...(full ? { gridColumn: '1 / -1' } : {}) }}><label style={s.label}>{label}</label>{children}</div>
}

function InlineInput({ value, placeholder, onChange }) {
  return <input style={s.inlineInput} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
}

function AddressAutocomplete({ value, onChange, placeholder = 'Start typing an address...' }) {
  const [query, setQuery] = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  const search = (q) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 4) { setSuggestions([]); return }
    debounceRef.current = setTimeout(async () => {
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

  const select = (addr) => {
    const clean = addr.split(', United States')[0]
    setQuery(clean); onChange(clean); setSuggestions([]); setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input style={{ ...s.input, paddingRight: 28 }} value={query} placeholder={placeholder} autoComplete="off"
          onChange={e => { setQuery(e.target.value); onChange(e.target.value); search(e.target.value) }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)} />
        {loading && <span style={s.addrSpinner}>⟳</span>}
      </div>
      {open && suggestions.length > 0 && (
        <div style={s.addrDropdown}>
          {suggestions.map((sug, i) => (
            <div key={i} style={s.addrOption} onMouseDown={() => select(sug)}>{sug.split(', United States')[0]}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = {
  shell: { display: 'flex', height: '100vh', fontFamily: "Georgia, 'Times New Roman', serif", background: '#f5f2ee', color: '#2a2521', overflow: 'hidden' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1, fontFamily: 'Georgia, serif', color: '#a09a8e', fontSize: 14 },
  sidebar: { width: 240, minWidth: 240, background: '#ece8e2', borderRight: '1px solid #d8d2c8', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarTop: { padding: '16px 14px 12px', borderBottom: '1px solid #d8d2c8' },
  brandMark: { fontSize: 10, letterSpacing: '0.2em', color: '#5a7a4a', fontWeight: 'bold', marginBottom: 2 },
  brandSub: { fontSize: 11, color: '#a09a8e', marginBottom: 8 },
  userRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  userName: { fontSize: 11, color: '#5a5550' },
  signOutBtn: { fontSize: 10, color: '#a09a8e', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  section: { padding: '10px 14px' },
  sectionLabel: { fontSize: 10, letterSpacing: '0.14em', color: '#8a8480', marginBottom: 6, fontWeight: 'bold' },
  agentBtn: { display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', border: '1px solid transparent', borderRadius: 3, background: 'transparent', fontSize: 13, cursor: 'pointer', color: '#4a4540', fontFamily: 'Georgia, serif', marginBottom: 2 },
  agentBtnActive: { background: '#5a7a4a', color: '#fff', borderColor: '#5a7a4a' },
  divider: { height: 1, background: '#d8d2c8' },
  addBuyerBtn: { fontSize: 11, padding: '3px 8px', background: '#5a7a4a', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  search: { width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: 3, border: '1px solid #ccc8c0', background: '#f5f2ee', fontSize: 12, fontFamily: 'Georgia, serif', marginBottom: 6, color: '#2a2521', outline: 'none' },
  clientQuickSelect: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 3, border: '1px solid #ccc8c0', background: '#f5f2ee', fontSize: 12, fontFamily: 'Georgia, serif', marginBottom: 8, color: '#2a2521', cursor: 'pointer' },
  filterRow: { display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 },
  filterBtn: { padding: '3px 7px', fontSize: 10, borderRadius: 3, border: '1px solid #ccc8c0', background: 'transparent', cursor: 'pointer', color: '#6a6460', fontFamily: 'Georgia, serif' },
  filterBtnActive: { background: '#3a5a8a', color: '#fff', borderColor: '#3a5a8a' },
  sortRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 },
  sortLabel: { fontSize: 10, color: '#8a8480', letterSpacing: '0.08em' },
  sortSelect: { fontSize: 11, padding: '2px 6px', border: '1px solid #ccc8c0', borderRadius: 3, background: '#f5f2ee', fontFamily: 'Georgia, serif', cursor: 'pointer', color: '#4a4540' },
  buyerList: { flex: 1, overflowY: 'auto' },
  buyerItem: { padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid #ddd8d0' },
  buyerItemActive: { background: '#f5f2ee', borderLeft: '3px solid #5a7a4a', paddingLeft: 11 },
  buyerName: { fontSize: 13, fontWeight: 'bold', color: '#2a2521', marginBottom: 1 },
  buyerSpouse: { fontSize: 11, color: '#6a6460', marginBottom: 1 },
  buyerAgent: { fontSize: 11, color: '#8a8480' },
  dot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  showingCount: { fontSize: 10, color: '#a09a8e', marginLeft: 'auto' },
  emptyState: { fontSize: 12, color: '#a09a8e', padding: '12px 0', fontStyle: 'italic' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  mainHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 28px 14px', borderBottom: '1px solid #d8d2c8', flexShrink: 0 },
  mainTitle: { fontSize: 20, fontWeight: 'bold', color: '#2a2521', marginBottom: 3 },
  mainTitleSpouse: { fontSize: 16, color: '#7a7570', fontWeight: 'normal' },
  mainMeta: { fontSize: 12, color: '#a09a8e' },
  select: { padding: '5px 10px', borderRadius: 3, border: '1px solid #ccc8c0', background: '#f5f2ee', fontSize: 12, fontFamily: 'Georgia, serif', cursor: 'pointer' },
  deleteBtn: { padding: '5px 12px', borderRadius: 3, border: '1px solid #c8a8a0', background: 'transparent', color: '#a06050', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  editBtn: { padding: '5px 12px', borderRadius: 3, border: '1px solid #ccc8c0', background: 'transparent', color: '#5a5550', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  primaryBtn: { padding: '7px 16px', borderRadius: 3, border: 'none', background: '#5a7a4a', color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  tabRow: { display: 'flex', padding: '0 28px', borderBottom: '1px solid #d8d2c8', flexShrink: 0 },
  tab: { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', fontSize: 13, cursor: 'pointer', color: '#8a8480', fontFamily: 'Georgia, serif', marginBottom: -1 },
  tabActive: { color: '#2a2521', borderBottomColor: '#5a7a4a', fontWeight: 'bold' },
  tabContent: { flex: 1, overflowY: 'auto', padding: '20px 28px' },
  tabPane: { maxWidth: 900 },
  sectionBlock: { marginBottom: 28 },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionTitle: { fontSize: 11, letterSpacing: '0.14em', color: '#5a5550', fontWeight: 'bold' },
  badge: { fontSize: 10, padding: '2px 7px', borderRadius: 3, border: '1px solid', fontFamily: 'Georgia, serif' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' },
  threeCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 11, letterSpacing: '0.08em', color: '#7a7570', textTransform: 'uppercase' },
  input: { padding: '8px 10px', borderRadius: 3, border: '1px solid #ccc8c0', background: '#fff', fontSize: 13, fontFamily: 'Georgia, serif', color: '#2a2521', outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputLg: { padding: '10px 12px', borderRadius: 4, border: '1px solid #ccc8c0', background: '#fff', fontSize: 14, fontFamily: 'Georgia, serif', color: '#2a2521', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea: { padding: '8px 10px', borderRadius: 3, border: '1px solid #ccc8c0', background: '#fff', fontSize: 13, fontFamily: 'Georgia, serif', color: '#2a2521', outline: 'none', resize: 'vertical', minHeight: 80, lineHeight: 1.5, width: '100%', boxSizing: 'border-box' },
  hypothesisStatement: { background: '#fff', border: '1px solid #d8d2c8', borderRadius: 4, padding: '8px 14px', marginBottom: 10 },
  hsRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0ede8' },
  hsText: { color: '#4a4540', fontSize: 14, whiteSpace: 'nowrap' },
  inlineInput: { fontFamily: 'Georgia, serif', fontSize: 14, color: '#2a7a4a', background: '#f5faf2', border: '1px solid #b0d0a0', borderRadius: 3, outline: 'none', padding: '5px 10px', flex: 1, minWidth: 120 },
  hypothesisNote: { fontSize: 11, color: '#a09a8e', fontStyle: 'italic' },
  contactBlock: { border: '1px solid #d8d2c8', borderRadius: 4, padding: '14px 16px', marginBottom: 12, background: '#faf8f5' },
  contactBlockPrimary: { borderColor: '#a0c090', background: '#f5faf2' },
  contactHeader: { marginBottom: 12 },
  contactRole: { display: 'flex', alignItems: 'center', gap: 10 },
  roleInput: { fontSize: 12, fontWeight: 'bold', letterSpacing: '0.08em', color: '#5a5550', background: 'transparent', border: 'none', borderBottom: '1px dashed #ccc8c0', outline: 'none', padding: '2px 4px', fontFamily: 'Georgia, serif', textTransform: 'uppercase', width: 160 },
  primaryBadge: { fontSize: 10, background: '#5a7a4a', color: '#fff', padding: '2px 8px', borderRadius: 10, letterSpacing: '0.08em' },
  setPrimaryBtn: { fontSize: 10, background: 'none', border: '1px solid #ccc8c0', borderRadius: 10, color: '#8a8480', padding: '2px 8px', cursor: 'pointer', fontFamily: 'Georgia, serif' },
  showingCard: { background: '#fff', border: '1px solid #d8d2c8', borderRadius: 4, padding: '14px 16px', marginBottom: 12 },
  showingCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  showingAddress: { fontSize: 14, fontWeight: 'bold', color: '#2a2521' },
  showingDate: { fontSize: 11, color: '#a09a8e', marginTop: 2 },
  hypothesisUpdateBlock: { background: '#f0ede8', borderRadius: 3, padding: '7px 10px', fontSize: 12, color: '#4a4540', marginBottom: 8 },
  updateLabel: { fontWeight: 'bold', color: '#5a7a4a' },
  showingDebrief: { fontSize: 12, color: '#5a5550', lineHeight: 1.6 },
  debriefLabel: { fontWeight: 'bold' },
  refineBtn: { padding: '4px 10px', borderRadius: 3, border: '1px solid #a0c090', background: '#e8f0e0', color: '#3a6a2a', fontSize: 11, cursor: 'pointer', fontFamily: 'Georgia, serif' },
  refinePromptBanner: { background: '#e8f0e0', border: '1px solid #a0c090', borderRadius: 4, padding: '12px 14px', marginBottom: 20, position: 'relative' },
  refinePromptTitle: { fontSize: 11, fontWeight: 'bold', color: '#3a6a2a', letterSpacing: '0.08em', marginBottom: 4, textTransform: 'uppercase' },
  refinePromptText: { fontSize: 13, color: '#2a4a1a', fontStyle: 'italic', lineHeight: 1.5, paddingRight: 60 },
  refinePromptClose: { position: 'absolute', top: 10, right: 10, fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: '#5a8a4a', fontFamily: 'Georgia, serif' },
  anchorGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  anchor: { background: '#fff', border: '1px solid #d8d2c8', borderRadius: 4, padding: '14px 16px' },
  anchorTitle: { fontSize: 13, fontWeight: 'bold', color: '#2a2521', marginBottom: 6 },
  anchorText: { fontSize: 12, color: '#5a5550', lineHeight: 1.7 },
  checkGrid: { display: 'flex', flexDirection: 'column', gap: 12 },
  checkItem: { background: '#fff', border: '1px solid #d8d2c8', borderRadius: 4, padding: '12px 14px' },
  checkLabel: { fontSize: 13, color: '#2a2521', marginBottom: 4 },
  checkDetail: { fontSize: 12, color: '#7a7570', lineHeight: 1.5 },
  timeline: { borderLeft: '2px solid #d8d2c8', paddingLeft: 16, marginLeft: 8 },
  timelineItem: { position: 'relative', paddingBottom: 16, display: 'flex', gap: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: '50%', background: '#5a7a4a', flexShrink: 0, marginTop: 3, marginLeft: -21 },
  timelineContent: {},
  timelineLabel: { fontSize: 11, color: '#8a8480', marginBottom: 2 },
  timelineText: { fontSize: 13, color: '#2a2521', lineHeight: 1.5 },
  emptyMain: { textAlign: 'center' },
  emptyMainTitle: { fontSize: 22, fontWeight: 'bold', color: '#2a2521', marginBottom: 8 },
  emptyMainSub: { fontSize: 14, color: '#a09a8e', marginBottom: 16 },
  addrSpinner: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#a09a8e' },
  addrDropdown: { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ccc8c0', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: 220, overflowY: 'auto' },
  addrOption: { padding: '9px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f0ede8', color: '#2a2521', fontFamily: 'Georgia, serif', lineHeight: 1.4 },
}
