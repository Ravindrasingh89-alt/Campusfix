import { useEffect, useState } from 'react'
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendEmailVerification, sendPasswordResetEmail,
} from 'firebase/auth'
import { collection, addDoc, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore'
import { auth, db, uploadPhoto, CATEGORIES, DEPT, STATUSES } from './firebase'

const BRANCHES = ['CSE', 'IT', 'ECE', 'Mechanical', 'Civil', 'Electrical', 'Other']
const YEARS = ['1st year', '2nd year', '3rd year', '4th year']

// Friendly messages instead of raw Firebase errors
const nice = (x) =>
  ({
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'This email already has an account. Try logging in.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes, or use "Forgot password".',
    'auth/network-request-failed': 'No internet. Check your connection.',
  }[x.code] || x.message)

// Small logo icon (pin with a tick)
const Icon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
    <path d="M9 9.5l2.2 2.2L15 8" />
  </svg>
)

const when = (c) =>
  c.createdAt?.seconds
    ? new Date(c.createdAt.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : 'just now'

function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}

// Live list of complaints; makeQuery decides which ones
function useComplaints(makeQuery) {
  const [list, setList] = useState([])
  useEffect(
    () =>
      onSnapshot(
        makeQuery(),
        (s) => {
          const rows = s.docs.map((d) => ({ id: d.id, ...d.data() }))
          rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
          setList(rows)
        },
        (e) => alert(e.message)
      ),
    []
  )
  return list
}

function Track({ status }) {
  const at = STATUSES.indexOf(status)
  return (
    <div className="track" aria-label={`Status: ${status}`}>
      {STATUSES.map((s, i) => (
        <span key={s} className={i <= at ? 'on' : ''} title={s} />
      ))}
    </div>
  )
}

// who = show reporter details (for staff and admin only)
function Card({ c, who, children }) {
  return (
    <article className="card">
      <header>
        <h3>{c.category}</h3>
        <span>
          {c.urgent && <span className="badge urgent">Urgent</span>}{' '}
          <span className="badge" data-s={c.status}>{c.status}</span>
        </span>
      </header>
      <Track status={c.status} />
      <p>{c.description}</p>
      <p className="meta">
        <span>{c.locationText || 'Place not given'}</span>
        {c.lat && (
          <a href={`https://www.google.com/maps?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">Open map</a>
        )}
      </p>
      <p className="meta">
        <span>{c.department} · {when(c)}</span>
        {c.reopenCount > 0 && <span>Reopened {c.reopenCount}x</span>}
      </p>
      {who && c.reporterName && (
        <p className="meta">
          <span>👤 {c.reporterName}{c.reporterRoll ? ` · ${c.reporterRoll}` : ''}</span>
          {c.reporterPhone && <a href={`tel:${c.reporterPhone}`}>{c.reporterPhone}</a>}
        </p>
      )}
      <div className="photos">
        <figure><img src={c.photoURL} alt="Before" /><figcaption>Before</figcaption></figure>
        {c.afterPhotoURL && <figure><img src={c.afterPhotoURL} alt="After" /><figcaption>After</figcaption></figure>}
      </div>
      {children}
    </article>
  )
}

function Login() {
  const [signup, setSignup] = useState(false)
  const [f, setF] = useState({
    name: '', email: '', password: '', role: 'student', department: Object.values(DEPT)[0],
    roll: '', phone: '', branch: BRANCHES[0], year: YEARS[0],
  })
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const isStudent = f.role === 'student'

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setInfo('')
    setBusy(true)
    try {
      if (signup) {
        const { user } = await createUserWithEmailAndPassword(auth, f.email, f.password)
        const data = {
          name: f.name.trim(), email: f.email, role: f.role,
          department: f.role === 'staff' ? f.department : null,
          needsVerify: isStudent,
        }
        if (isStudent) Object.assign(data, { roll: f.roll.trim(), phone: f.phone.trim(), branch: f.branch, year: f.year })
        await setDoc(doc(db, 'users', user.uid), data)
        if (isStudent) { try { await sendEmailVerification(user) } catch (_) { /* resend button is on next screen */ } }
      } else {
        await signInWithEmailAndPassword(auth, f.email, f.password)
      }
    } catch (x) {
      setErr(nice(x))
    }
    setBusy(false)
  }

  async function forgot() {
    setErr('')
    setInfo('')
    if (!f.email) return setErr('Type your email above first, then tap "Forgot password".')
    try {
      await sendPasswordResetEmail(auth, f.email)
      setInfo('Reset link sent. Check your inbox (and spam folder).')
    } catch (x) {
      setErr(nice(x))
    }
  }

  return (
    <div className="auth">
      <div className="hero">
        <div className="brand">
          <div className="logo"><Icon /></div>
          <b>CampusFix</b>
        </div>
        <div>
          <p className="eyebrow">Report. Route. Resolve. Verify.</p>
          <h1>Campus problems, fixed and verified.</h1>
          <p>Snap a photo, send it, and track it until you confirm the fix.</p>
        </div>
        <small>Team Mind Flayers · MU ANANT 1.0</small>
      </div>
      <div className="formside">
        <div className="formbox">
          <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="sub">{signup ? 'It takes less than a minute.' : 'Log in to report or track a problem.'}</p>
          <form onSubmit={submit}>
            {signup && (
              <Field label="Full name">
                <input placeholder="Your full name" value={f.name} onChange={set('name')} required />
              </Field>
            )}
            <Field label="Email">
              <input type="email" placeholder="you@college.edu" value={f.email} onChange={set('email')} required />
            </Field>
            <Field label="Password">
              <input type="password" placeholder="6+ characters" value={f.password} onChange={set('password')} minLength={6} required />
            </Field>
            {signup && (
              <Field label="I am">
                <select value={f.role} onChange={set('role')}>
                  <option value="student">A student</option>
                  <option value="staff">Maintenance staff</option>
                  <option value="admin">Admin / warden</option>
                </select>
              </Field>
            )}
            {signup && f.role === 'staff' && (
              <Field label="Department">
                <select value={f.department} onChange={set('department')}>
                  {Object.values(DEPT).map((d) => <option key={d}>{d}</option>)}
                </select>
              </Field>
            )}
            {signup && isStudent && (
              <>
                <div className="row2">
                  <Field label="Roll / Enrollment no.">
                    <input placeholder="e.g. 24CS101" value={f.roll} onChange={set('roll')} required />
                  </Field>
                  <Field label="Phone (10 digits)">
                    <input type="tel" inputMode="numeric" placeholder="9876543210" pattern="[0-9]{10}" maxLength={10}
                      title="Enter a 10 digit phone number" value={f.phone} onChange={set('phone')} required />
                  </Field>
                </div>
                <div className="row2">
                  <Field label="Branch">
                    <select value={f.branch} onChange={set('branch')}>{BRANCHES.map((b) => <option key={b}>{b}</option>)}</select>
                  </Field>
                  <Field label="Year">
                    <select value={f.year} onChange={set('year')}>{YEARS.map((y) => <option key={y}>{y}</option>)}</select>
                  </Field>
                </div>
              </>
            )}
            {err && <p className="err">{err}</p>}
            {info && <p className="info">{info}</p>}
            <button disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</button>
          </form>
          {!signup && <button className="link" onClick={forgot}>Forgot password?</button>}
          <button className="link" onClick={() => { setSignup(!signup); setErr(''); setInfo('') }}>
            {signup ? 'I already have an account' : 'Create a new account'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Shown to new students until they click the link in their email
function VerifyEmail({ user, onDone }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function check() {
    setBusy(true)
    setMsg('')
    try {
      await user.reload()
      if (auth.currentUser.emailVerified) onDone()
      else setMsg('Not verified yet. Open the link in your email first.')
    } catch (x) {
      setMsg(nice(x))
    }
    setBusy(false)
  }
  async function resend() {
    setMsg('')
    try {
      await sendEmailVerification(user)
      setMsg('Email sent again. Check inbox and spam.')
    } catch (x) {
      setMsg(nice(x))
    }
  }
  return (
    <div className="verify">
      <div className="formbox">
        <div className="logo"><Icon /></div>
        <h2>Verify your email</h2>
        <p className="sub">We sent a link to <b>{user.email}</b>. Open it, then come back here.</p>
        {msg && <p className="info">{msg}</p>}
        <button onClick={check} disabled={busy}>{busy ? 'Checking…' : 'I have verified, continue'}</button>
        <button className="ghost" onClick={resend}>Send email again</button>
        <button className="link" onClick={() => signOut(auth)}>Log out</button>
      </div>
    </div>
  )
}

function Report({ user, profile, done }) {
  const [photo, setPhoto] = useState(null)
  const [category, setCategory] = useState(CATEGORIES[0])
  const [place, setPlace] = useState('')
  const [text, setText] = useState('')
  const [pos, setPos] = useState(null)
  const [busy, setBusy] = useState(false)

  const getPos = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => alert('Allow location access in your browser, then tap "Get location".')
    )
  useEffect(() => { getPos() }, [])

  async function submit(e) {
    e.preventDefault()
    if (!photo) return alert('Add a photo of the problem first.')
    setBusy(true)
    try {
      const photoURL = await uploadPhoto(photo)
      await addDoc(collection(db, 'complaints'), {
        category, department: DEPT[category], description: text, locationText: place,
        lat: pos?.lat ?? null, lng: pos?.lng ?? null, photoURL, afterPhotoURL: null,
        status: 'Assigned', reopenCount: 0, createdBy: user.uid, createdAt: serverTimestamp(),
        reporterName: profile.name || '', reporterRoll: profile.roll || '', reporterPhone: profile.phone || '',
      })
      done()
    } catch (x) {
      alert(x.message)
    }
    setBusy(false)
  }

  return (
    <form className="report" onSubmit={submit}>
      <label className="photo">
        {photo ? <img src={URL.createObjectURL(photo)} alt="Preview" /> : <span>📷 Tap to take a photo</span>}
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => setPhoto(e.target.files[0])} />
      </label>
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select>
      <input placeholder="Where? (e.g. Hostel B, 2nd floor washroom)" value={place} onChange={(e) => setPlace(e.target.value)} required />
      <textarea placeholder="What is wrong?" value={text} onChange={(e) => setText(e.target.value)} required />
      <p className="meta span2">
        <span>{pos ? '📍 Location captured' : 'Location not captured'}</span>
        <button type="button" className="link" onClick={getPos}>Get location</button>
      </p>
      <button className="span2" disabled={busy}>{busy ? 'Sending…' : 'Send complaint'}</button>
    </form>
  )
}

function Student({ user, profile }) {
  const [tab, setTab] = useState('report')
  const list = useComplaints(() => query(collection(db, 'complaints'), where('createdBy', '==', user.uid)))
  const upd = (c, d) => updateDoc(doc(db, 'complaints', c.id), d)
  return (
    <>
      <nav className="tabs">
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>New complaint</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My complaints ({list.length})</button>
      </nav>
      {tab === 'report' ? (
        <Report user={user} profile={profile} done={() => setTab('mine')} />
      ) : list.length === 0 ? (
        <p className="empty">No complaints yet. Report your first problem.</p>
      ) : (
        <div className="grid">
          {list.map((c) => (
            <Card key={c.id} c={c}>
              {c.status === 'Resolved' && (
                <div className="actions">
                  <button className="ok" onClick={() => upd(c, { status: 'Verified' })}>Verify fix</button>
                  <button className="danger" onClick={() => upd(c, { status: 'In Progress', reopenCount: (c.reopenCount || 0) + 1 })}>Reopen</button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function Staff({ profile }) {
  const list = useComplaints(() => query(collection(db, 'complaints'), where('department', '==', profile.department)))
  const [busy, setBusy] = useState('')
  const upd = (c, d) => updateDoc(doc(db, 'complaints', c.id), d)
  async function finish(c, file) {
    if (!file) return
    setBusy(c.id)
    try {
      await upd(c, { afterPhotoURL: await uploadPhoto(file), status: 'Resolved' })
    } catch (x) {
      alert(x.message)
    }
    setBusy('')
  }
  return (
    <div>
      <div className="head">
        <h2>{profile.department} tasks</h2>
        <p>{list.length} total</p>
      </div>
      {list.length === 0 && <p className="empty">No tasks yet. New complaints for your department appear here.</p>}
      <div className="grid">
        {list.map((c) => (
          <Card key={c.id} c={c} who>
            {c.status === 'Assigned' && <button onClick={() => upd(c, { status: 'In Progress' })}>Start work</button>}
            {c.status === 'In Progress' && (
              <label className="btn">
                {busy === c.id ? 'Uploading…' : 'Upload after photo'}
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => finish(c, e.target.files[0])} />
              </label>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

function Admin() {
  const list = useComplaints(() => query(collection(db, 'complaints')))
  const [fStatus, setFStatus] = useState('All')
  const [fCat, setFCat] = useState('')
  const [q, setQ] = useState('')
  const depts = [...new Set(Object.values(DEPT))]
  const upd = (c, d) => updateDoc(doc(db, 'complaints', c.id), d).catch((x) => alert(x.message))
  const remove = async (c) => {
    if (!window.confirm('Delete this complaint permanently?')) return
    try { await deleteDoc(doc(db, 'complaints', c.id)) } catch (x) { alert(x.message) }
  }

  const now = Date.now() / 1000
  const open = list.filter((c) => c.status !== 'Verified')
  const stale = open.filter((c) => c.createdAt && now - c.createdAt.seconds > 86400)
  const stats = [
    ['Total', list.length],
    ['Open', open.length],
    ['Waiting for student check', list.filter((c) => c.status === 'Resolved').length],
    ['Verified', list.length - open.length],
    ['Open over 24 hours', stale.length],
  ]
  const byDept = depts.map((d) => [d, open.filter((c) => c.department === d).length])
  const max = Math.max(1, ...byDept.map((x) => x[1]))

  const text = q.trim().toLowerCase()
  const shown = list
    .filter((c) => fStatus === 'All' || c.status === fStatus)
    .filter((c) => !fCat || c.category === fCat)
    .filter((c) => !text || `${c.description} ${c.locationText} ${c.category} ${c.reporterName || ''} ${c.reporterRoll || ''}`.toLowerCase().includes(text))
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))

  return (
    <div>
      <div className="head">
        <h2>Admin dashboard</h2>
        <p>See everything, route it, and mark what is urgent.</p>
      </div>
      <div className="stats">
        {stats.map(([k, v]) => (
          <div key={k} className={k === 'Open over 24 hours' && v ? 'late' : ''}><b>{v}</b><span>{k}</span></div>
        ))}
      </div>

      <section className="panel">
        <h3>Open complaints by department</h3>
        {byDept.map(([d, n]) => (
          <div className="barrow" key={d}>
            <span>{d}</span>
            <div><div className="bar" style={{ width: `${(n / max) * 100}%` }} /></div>
            <i>{n}</i>
          </div>
        ))}
      </section>

      <div className="toolbar">
        <input type="search" placeholder="Search place, problem, student…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="chips">
        {['All', ...STATUSES.filter((s) => s !== 'Submitted')].map((s) => (
          <button key={s} className={`chip ${fStatus === s ? 'on' : ''}`} onClick={() => setFStatus(s)}>{s}</button>
        ))}
      </div>

      {shown.length === 0 && <p className="empty">No complaints match.</p>}
      <div className="grid">
        {shown.map((c) => (
          <Card key={c.id} c={c} who>
            <div className="admin-actions">
              <select value={c.department} onChange={(e) => upd(c, { department: e.target.value })} aria-label="Route to department">
                {depts.map((d) => <option key={d} value={d}>Route to: {d}</option>)}
              </select>
              <button className="ghost" onClick={() => upd(c, { urgent: !c.urgent })}>{c.urgent ? 'Remove urgent' : 'Mark urgent'}</button>
              <button className="danger" onClick={() => remove(c)}>Delete</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [, force] = useState(0)

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); if (!u) setProfile(null) }), [])
  useEffect(() => {
    if (!user) return
    return onSnapshot(doc(db, 'users', user.uid), (s) => setProfile(s.exists() ? s.data() : null))
  }, [user])

  if (user === undefined) return <p className="empty">Loading…</p>
  if (!user) return <Login />
  if (!profile) return <p className="empty">Setting up your account…</p>
  if (profile.needsVerify && !user.emailVerified) return <VerifyEmail user={user} onDone={() => force((n) => n + 1)} />

  const initials = (profile.name || '?').split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()

  return (
    <>
      <header className="top">
        <div className="brand">
          <div className="logo"><Icon /></div>
          <b>CampusFix</b>
        </div>
        <div className="who">
          <b>{profile.name}</b>
          <span>{profile.role}{profile.department ? ` · ${profile.department}` : ''}</span>
        </div>
        <div className="avatar" aria-hidden="true">{initials}</div>
        <button className="ghost" onClick={() => signOut(auth)}>Log out</button>
      </header>
      <main className="page">
        {profile.role === 'student' ? <Student user={user} profile={profile} /> : profile.role === 'staff' ? <Staff profile={profile} /> : <Admin />}
      </main>
    </>
  )
}
