// ============================================================
// functions/index.js — Cloud Functions Belenos
// Chantier multi-tenant, point 4 (volet équipier)
// ============================================================
//
// Une session anonyme (équipier connecté par code PIN) ne porte aucune
// information de caserne dans son jeton d'authentification : les règles
// Firestore ne peuvent donc pas cloisonner ses lectures/écritures par
// organisation à partir du seul jeton. Cette fonction déplace la
// vérification du PIN côté serveur (Admin SDK, qui contourne les règles
// Firestore) et délivre en échange un jeton personnalisé portant
// organisationId/equipeId en claims — les règles peuvent alors s'appuyer
// dessus exactement comme elles s'appuient sur l'email pour les admins.
//
// Effet de bord voulu : le PIN n'a plus besoin d'être lisible côté
// client. La collection /pins peut donc être fermée en lecture aux
// équipiers dans les règles Firestore (seuls les admins de la caserne
// concernée y gardent accès, pour l'affichage dans le tableau de bord).
//
// Déploiement (à faire une fois le projet passé en plan Blaze) :
//   cd functions && npm install
//   firebase deploy --only functions --project belenos-611bd

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

exports.verifierCodeEquipe = onCall(async (request) => {
  const organisationId = String(request.data?.organisationId || "").trim().toLowerCase();
  const pin = String(request.data?.pin || "").trim();

  if (!organisationId || !/^\d{4}$/.test(pin)) {
    throw new HttpsError("invalid-argument", "Code caserne et PIN à 4 chiffres requis.");
  }

  // Revalidation défensive de la caserne : ne fait confiance à aucune
  // donnée envoyée par le client au-delà de sa forme.
  const orgSnap = await db.doc(`organisations/${organisationId}`).get();
  if (!orgSnap.exists || orgSnap.data()?.actif !== true) {
    throw new HttpsError("not-found", "Caserne inconnue.");
  }

  const pinSnap = await db.doc(`pins/${organisationId}_${pin}`).get();
  let equipeId = pinSnap.exists ? pinSnap.data()?.equipeId : null;

  if (!equipeId) {
    // Repli sur l'ancien stockage (équipes dont le PIN n'a pas encore
    // été déplacé vers /pins par migrerPins()).
    const legacy = await db.collection("equipes")
      .where("pin", "==", pin)
      .where("organisationId", "==", organisationId)
      .limit(1)
      .get();
    if (!legacy.empty) equipeId = legacy.docs[0].id;
  }

  if (!equipeId) {
    throw new HttpsError("not-found", "Code PIN incorrect.");
  }

  const equipeSnap = await db.doc(`equipes/${equipeId}`).get();
  if (!equipeSnap.exists) {
    throw new HttpsError("not-found", "Code PIN incorrect.");
  }

  // UID déterministe par équipe : la même équipe retrouve la même
  // identité Firebase Auth à chaque connexion (utile pour l'audit via
  // request.auth.uid dans les règles et le journal).
  const uid = `equipe_${equipeId}`;
  const customToken = await getAuth().createCustomToken(uid, { organisationId, equipeId });

  return { customToken };
});
