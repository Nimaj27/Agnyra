// tournee.js — Logique métier tournée calendriers
import { COLLECTIONS, ORGANISATION_ACTUELLE, fsAdd, fsSet, fsUpdate, fsDelete, fsLot, fsGet, fsGetRapide, fsGetAll, fsGetAllOrg, fsQuery, fsQueryRapide, fsListen, fsListenOrg, organisationCourante, increment, isOnline, where, serverTimestamp } from "./firebase.js";
import { recalculerTotauxSecteur } from "./secteurs.js";

export const STATUT_PASSAGE = { DON:"don", OFFERT:"offert", REFUSE:"refuse", ABSENT:"absent", RELANCE:"relance" };
export const STATUT_PASSAGE_LABEL = { don:"Don collecté", offert:"Calendrier offert", refuse:"A refusé", absent:"Absent", relance:"À relancer" };
export const MODE_PAIEMENT = { ESPECES:"especes", CHEQUE:"cheque", CARTE:"carte" };

export async function creerEquipe({ nom, membres=[], pin, organisationId=ORGANISATION_ACTUELLE }) {
  if (!nom) throw new Error("Nom d'équipe obligatoire");
  if (!pin || !/^\d{4}$/.test(pin)) throw new Error("PIN doit être 4 chiffres");
  // L'unicité est structurelle : "<organisationId>_<pin>" est l'identifiant
  // du document, donc le PIN n'a besoin d'être unique que dans sa caserne
  // (chantier multi-tenant, point 3).
  const cleId = `${organisationId}_${pin}`;
  const pris = await fsGet(COLLECTIONS.PINS, cleId);
  if (pris) throw new Error("Ce PIN est déjà utilisé");
  const ref = await fsAdd(COLLECTIONS.EQUIPES, { organisationId, nom, membres, actif:true });
  await fsSet(COLLECTIONS.PINS, cleId, { equipeId: ref.id, nom, organisationId, pin });
  return ref;
}
export async function mettreAJourEquipe(equipeId, data) {
  const { pin, ...champs } = data;
  if (pin !== undefined && pin !== null && pin !== '') {
    if (!/^\d{4}$/.test(pin)) throw new Error("PIN doit être 4 chiffres");
    // La caserne de la clé pins/ vient de l'équipe elle-même (source de
    // vérité), pas d'une valeur devinée ou passée par l'appelant.
    const equipe = await fsGet(COLLECTIONS.EQUIPES, equipeId);
    const organisationId = equipe?.organisationId || ORGANISATION_ACTUELLE;
    const cleId = `${organisationId}_${pin}`;
    const pris = await fsGet(COLLECTIONS.PINS, cleId);
    if (pris && pris.equipeId !== equipeId) throw new Error("Ce PIN est déjà utilisé");
    // Retirer l'ancien code de cette équipe
    const tous = await fsGetAll(COLLECTIONS.PINS);
    for (const p of tous) {
      if (p.equipeId === equipeId && p.id !== cleId) await fsDelete(COLLECTIONS.PINS, p.id);
    }
    await fsSet(COLLECTIONS.PINS, cleId, { equipeId, nom: champs.nom || pris?.nom || '', organisationId, pin });
  }
  if (Object.keys(champs).length) await fsUpdate(COLLECTIONS.EQUIPES, equipeId, champs);
}
export async function supprimerEquipe(id) {
  const tous = await fsGetAll(COLLECTIONS.PINS);
  for (const p of tous) if (p.equipeId === id) await fsDelete(COLLECTIONS.PINS, p.id);
  return fsDelete(COLLECTIONS.EQUIPES, id);
}

// Table { equipeId → pin } — réservée aux administrateurs (règle "list")
export async function lirePins() {
  const tous = await fsGetAllOrg(COLLECTIONS.PINS);
  const map = {};
  // p.pin porte le code à 4 chiffres nu ; p.id (la clé "<org>_<pin>") sert
  // de repli pour d'éventuels documents antérieurs à ce champ.
  for (const p of tous) map[p.equipeId] = p.pin || p.id;
  return map;
}

// Migration : déplace les PIN encore stockés dans /equipes vers /pins
export async function migrerPins() {
  const equipes = await fsGetAllOrg(COLLECTIONS.EQUIPES);
  let deplaces = 0, conflits = 0;
  for (const e of equipes) {
    if (!e.pin) continue;
    const orgId = e.organisationId || ORGANISATION_ACTUELLE;
    const cleId = `${orgId}_${e.pin}`;
    const pris = await fsGet(COLLECTIONS.PINS, cleId);
    if (pris && pris.equipeId !== e.id) { conflits++; continue; }
    await fsSet(COLLECTIONS.PINS, cleId, { equipeId: e.id, nom: e.nom || '', organisationId: orgId, pin: e.pin });
    await fsUpdate(COLLECTIONS.EQUIPES, e.id, { pin: null });
    deplaces++;
  }
  return { deplaces, conflits, total: equipes.length };
}
export async function lireEquipes() { return fsGetAllOrg(COLLECTIONS.EQUIPES); }
export async function lireEquipe(id) { return fsGet(COLLECTIONS.EQUIPES, id); }
export function ecouterEquipes(callback) {
  return fsListenOrg(COLLECTIONS.EQUIPES, (equipes) => {
    equipes.sort((a,b)=>a.nom.localeCompare(b.nom));
    callback(equipes);
  });
}

export async function ajouterPassage({ secteurId, equipeId, equipeNom, adresse, statut, montant=0, modePaiement=null, nomDonateur="", note="", saisiPar="", horsSecteur=false }) {
  if (horsSecteur) return ajouterVenteHorsSecteur({ equipeId, equipeNom, adresse, statut, montant, modePaiement, nomDonateur, note, saisiPar });
  if (!secteurId||!equipeId) throw new Error("secteurId et equipeId obligatoires");
  if (!Object.values(STATUT_PASSAGE).includes(statut)) throw new Error("Statut invalide");
  if (statut===STATUT_PASSAGE.DON && montant<=0) throw new Error("Montant requis pour un don");
  // La caserne du passage est celle de la session (les écrans ne proposent que les secteurs de la caserne
  // courante) ; à défaut, celle du secteur lui-même, lue sans attendre un serveur lent ou absent.
  let organisationId = organisationCourante();
  if (!organisationId) {
    const secteur = await fsGetRapide(COLLECTIONS.SECTEURS, secteurId).catch(() => null);
    organisationId = secteur?.organisationId || ORGANISATION_ACTUELLE;
  }
  // Le statut "offert" ne requiert aucun montant (calendrier donné sans contrepartie)
  const donnees = {
    organisationId,
    secteurId, equipeId, equipeNom, adresse:adresse||"", statut,
    montant: statut===STATUT_PASSAGE.DON ? Number(montant) : 0,
    modePaiement: statut===STATUT_PASSAGE.DON ? modePaiement : null,
    nomDonateur, note, saisiPar, aRelancer: statut===STATUT_PASSAGE.ABSENT || statut===STATUT_PASSAGE.RELANCE, datePassage: new Date().toISOString(),
    nbPassages: 1
  };
  // Passage et totaux du secteur dans UN lot atomique, totaux par incréments : aucune lecture avant
  // d'écrire, donc pas de course entre deux équipiers qui saisissent en même temps, et le lot est rejoué
  // tel quel à la reconnexion (un recalcul fait hors ligne partirait d'un cache incomplet).
  const lot = fsLot();
  const id = lot.ajouter(COLLECTIONS.PASSAGES, donnees);
  lot.modifier(COLLECTIONS.SECTEURS, secteurId, incrementsTotaux(null, donnees));
  await lot.valider();
  return { id };
}

// ── Totaux d'un secteur : contributions et incréments ────────────
// Chaque passage du secteur contribue à : collecte (dons), foyers traités (don, offert, refus), absents
// (absent, à relancer), calendriers (don, offert) et nombre de passages. Mêmes règles que
// recalculerTotauxSecteur (secteurs.js), qui sert de réparation.
export function contributionPassage(p) {
  const s = p && p.statut;
  return {
    totalCollecte:   s === STATUT_PASSAGE.DON ? Number(p.montant || 0) : 0,
    nbFoyersVisites: (s === STATUT_PASSAGE.DON || s === STATUT_PASSAGE.OFFERT || s === STATUT_PASSAGE.REFUSE) ? 1 : 0,
    nbFoyersAbsents: (s === STATUT_PASSAGE.ABSENT || s === STATUT_PASSAGE.RELANCE) ? 1 : 0,
    nbCalendriers:   (s === STATUT_PASSAGE.DON || s === STATUT_PASSAGE.OFFERT) ? 1 : 0,
    nbFoyersTotal:   p ? 1 : 0
  };
}
const CHAMPS_TOTAUX = Object.keys(contributionPassage({}));
// { champ: increment(écart) } pour les seuls champs qui changent entre deux états d'un passage
// (avant = null : création ; apres = null : suppression)
function incrementsTotaux(avant, apres) {
  const a = contributionPassage(avant), b = contributionPassage(apres), out = {};
  for (const k of CHAMPS_TOTAUX) { const ecart = (b[k] || 0) - (a[k] || 0); if (Math.abs(ecart) > 1e-9) out[k] = increment(ecart); }
  return out;
}
// Repli quand l'état précédent d'un passage est introuvable : recalcul complet, sans bloquer la saisie.
// Si lui aussi échoue, la réconciliation du tableau de bord (statsGlobalesTournee) corrigera l'écart.
function recalculerEnArrierePlan(secteurId) {
  // Hors ligne, un recalcul partirait d'un cache incomplet et écraserait de bons totaux : on laisse la
  // réconciliation du tableau de bord s'en charger.
  if (!isOnline()) return;
  recalculerTotauxSecteur(secteurId).catch(e => console.warn("Recalcul des totaux différé :", e?.message || e));
}
// ── Calendriers vendus hors secteur ──────────────────────────────
// Vente à une personne qui n'habite aucun secteur de la tournée (famille,
// collègue, passant…). Pas de foyer ni de secteur : le passage porte
// `horsSecteur:true` et `secteurId:null`. Il compte dans les totaux
// (collecte, calendriers, classement) mais pas dans les « foyers visités »
// ni dans l'avancement des secteurs. Seuls don et offert ont un sens ici.
export async function ajouterVenteHorsSecteur({ equipeId, equipeNom, adresse="", statut, montant=0, modePaiement=null, nomDonateur="", note="", saisiPar="" }) {
  if (!equipeId) throw new Error("equipeId obligatoire");
  if (statut!==STATUT_PASSAGE.DON && statut!==STATUT_PASSAGE.OFFERT) throw new Error("Une vente hors secteur est un don ou un calendrier offert");
  if (statut===STATUT_PASSAGE.DON && !(Number(montant)>0)) throw new Error("Montant requis pour un don");
  // La caserne est celle de la session ; à défaut, celle de l'équipe elle-même.
  let organisationId = organisationCourante();
  if (!organisationId) {
    const equipe = await fsGetRapide(COLLECTIONS.EQUIPES, equipeId).catch(() => null);
    organisationId = equipe?.organisationId || ORGANISATION_ACTUELLE;
  }
  return fsAdd(COLLECTIONS.PASSAGES, {
    organisationId,
    secteurId:null, horsSecteur:true, equipeId, equipeNom, adresse:adresse||"", statut,
    montant: statut===STATUT_PASSAGE.DON ? Number(montant) : 0,
    modePaiement: statut===STATUT_PASSAGE.DON ? modePaiement : null,
    nomDonateur, note, saisiPar, aRelancer:false, datePassage:new Date().toISOString(),
    nbPassages: 1
  });
}
export async function ventesHorsSecteurEquipe(equipeId) {
  const passages = await fsQuery(COLLECTIONS.PASSAGES, where("equipeId","==",equipeId));
  return passages.filter(p=>p.horsSecteur).sort((a,b)=>(b.datePassage||"").localeCompare(a.datePassage||""));
}
// Pas de secteur dont recalculer les totaux : un simple effacement suffit.
export async function supprimerVenteHorsSecteur(passageId) {
  await fsDelete(COLLECTIONS.PASSAGES, passageId);
}
export async function marquerRelance(passageId, secteurId) {
  await modifierPassage(passageId, { aRelancer:true, statut:STATUT_PASSAGE.RELANCE, secteurId });
}
// Vérifie si une adresse a déjà été saisie dans ce secteur (anti-doublon binôme)
// Retourne le passage existant le plus récent, ou null
export async function verifierDoublonAdresse(secteurId, adresse) {
  if (!adresse || !adresse.trim()) return null;
  const passages = await fsQueryRapide(COLLECTIONS.PASSAGES, where("secteurId","==",secteurId));   // cache si le serveur tarde
  const norm = (s) => (s||"").toLowerCase().replace(/[^a-z0-9]/g, "");
  const cible = norm(adresse);
  if (!cible) return null;
  const matches = passages.filter(p => norm(p.adresse) === cible);
  if (matches.length === 0) return null;
  return matches.sort((a,b)=>(b.datePassage||"").localeCompare(a.datePassage||""))[0];
}

// Modification d'un passage : le passage et l'écart de ses contributions (voir contributionPassage) sont
// écrits dans le même lot atomique ; l'état précédent est lu dans le cache (déjà tenu à jour par les
// écouteurs de l'équipier), sans attendre le serveur.
export async function modifierPassage(passageId, data) {
  const { secteurId: secteurIdFourni, ...champs } = data;
  const avant = await fsGetRapide(COLLECTIONS.PASSAGES, passageId).catch(() => null);
  const secteurId = (avant && avant.secteurId) || secteurIdFourni;
  if (!avant) {
    await fsUpdate(COLLECTIONS.PASSAGES, passageId, champs);
    if (secteurId) recalculerEnArrierePlan(secteurId);
    return;
  }
  const lot = fsLot();
  lot.modifier(COLLECTIONS.PASSAGES, passageId, champs);
  const incr = secteurId ? incrementsTotaux(avant, { ...avant, ...champs }) : {};
  if (Object.keys(incr).length) lot.modifier(COLLECTIONS.SECTEURS, secteurId, incr);
  await lot.valider();
}

export async function supprimerPassage(passageId, secteurId) {
  const avant = await fsGetRapide(COLLECTIONS.PASSAGES, passageId).catch(() => null);
  const sid = (avant && avant.secteurId) || secteurId;
  const lot = fsLot();
  lot.supprimer(COLLECTIONS.PASSAGES, passageId);
  // Un passage déjà supprimé (double appui, autre équipier) n'est pas décompté une seconde fois
  const incr = (avant && sid) ? incrementsTotaux(avant, null) : {};
  if (Object.keys(incr).length) lot.modifier(COLLECTIONS.SECTEURS, sid, incr);
  await lot.valider();
  if (!avant && sid) recalculerEnArrierePlan(sid);
}
// rapide : lecture avec repli sur le cache, pour les recherches faites avant une écriture sur le terrain
export async function passagesDuSecteur(secteurId, { rapide = false } = {}) {
  const lire = rapide ? fsQueryRapide : fsQuery;
  const passages = await lire(COLLECTIONS.PASSAGES, where("secteurId","==",secteurId));
  return passages.sort((a,b)=>(a.datePassage||"").localeCompare(b.datePassage||""));
}
export async function passagesDeLEquipe(equipeId) {
  const passages = await fsQuery(COLLECTIONS.PASSAGES, where("equipeId","==",equipeId));
  return passages.sort((a,b)=>(a.datePassage||"").localeCompare(b.datePassage||""));
}
export async function foyersARelancer() {
  // Filtré côté client plutôt que par une 2e clause where() : évite
  // d'exiger un index composite (aRelancer + organisationId) sur Firestore.
  const passages = await fsGetAllOrg(COLLECTIONS.PASSAGES);
  return passages.filter(p => p.aRelancer);
}
export function ecouterPassagesSecteur(secteurId, callback) {
  return fsListen(COLLECTIONS.PASSAGES, (passages) => {
    passages.sort((a,b)=>(b.datePassage||"").localeCompare(a.datePassage||""));
    callback(passages);
  }, where("secteurId","==",secteurId));
}

export async function statsGlobalesTournee() {
  const [passages, equipes, secteurs] = await Promise.all([
    fsGetAllOrg(COLLECTIONS.PASSAGES), fsGetAllOrg(COLLECTIONS.EQUIPES), fsGetAllOrg(COLLECTIONS.SECTEURS)
  ]);
  let totalEspeces=0, totalCheques=0, totalCarte=0, nbDons=0, nbOfferts=0, nbRefus=0, nbAbsents=0, nbRelances=0;
  for (const p of passages) {
    if (p.statut==="don") { nbDons++; if(p.modePaiement==="especes") totalEspeces+=Number(p.montant||0); else if(p.modePaiement==="cheque") totalCheques+=Number(p.montant||0); else if(p.modePaiement==="carte") totalCarte+=Number(p.montant||0); }
    if (p.statut==="offert") nbOfferts++;
    if (p.statut==="refuse") nbRefus++;
    if (p.statut==="absent") nbAbsents++;
    if (p.statut==="relance") nbRelances++;
  }
  const nbCalendriers = nbDons + nbOfferts;   // calendriers distribués au total
  // Ventes hors secteur : comptées dans la collecte et les calendriers, pas dans les « passages » (foyers visités)
  const horsSect = passages.filter(p=>p.horsSecteur);
  const horsSecteur = {
    nbDons: horsSect.filter(p=>p.statut==="don").length,
    nbOfferts: horsSect.filter(p=>p.statut==="offert").length,
    montant: horsSect.filter(p=>p.statut==="don").reduce((s,p)=>s+Number(p.montant||0),0)
  };
  horsSecteur.nbCalendriers = horsSecteur.nbDons + horsSecteur.nbOfferts;
  const totalCollecte = totalEspeces + totalCheques + totalCarte;
  const parEquipe = equipes.map(eq => {
    const eqPassages = passages.filter(p=>p.equipeId===eq.id);
    const montant = eqPassages.filter(p=>p.statut==="don").reduce((s,p)=>s+Number(p.montant||0),0);
    const nbRefusEq = eqPassages.filter(p=>p.statut==="refuse").length;
    const nbOffertsEq = eqPassages.filter(p=>p.statut==="offert").length;
    const nbDonsEq = eqPassages.filter(p=>p.statut==="don").length;
    return { ...eq, montant, nbPassages:eqPassages.filter(p=>!p.horsSecteur).length, nbRefus:nbRefusEq,
             nbOfferts:nbOffertsEq, nbCalendriers:nbDonsEq + nbOffertsEq };
  }).sort((a,b)=>b.montant-a.montant);
  const nbSecteursTermines = secteurs.filter(s=>s.statut==="termine").length;
  const nbSecteursTotal = secteurs.length;
  const avancement = nbSecteursTotal>0 ? Math.round((nbSecteursTermines/nbSecteursTotal)*100) : 0;
  const ecartsTotaux = ecartsTotauxSecteurs(secteurs, passages);
  return { totalCollecte, totalEspeces, totalCheques, totalCarte, nbDons, nbOfferts, nbCalendriers, nbRefus, nbAbsents, nbRelances, nbPassages:passages.length - horsSect.length, horsSecteur, nbSecteursTermines, nbSecteursTotal, avancement, parEquipe, ecartsTotaux };
}

// ── Réconciliation des totaux de secteur ─────────────────────────
// Les totaux stockés sur chaque secteur sont mis à jour par incréments à chaque saisie. Un écart reste
// possible (suppression simultanée du même passage par deux équipiers, saisie faite avant ce
// mécanisme, passage modifié alors que son état précédent était introuvable) : on le détecte en
// recomptant les passages, que l'admin charge de toute façon pour le tableau de bord.
// Rend [{ id, nom, totaux }] pour les seuls secteurs dont les totaux stockés diffèrent.
export function ecartsTotauxSecteurs(secteurs, passages) {
  const attendus = {};
  for (const p of passages) {
    if (!p.secteurId) continue;                       // vente hors secteur : aucun secteur
    const t = attendus[p.secteurId] || (attendus[p.secteurId] = Object.fromEntries(CHAMPS_TOTAUX.map(k => [k, 0])));
    const c = contributionPassage(p);
    for (const k of CHAMPS_TOTAUX) t[k] += c[k];
  }
  const ecarts = [];
  for (const s of secteurs) {
    const totaux = attendus[s.id] || Object.fromEntries(CHAMPS_TOTAUX.map(k => [k, 0]));
    const different = CHAMPS_TOTAUX.some(k => Math.abs(Number(s[k] || 0) - totaux[k]) > (k === "totalCollecte" ? 0.005 : 0));
    if (different) ecarts.push({ id: s.id, nom: s.nom, totaux: { ...totaux, totalCollecte: Math.round(totaux.totalCollecte * 100) / 100 } });
  }
  return ecarts;
}
// Corrige les secteurs en écart (appelée par le tableau de bord admin). Les passages et les secteurs de
// statsGlobalesTournee sont lus à quelques instants d'écart : une saisie qui tombe entre les deux
// ressemble à un écart sans en être un. On attend donc, puis on relit chaque secteur et ses passages et on
// ne réécrit que si l'écart est toujours là. Rend le nombre de secteurs corrigés.
export async function corrigerTotauxSecteurs(ecarts, { attenteMs = 3000 } = {}) {
  if (!ecarts.length) return 0;
  await new Promise(r => setTimeout(r, attenteMs));
  let corriges = 0;
  for (const e of ecarts) {
    const [passages, secteur] = await Promise.all([
      fsQuery(COLLECTIONS.PASSAGES, where("secteurId","==",e.id)), fsGet(COLLECTIONS.SECTEURS, e.id)
    ]);
    if (!secteur) continue;
    const [ecart] = ecartsTotauxSecteurs([secteur], passages);
    if (ecart) { await fsUpdate(COLLECTIONS.SECTEURS, e.id, ecart.totaux); corriges++; }
  }
  return corriges;
}

export async function lireConfig() { return fsGet(COLLECTIONS.CONFIG, "tournee"); }
export async function sauvegarderConfig(data) { return fsSet(COLLECTIONS.CONFIG, "tournee", data); }


// ── Dates locales ────────────────────────────────────────────────
// datePassage est stocké en UTC (toISOString) : le jour et l'heure à afficher
// ou à regrouper sont ceux de l'appareil, pas les 10/5 premiers caractères.
export function dateLocaleISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function jourLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateLocaleISO(d);
}
export function heureLocale(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Cellule CSV compatible Excel : double les guillemets et neutralise les
// préfixes interprétés comme des formules (=, +, -, @).
export function celluleCSV(value) {
  let v = String(value ?? "");
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  return `"${v.replaceAll('"', '""')}"`;
}

export async function exporterBilanCSV() {
  const [passages, secteurs, equipes] = await Promise.all([fsGetAllOrg(COLLECTIONS.PASSAGES), fsGetAllOrg(COLLECTIONS.SECTEURS), fsGetAllOrg(COLLECTIONS.EQUIPES)]);
  const secteurMap = Object.fromEntries(secteurs.map(s=>[s.id,s]));
  const ligne = (...vals) => vals.map(celluleCSV).join(";") + "\n";
  let csv = "BILAN PAR SECTEUR\n" + ligne("Secteur","Commune","Équipe","Statut","Total collecté (€)","Foyers visités","Absents");
  for (const s of secteurs) csv += ligne(s.nom, s.commune, s.equipNom||'-', s.statut, (s.totalCollecte||0).toFixed(2), s.nbFoyersVisites||0, s.nbFoyersAbsents||0);
  csv += "\n\nBILAN PAR ÉQUIPE\n" + ligne("Équipe","Membres","Montant collecté (€)","Nb passages");
  for (const e of equipes) {
    const eqP = passages.filter(p=>p.equipeId===e.id);
    const montant = eqP.filter(p=>p.statut==="don").reduce((s,p)=>s+Number(p.montant||0),0);
    csv += ligne(e.nom, (e.membres||[]).join(', '), montant.toFixed(2), eqP.filter(p=>!p.horsSecteur).length);
  }
  csv += "\n\nDÉTAIL DES PASSAGES\n" + ligne("Date","Équipe","Secteur","Commune","Adresse","Statut","Mode paiement","Montant (€)","Nom donateur","Note");
  const sorted = [...passages].sort((a,b)=>(a.datePassage||"").localeCompare(b.datePassage||""));
  for (const p of sorted) {
    const s = secteurMap[p.secteurId]||{};
    csv += ligne(jourLocal(p.datePassage), p.equipeNom||'', p.horsSecteur ? 'Hors secteur' : (s.nom||''), s.commune||'', p.adresse||'', p.statut, p.modePaiement||'', p.montant?Number(p.montant).toFixed(2):'0.00', p.nomDonateur||'', p.note||'');
  }
  csv += "\n\nFOYERS À RELANCER\n" + ligne("Équipe","Secteur","Commune","Adresse","Note");
  for (const p of passages.filter(p=>p.aRelancer)) {
    const s = secteurMap[p.secteurId]||{};
    csv += ligne(p.equipeNom||'', s.nom||'', s.commune||'', p.adresse||'', p.note||'');
  }
  return csv;
}
export function telechargerCSV(csv, filename="bilan-tournee-calendriers.csv") {
  const bom = "\uFEFF";
  const blob = new Blob([bom+csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}


// ── Effacement de tous les passages (nettoyage des saisies de test) ──
// Les secteurs et les équipes sont conservés ; seuls les passages sont
// supprimés et les totaux des secteurs remis à zéro.
export async function effacerTousLesPassages() {
  const passages = await fsGetAllOrg(COLLECTIONS.PASSAGES);
  let supprimes = 0, erreurs = 0;
  for (const p of passages) {
    try { await fsDelete(COLLECTIONS.PASSAGES, p.id); supprimes++; }
    catch(e) { erreurs++; }
  }
  // Remettre à zéro les compteurs de chaque secteur
  const secteurs = await fsGetAllOrg(COLLECTIONS.SECTEURS);
  for (const s of secteurs) {
    try {
      await fsUpdate(COLLECTIONS.SECTEURS, s.id, {
        totalCollecte: 0, nbFoyersVisites: 0, nbFoyersAbsents: 0,
        nbCalendriers: 0, nbFoyersTotal: 0
      });
    } catch(e) { /* on continue */ }
  }
  return { supprimes, erreurs, secteurs: secteurs.length };
}
