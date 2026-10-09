import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { collection, addDoc, doc, setDoc, updateDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore'
import { auth, db, uploadPhoto, CATEGORIES, DEPT, STATUSES } from './firebase'

// Small logo icon (pin with a tick)
const Icon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
    <path d="M9 9.5l2.2 2.2L15 8" />
  </svg>
)

// "9 Oct" style date from a Firestore timestamp
const when = (c) =>
  c.createdAt?.seconds
    ? new Date(c.createdAt.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : 'just now'

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

function Card({ c, children }) {
  return (
    <article className="card">
      <header>
        <h3>{c.category}</h3>
        <span className="badge" data-s={c.status}>{c.status}</span>
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
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'student', department: Object.values(DEPT)[0] })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (signup) {
        const { user } = await createUserWithEmailAndPassword(auth, f.email, f.password)
        await setDoc(doc(db, 'users', user.uid), {
          name: f.name, email: f.email, role: f.role, department: f.role === 'staff' ? f.department : null,
        })
      } else {
        await signInWithEmailAndPassword(auth, f.email, f.password)
      }
    } catch (x) {
      setErr(x.message)
    }
    setBusy(false)
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
            {signup && <input placeholder="Full name" value={f.name} onChange={set('name')} required />}
            <input type="email" placeholder="College email" value={f.email} onChange={set('email')} required />
            <input type="password" placeholder="Password (6+ characters)" value={f.password} onChange={set('password')} minLength={6} required />
            {signup && (
              <select value={f.role} onChange={set('role')}>
                <option value="student">I am a student</option>
                <option value="staff">I am maintenance staff</option>
                <option value="admin">I am admin / warden</option>
              </select>
            )}
            {signup && f.role === 'staff' && (
              <select value={f.department} onChange={set('department')}>
                {Object.values(DEPT).map((d) => <option key={d}>{d}</option>)}
              </select>
            )}
            {err && <p className="err">{err}</p>}
            <button disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</button>
          </form>
          <button className="link" onClick={() => setSignup(!signup)}>
            {signup ? 'I already have an account' : 'Create a new account'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Report({ user, done }) {
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
      <p className="meta">
        <span>{pos ? '📍 Location captured' : 'Location not captured'}</span>
        <button type="button" className="link" onClick={getPos}>Get location</button>
      </p>
      <button disabled={busy}>{busy ? 'Sending…' : 'Send complaint'}</button>
    </form>
  )
}

function Student({ user }) {
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
        <Report user={user} done={() => setTab('mine')} />
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
          <Card key={c.id} c={c}>
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
  return (
    <div>
      <div className="head">
        <h2>Admin dashboard</h2>
        <p>Everything happening on campus.</p>
      </div>
      <div className="stats">
        {stats.map(([k, v]) => (
          <div key={k} className={k === 'Open over 24 hours' && v ? 'late' : ''}><b>{v}</b><span>{k}</span></div>
        ))}
      </div>
      <div className="grid">
        {list.map((c) => (
          <Card key={c.id} c={c} />
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(undefined)
  const [profile, setProfile] = useState(null)

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); if (!u) setProfile(null) }), [])
  useEffect(() => {
    if (!user) return
    return onSnapshot(doc(db, 'users', user.uid), (s) => setProfile(s.exists() ? s.data() : null))
  }, [user])

  if (user === undefined) return <p className="empty">Loading…</p>
  if (!user) return <Login />
  if (!profile) return <p className="empty">Setting up your account…</p>

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
        {profile.role === 'student' ? <Student user={user} /> : profile.role === 'staff' ? <Staff profile={profile} /> : <Admin />}
      </main>
    </>
  )
}
