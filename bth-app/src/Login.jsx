import { useState } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const handleSubmit = async () => {
    setError(''); setMessage(''); setLoading(true)
    if (mode === 'signup') {
      if (!name.trim()) { setError('Enter your name.'); setLoading(false); return }
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }
      if (data?.user) await supabase.from('agents').upsert({ id: data.user.id, email, name: name.trim() })
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) setError(signInError.message)
    }
    setLoading(false)
  }

  return (
    <div style={s.shell}>
      <div style={s.card}>
        <div style={s.brandMark}>BUILD THE HOUSE</div>
        <div style={s.brandSub}>Buyer Framework</div>

        <div style={s.toggleRow}>
          <button style={{ ...s.toggle, ...(mode === 'signin' ? s.toggleActive : {}) }} onClick={() => { setMode('signin'); setError(''); setMessage('') }}>Sign in</button>
          <button style={{ ...s.toggle, ...(mode === 'signup' ? s.toggleActive : {}) }} onClick={() => { setMode('signup'); setError(''); setMessage('') }}>Create account</button>
        </div>

        {mode === 'signup' && (
          <div style={s.field}>
            <label style={s.label}>Your Name</label>
            <input style={s.input} value={name} placeholder="First Last" onChange={e => setName(e.target.value)} />
          </div>
        )}
        <div style={s.field}>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={email} placeholder="you@firm.com" onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>
        <div style={s.field}>
          <label style={s.label}>Password</label>
          <input style={s.input} type="password" value={password} placeholder="••••••••" onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
        </div>

        {error && <div style={s.error}>{error}</div>}
        {message && <div style={s.success}>{message}</div>}

        <button style={s.btn} onClick={handleSubmit} disabled={loading}>
          {loading ? 'Working...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </div>
    </div>
  )
}

const s = {
  shell: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f1729', fontFamily: "Georgia, 'Times New Roman', serif" },
  card: { width: 360, background: '#fff', borderRadius: 10, padding: '40px 36px', boxShadow: '0 8px 40px rgba(0,0,0,0.3)' },
  brandMark: { fontSize: 10, letterSpacing: '0.22em', color: '#c9a84c', fontWeight: 'bold', marginBottom: 4, textAlign: 'center' },
  brandSub: { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginBottom: 32 },
  toggleRow: { display: 'flex', marginBottom: 24, border: '1px solid #e8e0d4', borderRadius: 6, overflow: 'hidden' },
  toggle: { flex: 1, padding: '9px', border: 'none', background: 'transparent', fontSize: 13, cursor: 'pointer', fontFamily: 'Georgia, serif', color: '#9ca3af' },
  toggleActive: { background: '#0f1729', color: '#c9a84c', fontWeight: 'bold' },
  field: { marginBottom: 18 },
  label: { display: 'block', fontSize: 10, letterSpacing: '0.1em', color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #e8e0d4', borderRadius: 5, fontSize: 14, fontFamily: 'Georgia, serif', outline: 'none', color: '#0f1729', background: '#faf7f2' },
  error: { fontSize: 12, color: '#dc2626', marginBottom: 14, padding: '8px 12px', background: '#fef2f2', borderRadius: 4 },
  success: { fontSize: 12, color: '#16a34a', marginBottom: 14, padding: '8px 12px', background: '#f0fdf4', borderRadius: 4 },
  btn: { width: '100%', padding: '12px', background: '#0f1729', color: '#c9a84c', border: 'none', borderRadius: 5, fontSize: 14, cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 'bold', letterSpacing: '0.04em' },
}

