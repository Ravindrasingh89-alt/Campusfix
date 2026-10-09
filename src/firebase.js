import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// 1) Firebase config (if login says api-key-not-valid, re-copy apiKey from Firebase Console)
const firebaseConfig = {
  apiKey: 'AIzaSyArnalADZckq6RqcVT8XBo4EThISnYrows',
  authDomain: 'campusfix-8930f.firebaseapp.com',
  projectId: 'campusfix-8930f',
  storageBucket: 'campusfix-8930f.firebasestorage.app',
  messagingSenderId: '945927197775',
  appId: '1:945927197775:web:e3b64bf79d8551bef3863a',
}

// 2) Cloudinary: cloud name + an UNSIGNED upload preset
export const CLOUD_NAME = 'hwpifg2v'
export const UPLOAD_PRESET = 'campusfix'

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

export const CATEGORIES = ['Electrical', 'Plumbing', 'Civil', 'Housekeeping']
export const DEPT = {
  Electrical: 'Electrical Dept',
  Plumbing: 'Plumbing Dept',
  Civil: 'Civil Dept',
  Housekeeping: 'Housekeeping Dept',
}
export const STATUSES = ['Submitted', 'Assigned', 'In Progress', 'Resolved', 'Verified']

export async function uploadPhoto(file) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('upload_preset', UPLOAD_PRESET)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: fd })
  const data = await res.json()
  if (!data.secure_url) throw new Error(data.error?.message || 'Photo upload failed')
  return data.secure_url.replace('/upload/', '/upload/w_700,q_auto/')
}
