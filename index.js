// index.js
const express = require("express");
const admin = require("firebase-admin");
const geofire = require("geofire-common");
const cors = require("cors");

// ====== APP PRIMERO (para que 'app' exista antes de usarla) ======
const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "2mb", strict: true, type: "application/json" }));

// ====== FIREBASE CREDS ======
const rawCreds = process.env.GOOGLE_CREDENTIALS;
if (!rawCreds) {
  console.error("❌ Falta GOOGLE_CREDENTIALS");
  process.exit(1);
}
const fixedCreds = rawCreds.replace(/\r?\n/g, "\\n");
const serviceAccount = JSON.parse(fixedCreds);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
console.log("✅ Firebase inicializado:", serviceAccount.project_id);

// ====== HELPERS ======
const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
};
const sanitizeId = (s) => String(s).replace(/[\/\\#?&\s]/g, "_").slice(0, 200);

// Acepta lat/lng o latitud/longitud → { lat, lon }
function getLatLon(med) {
  const n = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v : NaN;
  };
  const lat = Number.isFinite(n(med.lat)) ? n(med.lat) : n(med.latitud);
  const lon = Number.isFinite(n(med.lng)) ? n(med.lng)
           : Number.isFinite(n(med.lon)) ? n(med.lon)
           : n(med.longitud);
  return { lat, lon };
}

// timestamp numérico en segundos (si viene en ms, lo bajo)
function getTimestampSeconds(med) {
  const toN = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v : NaN;
  };
  let t = toN(med.timestamp);
  if (!Number.isFinite(t) || t <= 0) t = toN(med.ts);
  if (!Number.isFinite(t) || t <= 0) t = Math.floor(Date.now() / 1000);
  if (t > 2_000_000_000) t = Math.round(t / 1000); // ms → s
  return t;
}

// ====== SALUD ======
app.get("/health", (_req, res) =>
  res.json({ ok: true, project: serviceAccount.project_id, time: new Date().toISOString() })
);

// ====== ENDPOINT PRINCIPAL ======
// Sólo guarda: co, co2, fechaHora, geohash, latitud, longitud, nh3, no2, pm10, pm25, position, timestamp, tvoc
app.post("/mediciones", async (req, res) => {
  const mediciones = req.body;
  if (!Array.isArray(mediciones)) {
    return res.status(400).json({ error: "Se esperaba un array de mediciones" });
  }
  if (mediciones.length === 0) {
    return res.status(200).json({ accepted: [] });
  }

  try {
    const col = db.collection("mediciones");
    const batch = db.batch();
    const accepted = [];
    let skipped = 0;

    const toNum = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : undefined;
    };

    for (const med of mediciones) {
      try {
        const { lat, lon } = getLatLon(med);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          skipped++; continue;
        }

        const tsSec = getTimestampSeconds(med);
        const fechaHora = (med.fechaHora ?? "").toString();

        // ===== WHITELIST ESTRICTA =====
        const data = {};

        const co   = toNum(med.co);
        const co2  = toNum(med.co2);
        const nh3  = toNum(med.nh3);
        const no2  = toNum(med.no2);
        const pm10 = toNum(med.pm10);
        const pm25 = toNum(med.pm25);
        const tvoc = toNum(med.tvoc);

        if (co   !== undefined) data.co = co;
        if (co2  !== undefined) data.co2 = co2;
        if (nh3  !== undefined) data.nh3 = nh3;
        if (no2  !== undefined) data.no2 = no2;
        if (pm10 !== undefined) data.pm10 = pm10;
        if (pm25 !== undefined) data.pm25 = pm25;
        if (tvoc !== undefined) data.tvoc = tvoc;

        data.fechaHora = fechaHora; // string
        data.latitud   = lat;       // número
        data.longitud  = lon;       // número
        data.position  = new admin.firestore.GeoPoint(lat, lon);          // GeoPoint
        data.geohash   = geofire.geohashForLocation([lat, lon]);          // string
        data.timestamp = tsSec;                                           // número (segundos)

        // ID del doc (para Firestore). Para ACK devolvemos el original sin tocar.
        const idArchivoOriginal = med.idArchivo && med.idArchivo.toString();
        const docId = idArchivoOriginal ? sanitizeId(idArchivoOriginal)
                                        : `esp32_${Date.now()}`;
        batch.set(col.doc(docId), data, { merge: false });
        accepted.push(idArchivoOriginal || docId);
      } catch (e) {
        skipped++; console.error("skip item:", e?.message || e);
      }
    }

    if (accepted.length === 0) {
      return res.status(200).json({ accepted: [], skipped });
    }

    await batch.commit();
    console.log(`POST /mediciones => grabados=${accepted.length}, skipped=${skipped}`);
    return res.status(200).json({ accepted, skipped });
  } catch (err) {
    console.error("❌ Error /mediciones:", err?.stack || err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ====== START ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server en puerto ${PORT}`));
