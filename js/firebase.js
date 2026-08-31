// ============================================================
// firebase.js — Configuration et initialisation Firebase
// Belenos — projet Firebase dédié (chantier multi-tenant, point 1)
// ============================================================

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAdKgOOKSklOYiud8mC4VSBUUhT1HWNlJ0",
  authDomain:        "belenos-611bd.firebaseapp.com",
  projectId:         "belenos-611bd",
  storageBucket:     "belenos-611bd.firebasestorage.app",
  messagingSenderId: "503376077615",
  appId:             "1:503376077615:web:638bac385c2cc3bfa477da"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, increment,
  enableNetwork, disableNetwork, writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager({ forceOwnership: false })
    })
  });
} catch (e) {
  console.warn("Persistence hors-ligne indisponible:", e?.message);
  db = getFirestore(app);
}

const COLLECTIONS = {
  CONFIG:        "config",
  EQUIPES:       "equipes",
  SECTEURS:      "secteurs",
  PASSAGES:      "passages",
  ADMINS:        "admins",
  PINS:          "pins",         // { pin } → { equipeId } : le code est l'identifiant du document
  JOURNAL:       "journal",      // traçabilité des corrections et suppressions
  ORGANISATIONS: "organisations" // une caserne par document, le slug (ex. "pacy") sert d'ID
};

// Caserne à laquelle rattacher les nouvelles données (chantier multi-tenant,
// point 2 : secteurs/équipes/passages portent un organisationId).
// TODO (chantier multi-tenant, point 3) : remplacer cette constante figée par
// la caserne identifiée à la connexion. Pour l'instant, une seule caserne
// existe (Pacy-sur-Eure, slug "pacy") donc la valeur reste fixe.
const ORGANISATION_ACTUELLE = "pacy";

const fsCollection = (name)          => collection(db, name);
const fsDoc        = (path, ...id)   => doc(db, path, ...id);
const fsAdd        = (col, data)     => addDoc(collection(db, col), { ...data, createdAt: serverTimestamp() });
const fsSet        = (col, id, data) => setDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
const fsUpdate     = (col, id, data) => updateDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() });
const fsDelete     = (col, id)       => deleteDoc(doc(db, col, id));
const fsGet        = async (col, id) => { const s = await getDoc(doc(db, col, id)); return s.exists() ? { id: s.id, ...s.data() } : null; };
const fsGetAll     = async (col)     => { const s = await getDocs(collection(db, col)); return s.docs.map(d => ({ id: d.id, ...d.data() })); };
const fsQuery      = async (col, ...constraints) => {
  const s = await getDocs(query(collection(db, col), ...constraints));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
};
const fsListen     = (col, cb, ...constraints) => {
  const q = constraints.length ? query(collection(db, col), ...constraints) : collection(db, col);
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};
const fsListenDoc  = (col, id, cb) =>
  onSnapshot(doc(db, col, id), snap => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));

// ── Session technique ────────────────────────────────────────
// Les règles Firestore exigent une session. Les équipiers (code PIN) n'ont
// pas de compte : on leur ouvre une session anonyme Firebase, ce qui permet
// aux règles de refuser tout accès direct à l'API hors de l'application.
let _sessionEnCours = null;
async function assurerSession() {
  if (auth.currentUser) return auth.currentUser;
  if (_sessionEnCours) return _sessionEnCours;
  _sessionEnCours = signInAnonymously(auth)
    .then(r => { _sessionEnCours = null; return r.user; })
    .catch(e => {
      _sessionEnCours = null;
      console.error("Session anonyme refusée :", e?.code || e);
      throw e;
    });
  return _sessionEnCours;
}

const estAnonyme = () => !!auth.currentUser?.isAnonymous;

const loginGoogle      = () => signInWithPopup(auth, googleProvider);
const getLoginRedirect = () => Promise.resolve(null);
const logoutGoogle     = () => signOut(auth);
const onAuth           = (cb) => onAuthStateChanged(auth, cb);

async function isAdmin(email) {
  if (!email) return false;
  const snap = await getDoc(doc(db, COLLECTIONS.ADMINS, String(email).trim().toLowerCase()));
  return snap.exists();
}

// Caserne rattachée à un compte admin (chantier multi-tenant, point 3).
// Pas de saisie supplémentaire pour l'admin : son compte Google suffit,
// la caserne est lue sur son document admins/{email}. À défaut de champ
// organisationId (compte créé avant ce chantier), on retombe sur la
// caserne unique actuelle.
async function obtenirOrganisationAdmin(email) {
  if (!email) return null;
  const snap = await getDoc(doc(db, COLLECTIONS.ADMINS, String(email).trim().toLowerCase()));
  if (!snap.exists()) return null;
  return snap.data()?.organisationId || ORGANISATION_ACTUELLE;
}

// Connexion par code PIN, scopée à une caserne (chantier multi-tenant,
// point 3 — code caserne saisi explicitement). La clé du document dans
// /pins combine caserne + PIN ("<organisationId>_<pin>") : deux casernes
// peuvent donc réutiliser le même code à 4 chiffres. La collection n'est
// pas énumérable (règle "list" réservée aux administrateurs).
async function loginPin(organisationId, pin) {
  const ref = await fsGet(COLLECTIONS.PINS, `${organisationId}_${pin}`);
  if (!ref || !ref.equipeId) {
    // Repli sur l'ancien stockage, le temps que la migration soit faite
    const legacy = await fsQuery(COLLECTIONS.EQUIPES, where("pin", "==", pin), where("organisationId", "==", organisationId));
    return legacy.length ? legacy[0] : null;
  }
  const equipe = await fsGet(COLLECTIONS.EQUIPES, ref.equipeId);
  return equipe || null;
}

// ── Organisations (chantier multi-tenant, point 1) ──────────────
// Une organisation = une caserne. Le slug (ex. "pacy") sert d'ID de document :
// ça permet une lecture directe lors de l'identification par code caserne
// (chantier 3), sans passer par une requête ("where slug ==").
// Rattachement des données (secteurs/équipes/passages) : chantier 2.
// Cloisonnement inter-organisations : chantier 4.

async function creerOrganisation({ slug, nom, couleur, logoBase64 = null, actif = true }) {
  await setDoc(doc(db, COLLECTIONS.ORGANISATIONS, slug), {
    slug, nom, couleur, logoBase64, actif,
    dateCreation: serverTimestamp()
  });
}

const obtenirOrganisation = (slug) => fsGet(COLLECTIONS.ORGANISATIONS, slug);

// Réservé aux comptes admin authentifiés — voir les règles Firestore.
const listerOrganisations = () => fsGetAll(COLLECTIONS.ORGANISATIONS);

// Identification d'une caserne par code saisi à la connexion (chantier
// multi-tenant, point 3). Normalise la casse/espaces et exige une
// organisation active — un code désactivé se comporte comme inconnu.
async function identifierOrganisation(code) {
  const slug = String(code || "").trim().toLowerCase();
  if (!slug) return null;
  const org = await obtenirOrganisation(slug);
  return (org && org.actif) ? org : null;
}

const _networkListeners = [];
let _isOnline = navigator.onLine;
window.addEventListener("online",  () => { _isOnline = true;  _networkListeners.forEach(cb => cb(true)); });
window.addEventListener("offline", () => { _isOnline = false; _networkListeners.forEach(cb => cb(false)); });
function isOnline() { return _isOnline; }
function onNetworkChange(cb) {
  _networkListeners.push(cb);
  return () => { const idx = _networkListeners.indexOf(cb); if (idx > -1) _networkListeners.splice(idx, 1); };
}

export {
  db, auth, writeBatch,
  COLLECTIONS, ORGANISATION_ACTUELLE,
  fsCollection, fsDoc, fsAdd, fsSet, fsUpdate, fsDelete,
  fsGet, fsGetAll, fsQuery, fsListen, fsListenDoc,
  loginGoogle, getLoginRedirect, logoutGoogle, onAuth, isAdmin, loginPin,
  obtenirOrganisationAdmin,
  assurerSession, estAnonyme,
  creerOrganisation, obtenirOrganisation, listerOrganisations, identifierOrganisation,
  where, orderBy, serverTimestamp, increment,
  isOnline, onNetworkChange, enableNetwork, disableNetwork
};
