import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { collection, addDoc, doc, setDoc, updateDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore'
import { auth, db, uploadPhoto, CATEGORIES, DEPT, STATUSES } from './firebase'

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
    <main className="login">
      <h1>CampusFix</h1>
      <p className="tag">Report it. Track it. See it fixed.</p>
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
    </main>
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
        {photo ? <img src={URL.createObjectURL(photo)} alt="Preview" /> : <span>Tap to take a photo</span>}
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => setPhoto(e.target.files[0])} />
      </label>
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select>
      <input placeholder="Where? (e.g. Hostel B, 2nd floor washroom)" value={place} onChange={(e) => setPlace(e.target.value)} required />
      <textarea placeholder="What is wrong?" value={text} onChange={(e) => setText(e.target.value)} required />
      <p className="meta">
        <span>{pos ? 'Location captured' : 'Location not captured'}</span>
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
        list.map((c) => (
          <Card key={c.id} c={c}>
            {c.status === 'Resolved' && (
              <div className="actions">
                <button onClick={() => upd(c, { status: 'Verified' })}>Verify fix</button>
                <button className="ghost" onClick={() => upd(c, { status: 'In Progress', reopenCount: (c.reopenCount || 0) + 1 })}>Reopen</button>
              </div>
            )}
          </Card>
        ))
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
    <section>
      <h2>{profile.department}: {list.length} tasks</h2>
      {list.length === 0 && <p className="empty">No tasks yet. New complaints for your department appear here.</p>}
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
    </section>
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
    <section>
      <div className="stats">
        {stats.map(([k, v]) => (
          <div key={k} className={k === 'Open over 24 hours' && v ? 'late' : ''}><b>{v}</b><span>{k}</span></div>
        ))}
      </div>
      {list.map((c) => (
        <Card key={c.id} c={c}><p className="meta"><span>{c.department}</span></p></Card>
      ))}
    </section>
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

  return (
    <>
      <header className="top">
        <b>CampusFix</b>
        <span>{profile.name} ({profile.role})</span>
        <button className="ghost" onClick={() => signOut(auth)}>Log out</button>
      </header>
      <main>
        {profile.role === 'student' ? <Student user={user} /> : profile.role === 'staff' ? <Staff profile={profile} /> : <Admin />}
      </main>
    </>
  )
}
