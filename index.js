// index.js
const express = require("express");
const admin = require("firebase-admin");
const geofire = require("geofire-common");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" })); // por tandas grandes

// --- Credenciales desde env (Render) ---
const rawCreds = process.env.GOOGLE_CREDENTIALS;
if (!rawCreds) {
  console.error("❌ Falta GOOGLE_CREDENTIALS");
  process.exit(1);
}
const fixedCreds = rawCreds
  .replace(/\r\n/g, "\\n")
  .replace(/\r/g, "\\n")
  .replace(/\n/g, "\\n");
const serviceAccount = JSON.parse(fixedCreds);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
console.log("✅ Firebase inicializado:", serviceAccount.project_id);

// --- Helpers ---
const sanitizeId = s => String(s).replace(/[\/\\#?&\s]/g, "_");
const toNum = x => {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
};
async function commitInChunks(ops, chunkSize = 500) {
  for (let i = 0; i < ops.length; i += chunkSize) {
    const slice = ops.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const { ref, data } of slice) batch.set(ref, data, { merge: true });
    await batch.commit();
  }
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

    for (const med of mediciones) {
      const lat = toNum(med.latitud);
      const lon = toNum(med.longitud);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        console.warn("⚠️ Coordenadas inválidas:", med.latitud, med.longitud);
        continue; // salta esta medición
      }

      // Geo
      const position = new admin.firestore.GeoPoint(lat, lon);
      const geohash = geofire.geohashForLocation([lat, lon]);

      // Timestamp (ESP manda epoch segundos)
      const tsSec = toNum(med.timestamp);
      const ts =
        Number.isFinite(tsSec) && tsSec > 0
          ? admin.firestore.Timestamp.fromSeconds(tsSec)
          : admin.firestore.FieldValue.serverTimestamp(); // fallback

      // DocID determinístico (idempotencia)
      const sensorId = med.sensorId ? String(med.sensorId) : "sensorX";
      const idArchivo = med.idArchivo ? sanitizeId(med.idArchivo) : null;
      const docId = idArchivo || `${sanitizeId(sensorId)}_${Number.isFinite(tsSec) ? tsSec : Date.now()}`;

      const ref = col.doc(docId);
      const data = {
        ...med,
        sensorId,
        latitud: lat,
        longitud: lon,
        position,
        geohash,
        timestamp: ts, // tipo Timestamp nativo
        docId,
      };

      ops.push({ ref, data });
      accepted.push(idArchivo || docId);
    }

    if (ops.length === 0) return res.status(200).json({ accepted: [] });

    await commitInChunks(ops, 500);
    return res.status(200).json({ accepted });
  } catch (err) {
    console.error("❌ Error al guardar mediciones:", err?.message);
    console.error(err?.stack);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// --- Start ---
const PORT = process.env.PORT || 3000;
app.set("trust proxy", true);
app.listen(PORT, () => console.log(`🚀 Server en puerto ${PORT}`));
