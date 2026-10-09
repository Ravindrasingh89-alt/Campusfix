import { Component, useEffect, useRef, useState } from 'react'
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendEmailVerification, sendPasswordResetEmail,
} from 'firebase/auth'
import {
  collection, addDoc, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, serverTimestamp,
  arrayUnion, arrayRemove, increment,
} from 'firebase/firestore'
import { auth, db, uploadPhoto, CATEGORIES, DEPT, STATUSES } from './firebase'

const BRANCHES = ['CSE', 'IT', 'ECE', 'Mechanical', 'Civil', 'Electrical', 'Other']
const YEARS = ['1st year', '2nd year', '3rd year', '4th year']

// Secret code needed to sign up as staff or admin (change it here anytime)
const ACCESS_CODE = 'MIND2026'

// Votes needed to auto-mark a complaint Urgent
const URGENT_VOTES = 3

// One timeline entry (who did what, when)
const entry = (by, text) => ({ t: Date.now(), by: by || 'Someone', text })
const stamp = (t) =>
  new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// Update a complaint, add a timeline line, and (optionally) notify the student
const change = (c, profile, uid, d, text, notify = true) =>
  updateDoc(doc(db, 'complaints', c.id), {
    ...d,
    timeline: arrayUnion(entry(profile.name, text)),
    ...(notify ? { updatedAt: Date.now(), updatedBy: uid, updateNote: text } : {}),
  })

// Make phone photos smaller before upload (faster on slow networks). Falls back to the original file.
async function shrink(file, max = 1280) {
  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const r = Math.min(1, max / Math.max(img.width, img.height))
    const cv = document.createElement('canvas')
    cv.width = Math.round(img.width * r)
    cv.height = Math.round(img.height * r)
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
    URL.revokeObjectURL(url)
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8))
    return blob && blob.size < file.size ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file
  } catch (_) {
    return file
  }
}

// Shows a friendly screen instead of a blank page if something unexpected breaks
class Safe extends Component {
  state = { bad: false }
  static getDerivedStateFromError() { return { bad: true } }
  render() {
    if (!this.state.bad) return this.props.children
    return (
      <div className="verify">
        <div className="formbox">
          <h2>Something went wrong</h2>
          <p className="sub">Please reload the page. Your complaints are safe.</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}

// Live list of all user profiles (admin uses it to assign staff and see logins)
function useUsers() {
  const [list, setList] = useState([])
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'users')),
        (s) => setList(s.docs.map((d) => ({ uid: d.id, ...d.data() }))),
        () => {}
      ),
    []
  )
  return list
}

// Search box + status chips + grid of cards (used by student tabs)
function Browse({ list, empty, children }) {
  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState('All')
  const text = q.trim().toLowerCase()
  const shown = list
    .filter((c) => fStatus === 'All' || c.status === fStatus)
    .filter((c) => !text || `${c.description} ${c.locationText} ${c.category}`.toLowerCase().includes(text))
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))
  return (
    <>
      <div className="toolbar one">
        <input type="search" placeholder="Search place or problem…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chips">
        {['All', ...STATUSES.filter((x) => x !== 'Submitted')].map((x) => (
          <button key={x} className={`chip ${fStatus === x ? 'on' : ''}`} onClick={() => setFStatus(x)}>{x}</button>
        ))}
      </div>
      {shown.length === 0 && <p className="empty">{empty}</p>}
      <div className="grid">{shown.map((c) => children(c))}</div>
    </>
  )
}

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
  const votes = (c.upvotes || []).length
  const steps = c.timeline || []
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
      {(c.assignedTo || votes > 0) && (
        <p className="meta">
          <span>{c.assignedTo ? `🔧 Assigned to ${c.assignedTo}` : ''}</span>
          {votes > 0 && <span>👍 {votes} {votes === 1 ? 'student has' : 'students have'} this problem</span>}
        </p>
      )}
      {c.reopenReason && c.status !== 'Verified' && (
        <p className="reason"><b>Reopened because:</b> {c.reopenReason}</p>
      )}
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
      {steps.length > 0 && (
        <details className="timeline">
          <summary>Timeline ({steps.length})</summary>
          <ul>
            {steps.map((x, k) => (
              <li key={k}><span>{stamp(x.t)}</span> <b>{x.by}</b>: {x.text}</li>
            ))}
          </ul>
        </details>
      )}
      {children}
    </article>
  )
}

function Login() {
  const [signup, setSignup] = useState(false)
  const [f, setF] = useState({
    name: '', email: '', password: '', role: 'student', department: Object.values(DEPT)[0],
    roll: '', phone: '', branch: BRANCHES[0], year: YEARS[0], code: '',
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
        if (!isStudent && f.code.trim() !== ACCESS_CODE) {
          setErr('Wrong access code. Ask your admin for the staff/admin code.')
          setBusy(false)
          return
        }
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
            {signup && !isStudent && (
              <Field label="Staff / Admin access code">
                <input type="password" placeholder="Secret code" value={f.code} onChange={set('code')} required />
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

function Report({ user, profile, done, similar, vote }) {
  const [photo, setPhoto] = useState(null)
  const [category, setCategory] = useState(CATEGORIES[0])
  const [place, setPlace] = useState('')
  const [text, setText] = useState('')
  const [pos, setPos] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loadingLoc, setLoadingLoc] = useState(false)
  const [locErr, setLocErr] = useState('')

  // Try accurate GPS first; if it times out (laptops have no GPS), fall back to Wi-Fi/network location
  function getPos() {
    if (!navigator.geolocation) return setLocErr('This browser does not support location.')
    setLoadingLoc(true)
    setLocErr('')
    const ok = (p) => {
      setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy })
      setLoadingLoc(false)
    }
    const fail = (e) => {
      setLoadingLoc(false)
      setLocErr(
        e.code === 1
          ? 'Location is blocked. Tap the 🔒 icon next to the address bar, set Location to Allow, then tap "Get location".'
          : e.code === 2
            ? 'Location not available. Turn on GPS / Wi-Fi and try again.'
            : 'Location timed out. Try again near a window, or turn on Wi-Fi.'
      )
    }
    navigator.geolocation.getCurrentPosition(
      ok,
      (e) => {
        if (e.code === 1) return fail(e)
        navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }
  useEffect(() => { getPos() }, [])

  // Open complaints from OTHER students in the same category (to avoid duplicates)
  const like = similar.filter((c) => c.category === category).slice(0, 3)

  async function submit(e) {
    e.preventDefault()
    if (!photo) return alert('Add a photo of the problem first.')
    setBusy(true)
    try {
      const photoURL = await uploadPhoto(await shrink(photo))
      await addDoc(collection(db, 'complaints'), {
        category, department: DEPT[category], description: text, locationText: place,
        lat: pos?.lat ?? null, lng: pos?.lng ?? null, photoURL, afterPhotoURL: null,
        status: 'Assigned', reopenCount: 0, createdBy: user.uid, createdAt: serverTimestamp(),
        reporterName: profile.name || '', reporterRoll: profile.roll || '', reporterPhone: profile.phone || '',
        upvotes: [], assignedTo: null, assignedUid: null,
        timeline: [entry(profile.name, `Reported and sent to ${DEPT[category]}`)],
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
      {like.length > 0 && (
        <div className="similar span2">
          <b>Already reported by others. Same problem? Tap "Me too" instead of a new complaint.</b>
          {like.map((c) => {
            const voted = (c.upvotes || []).includes(user.uid)
            return (
              <div className="srow" key={c.id}>
                <span>{c.locationText} · {(c.description || '').slice(0, 45)}</span>
                <button type="button" className={voted ? 'ok' : 'ghost'} onClick={() => vote(c)}>
                  {voted ? 'Voted ✓' : `Me too (${(c.upvotes || []).length})`}
                </button>
              </div>
            )
          })}
        </div>
      )}
      <input placeholder="Where? (e.g. Hostel B, 2nd floor washroom)" value={place} onChange={(e) => setPlace(e.target.value)} required />
      <textarea placeholder="What is wrong?" value={text} onChange={(e) => setText(e.target.value)} required />
      <p className="meta span2">
        <span>
          {loadingLoc ? '📡 GPS fetch ho raha hai...' : pos ? `📍 Location saved${pos.acc ? ` (±${Math.round(pos.acc)} m)` : ''}` : 'Location not captured'}
        </span>
        <button type="button" className="link" disabled={loadingLoc || busy} onClick={getPos}>
          {pos ? 'Refresh location' : 'Get location'}
        </button>
      </p>
      {locErr && <p className="err span2">{locErr}</p>}
      <button className="span2" disabled={busy || loadingLoc}>{busy ? 'Sending…' : 'Send complaint'}</button>
    </form>
  )
}

function Student({ user, profile }) {
  const [tab, setTab] = useState('report')
  const all = useComplaints(() => query(collection(db, 'complaints')))
  const mine = all.filter((c) => c.createdBy === user.uid)
  const others = all.filter((c) => c.createdBy !== user.uid)
  const openOthers = others.filter((c) => c.status !== 'Verified')

  // Notification banner: staff/admin changed one of my complaints and I have not seen it yet
  const key = `cf_seen_${user.uid}`
  const readSeen = () => { try { return JSON.parse(localStorage.getItem(key)) || {} } catch (_) { return {} } }
  const [seen, setSeen] = useState(readSeen)
  const news = mine.filter((c) => c.updatedAt && c.updatedBy !== user.uid && c.updatedAt > (seen[c.id] || 0))
  function dismiss() {
    const n = { ...seen }
    news.forEach((c) => { n[c.id] = c.updatedAt })
    setSeen(n)
    try { localStorage.setItem(key, JSON.stringify(n)) } catch (_) { /* ignore */ }
  }

  async function vote(c) {
    const has = (c.upvotes || []).includes(user.uid)
    const count = (c.upvotes || []).length + (has ? -1 : 1)
    const d = { upvotes: has ? arrayRemove(user.uid) : arrayUnion(user.uid) }
    if (!has && count >= URGENT_VOTES && !c.urgent) {
      d.urgent = true
      d.timeline = arrayUnion(entry('System', `Auto-marked Urgent (${count} students have this problem)`))
    }
    try { await updateDoc(doc(db, 'complaints', c.id), d) } catch (x) { alert(x.message) }
  }

  const verify = (c) => change(c, profile, user.uid, { status: 'Verified' }, 'Verified the fix. Complaint closed.', false).catch((x) => alert(x.message))
  function reopen(c) {
    const why = window.prompt('Why are you reopening this? (required)')
    if (!why || !why.trim()) return
    change(
      c, profile, user.uid,
      { status: 'In Progress', reopenCount: (c.reopenCount || 0) + 1, reopenReason: why.trim(), resolvedAt: null },
      `Reopened: ${why.trim()}`, false
    ).catch((x) => alert(x.message))
  }

  return (
    <>
      {news.length > 0 && (
        <div className="banner">
          <div>
            {news.slice(0, 3).map((c) => (
              <p key={c.id}>🔔 <b>{c.category}</b> ({c.locationText}): {c.updateNote}</p>
            ))}
            {news.length > 3 && <p>…and {news.length - 3} more</p>}
          </div>
          <button className="ghost" onClick={dismiss}>OK</button>
        </div>
      )}
      <nav className="tabs">
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>New complaint</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My complaints ({mine.length})</button>
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>Campus feed ({openOthers.length})</button>
      </nav>
      {tab === 'report' && (
        <Report user={user} profile={profile} done={() => setTab('mine')} similar={openOthers} vote={vote} />
      )}
      {tab === 'mine' && (
        mine.length === 0 ? (
          <p className="empty">No complaints yet. Report your first problem.</p>
        ) : (
          <Browse list={mine} empty="No complaints match.">
            {(c) => (
              <Card key={c.id} c={c}>
                {c.status === 'Resolved' && (
                  <div className="actions">
                    <button className="ok" onClick={() => verify(c)}>Verify fix</button>
                    <button className="danger" onClick={() => reopen(c)}>Reopen</button>
                  </div>
                )}
              </Card>
            )}
          </Browse>
        )
      )}
      {tab === 'feed' && (
        others.length === 0 ? (
          <p className="empty">No complaints from other students yet.</p>
        ) : (
          <Browse list={others} empty="No complaints match.">
            {(c) => {
              const voted = (c.upvotes || []).includes(user.uid)
              return (
                <Card key={c.id} c={c}>
                  {c.status !== 'Verified' && (
                    <button className={voted ? 'ok' : 'ghost'} onClick={() => vote(c)}>
                      {voted ? 'Voted ✓ (tap to undo)' : '👍 Me too, I face this problem'}
                    </button>
                  )}
                </Card>
              )
            }}
          </Browse>
        )
      )}
    </>
  )
}

function Staff({ user, profile }) {
  const list = useComplaints(() => query(collection(db, 'complaints'), where('department', '==', profile.department)))
  const [busy, setBusy] = useState('')
  const act = (c, d, text) => change(c, profile, user.uid, d, text).catch((x) => alert(x.message))
  async function finish(c, file) {
    if (!file) return
    setBusy(c.id)
    try {
      await change(c, profile, user.uid, { afterPhotoURL: await uploadPhoto(await shrink(file)), status: 'Resolved', resolvedAt: Date.now() }, 'Fixed. After photo uploaded. Please verify.')
    } catch (x) {
      alert(x.message)
    }
    setBusy('')
  }
  const sorted = [...list].sort((a, b) => (b.assignedUid === user.uid ? 1 : 0) - (a.assignedUid === user.uid ? 1 : 0) || (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))
  return (
    <div>
      <div className="head">
        <h2>{profile.department} tasks</h2>
        <p>{list.length} total</p>
      </div>
      {list.length === 0 && <p className="empty">No tasks yet. New complaints for your department appear here.</p>}
      <div className="grid">
        {sorted.map((c) => (
          <Card key={c.id} c={c} who>
            {c.status === 'Assigned' && <button onClick={() => act(c, { status: 'In Progress' }, 'Work started')}>Start work</button>}
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

function Admin({ user, profile }) {
  const list = useComplaints(() => query(collection(db, 'complaints')))
  const users = useUsers()
  const staff = users.filter((x) => x.role === 'staff')
  const [fStatus, setFStatus] = useState('All')
  const [fCat, setFCat] = useState('')
  const [q, setQ] = useState('')
  const depts = [...new Set(Object.values(DEPT))]
  const act = (c, d, text, notify) => change(c, profile, user.uid, d, text, notify).catch((x) => alert(x.message))
  const remove = async (c) => {
    if (!window.confirm('Delete this complaint permanently?')) return
    try { await deleteDoc(doc(db, 'complaints', c.id)) } catch (x) { alert(x.message) }
  }

  const now = Date.now() / 1000
  const open = list.filter((c) => c.status !== 'Verified')
  const stale = open.filter((c) => c.createdAt && now - c.createdAt.seconds > 86400)
  const fixed = list.filter((c) => c.resolvedAt && c.createdAt?.seconds)
  const avgHours = fixed.length
    ? fixed.reduce((t, c) => t + (c.resolvedAt / 1000 - c.createdAt.seconds), 0) / fixed.length / 3600
    : null
  const stats = [
    ['Total', list.length],
    ['Open', open.length],
    ['Waiting for student check', list.filter((c) => c.status === 'Resolved').length],
    ['Verified', list.length - open.length],
    ['Open over 24 hours', stale.length],
    ['Avg fix time', avgHours === null ? '–' : avgHours < 1 ? `${Math.max(1, Math.round(avgHours * 60))}m` : `${avgHours.toFixed(1)}h`],
  ]
  const byDept = depts.map((d) => [d, open.filter((c) => c.department === d).length])
  const max = Math.max(1, ...byDept.map((x) => x[1]))

  const text = q.trim().toLowerCase()
  const shown = list
    .filter((c) => fStatus === 'All' || c.status === fStatus)
    .filter((c) => !fCat || c.category === fCat)
    .filter((c) => !text || `${c.description} ${c.locationText} ${c.category} ${c.reporterName || ''} ${c.reporterRoll || ''}`.toLowerCase().includes(text))
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0))

  function assign(c, uid) {
    const person = staff.find((x) => x.uid === uid)
    if (!person) return act(c, { assignedTo: null, assignedUid: null }, 'Assignment removed', false)
    act(c, { assignedTo: person.name, assignedUid: uid }, `Assigned to ${person.name}`)
  }
  function route(c, dept) {
    act(c, { department: dept, assignedTo: null, assignedUid: null }, `Routed to ${dept}`)
  }

  return (
    <div>
      <div className="head">
        <h2>Admin dashboard</h2>
        <p>See everything, route it, assign staff, and mark what is urgent.</p>
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

      <details className="panel">
        <summary><b>People and last login ({users.length})</b></summary>
        <div className="people">
          {[...users]
            .sort((a, b) => (b.lastLogin?.seconds || 0) - (a.lastLogin?.seconds || 0))
            .map((p) => (
              <p key={p.uid}>
                <span><b>{p.name}</b> · {p.role}{p.department ? ` · ${p.department}` : ''}</span>
                <span>{p.lastLogin?.seconds ? stamp(p.lastLogin.seconds * 1000) : 'never'}{p.loginCount ? ` · ${p.loginCount} logins` : ''}</span>
              </p>
            ))}
        </div>
      </details>

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
              <select value={c.department} onChange={(e) => route(c, e.target.value)} aria-label="Route to department">
                {depts.map((d) => <option key={d} value={d}>Route to: {d}</option>)}
              </select>
              <select value={c.assignedUid || ''} onChange={(e) => assign(c, e.target.value)} aria-label="Assign to staff">
                <option value="">Assign to staff…</option>
                {staff.filter((x) => x.department === c.department).map((x) => (
                  <option key={x.uid} value={x.uid}>Assign to: {x.name}</option>
                ))}
              </select>
              <button className="ghost" onClick={() => act(c, { urgent: !c.urgent }, c.urgent ? 'Urgent removed' : 'Marked urgent', false)}>{c.urgent ? 'Remove urgent' : 'Mark urgent'}</button>
              <button className="danger" onClick={() => remove(c)}>Delete</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Main() {
  const [user, setUser] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [, force] = useState(0)

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); if (!u) setProfile(null) }), [])
  useEffect(() => {
    if (!user) return
    return onSnapshot(doc(db, 'users', user.uid), (s) => setProfile(s.exists() ? s.data() : null))
  }, [user])

  // Record one login per visit (last login time + count)
  const logged = useRef('')
  useEffect(() => {
    if (!user || !profile || logged.current === user.uid) return
    logged.current = user.uid
    updateDoc(doc(db, 'users', user.uid), { lastLogin: serverTimestamp(), loginCount: increment(1) }).catch(() => {})
  }, [user, profile])

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
        {profile.role === 'student' ? <Student user={user} profile={profile} /> : profile.role === 'staff' ? <Staff user={user} profile={profile} /> : <Admin user={user} profile={profile} />}
      </main>
    </>
  )
}

export default function App() {
  return (
    <Safe>
      <Main />
    </Safe>
  )
}
