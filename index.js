const express = require("express");
const admin = require("firebase-admin");
const geofire = require("geofire-common");

const app = express();
// 🔹 subo el límite por si mandás tandas grandes
app.use(express.json({ limit: "2mb" }));

// 🔧 Carga segura de credenciales (como ya tenías)
const rawCreds = process.env.GOOGLE_CREDENTIALS;
const fixedCreds = rawCreds
  .replace(/\r\n/g, "\\n")
  .replace(/\r/g, "\\n")
  .replace(/\n/g, "\\n");
const serviceAccount = JSON.parse(fixedCreds);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
console.log("✅ Firebase inicializado correctamente con proyecto:", serviceAccount.project_id);
const db = admin.firestore();

// 🔸 helper para IDs seguros
function sanitizeId(s) {
  return String(s).replace(/[\/\\#?&\s]/g, "_");
}

// 🔄 reemplazar TODO tu handler por este:
app.post("/mediciones", async (req, res) => {
  const mediciones = req.body;
  if (!Array.isArray(mediciones)) {
    return res.status(400).json({ error: "Se esperaba un array de mediciones" });
  }
  if (mediciones.length === 0) {
    return res.status(200).json({ accepted: [] });
  }

  try {
    const coleccion = db.collection("mediciones");
    const accepted = [];

    // Firestore: máx 500 operaciones por batch
    let batch = db.batch();
    let pending = 0;

    const commitBatch = async () => {
      if (pending > 0) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    };

    for (const medicion of mediciones) {
      const lat = Number(medicion.latitud);
      const lon = Number(medicion.longitud);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        console.warn("⚠️ Coordenadas inválidas:", medicion.latitud, medicion.longitud);
        continue;
      }

      const position = new admin.firestore.GeoPoint(lat, lon);
      const geohash = geofire.geohashForLocation([lat, lon]);

      const tsSec = Number(medicion.timestamp); // tu ESP manda epoch en segundos
      const ts = Number.isFinite(tsSec) && tsSec > 0
        ? admin.firestore.Timestamp.fromSeconds(tsSec)
        : admin.firestore.FieldValue.serverTimestamp(); // fallback

      const sensorId  = medicion.sensorId ? String(medicion.sensorId) : "sensorX";
      const idArchivo = medicion.idArchivo ? sanitizeId(medicion.idArchivo) : null;

      // ✅ docId determinístico (idempotencia)
      const docId = idArchivo || `${sanitizeId(sensorId)}_${Number.isFinite(tsSec) ? tsSec : Date.now()}`;
      const ref = coleccion.doc(docId);

      batch.set(ref, {
        ...medicion,
        sensorId,
        latitud: lat,
        longitud: lon,
        position,
        geohash,
        timestamp: ts,  // Timestamp nativo
        docId,
      }, { merge: true });

      accepted.push(idArchivo || docId);
      pending++;

      if (pending >= 500) await commitBatch();
    }

    await commitBatch();
    return res.status(200).json({ accepted }); // 🔁 el ESP borra por esto
  } catch (err) {
    console.error("❌ Error al guardar mediciones:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
