// index.js
const express = require("express");
const admin = require("firebase-admin");
const geofire = require("geofire-common");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb", strict: true, type: "application/json" }));

// --- Credenciales desde env (Render/Heroku) ---
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

// --- Helpers ---
const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
};
const nonEmpty = (s, def) => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : def;
};
const sanitizeId = (s) => String(s).replace(/[\/\\#?&\s]/g, "_").slice(0, 200);
async function commitInChunks(ops, chunkSize = 500) {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const slice = ops.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const { ref, data } of slice) batch.set(ref, data, { merge: true });
    await batch.commit();
  }
}

// Lee lat/lon sin importar el nombre del campo
function getLatLon(med) {
  const lat = Number.isFinite(num(med.lat)) ? num(med.lat) : num(med.latitud);
  const lon = Number.isFinite(num(med.lng)) ? num(med.lng) : num(med.longitud);
  return { lat, lon };
}
// Lee ts en segundos o milisegundos y normaliza a Timestamp
function getTs(med) {
  let t = Number.isFinite(num(med.ts)) ? num(med.ts) : num(med.timestamp);
  if (!Number.isFinite(t) || t <= 0) return admin.firestore.FieldValue.serverTimestamp();
  // si parece milisegundos, convierto a segundos
  if (t > 2_000_000_000) t = Math.round(t / 1000);
  return admin.firestore.Timestamp.fromSeconds(t);
}
// Lee id de dispositivo sin importar el campo
function getDevice(med) {
  return nonEmpty(med.device, nonEmpty(med.sensorId, "esp32"));
}

// --- Salud ---
app.get("/health", (_req, res) =>
  res.json({ ok: true, project: serviceAccount.project_id, time: new Date().toISOString() })
);

// --- Endpoint principal ---
app.post("/mediciones", async (req, res) => {
  const mediciones = req.body;
  if (!Array.isArray(mediciones)) return res.status(400).json({ error: "Se esperaba un array de mediciones" });
  if (mediciones.length === 0) return res.status(200).json({ accepted: [] });

  try {
    const col = db.collection("mediciones");
    const ops = [];
    const accepted = [];
    let skipped = 0;

    // helpers locales
    const toNum = (x) => {
      const n = Number(x);
      return Number.isFinite(n) ? n : NaN;
    };
    const readLatLon = (m) => {
      const lat = Number.isFinite(toNum(m.lat)) ? toNum(m.lat) : toNum(m.latitud);
      const lon = Number.isFinite(toNum(m.lng)) ? toNum(m.lng)
                : Number.isFinite(toNum(m.lon)) ? toNum(m.lon)
                : toNum(m.longitud);
      return { lat, lon };
    };
    const readTs = (m) => {
      let t = Number.isFinite(toNum(m.ts)) ? toNum(m.ts) : toNum(m.timestamp);
      if (!Number.isFinite(t) || t <= 0) return null;
      if (t > 2_000_000_000) t = Math.round(t / 1000); // ms -> s
      return admin.firestore.Timestamp.fromSeconds(t);
    };
    const readDev = (m) => (m.device ?? m.sensorId ?? "esp32").toString();

    for (const med of mediciones) {
      try {
        const { lat, lon } = readLatLon(med);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          skipped++; console.warn("skip: coords inválidas", med.lat, med.lng, med.latitud, med.longitud); continue;
        }
        const ts = readTs(med) ?? admin.firestore.FieldValue.serverTimestamp();
        const device = readDev(med);

        const idArchivoOriginal = med.idArchivo && med.idArchivo.toString(); // EXACTO para que el ESP lo borre
        const docId = idArchivoOriginal ? sanitizeId(idArchivoOriginal) : `${sanitizeId(device)}_${Date.now()}`;

        const data = {
          ...med,
          device,
          latitud: lat,   // dejo también nombres “largos” por compat
          longitud: lon,
          position: new admin.firestore.GeoPoint(lat, lon),
          geohash: geofire.geohashForLocation([lat, lon]),
          timestamp: ts,
          docId
        };

        ops.push({ ref: col.doc(docId), data });
        accepted.push(idArchivoOriginal || docId);
      } catch (e) {
        skipped++; console.error("skip: error procesando item:", e?.message);
      }
    }

    if (ops.length === 0) return res.status(200).json({ accepted: [], skipped });

    await commitInChunks(ops, 500);
    return res.status(200).json({ accepted, skipped });
  } catch (err) {
    console.error("❌ Error /mediciones:", err?.stack || err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});


// --- Start ---
const PORT = process.env.PORT || 3000;
app.set("trust proxy", true);
app.listen(PORT, () => console.log(`🚀 Server en puerto ${PORT}`));
