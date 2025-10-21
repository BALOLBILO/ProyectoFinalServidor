const express = require("express");
const admin = require("firebase-admin");
const geofire = require("geofire-common");

const app = express();
app.use(express.json());

// 🔧 Carga segura de credenciales (funciona con o sin \n escapados)
const rawCreds = process.env.GOOGLE_CREDENTIALS;

// Normaliza: convierte saltos reales en "\n"
const fixedCreds = rawCreds
  .replace(/\r\n/g, "\\n")
  .replace(/\r/g, "\\n")
  .replace(/\n/g, "\\n");

const serviceAccount = JSON.parse(fixedCreds);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log("✅ Firebase inicializado correctamente con proyecto:", serviceAccount.project_id);

const db = admin.firestore();

app.post("/mediciones", async (req, res) => {
  const mediciones = req.body;

  if (!Array.isArray(mediciones)) {
    return res.status(400).send("Se esperaba un array de mediciones");
  }

  try {
    const batch = db.batch();
    const coleccion = db.collection("mediciones");

    mediciones.forEach((medicion) => {
      const docRef = coleccion.doc();

      const lat = medicion.latitud;
      const lon = medicion.longitud;

      const position = new admin.firestore.GeoPoint(lat, lon);
      const geohash = geofire.geohashForLocation([lat, lon]);

      batch.set(docRef, {
        ...medicion,
        position,
        geohash,
        // 👇 usamos el timestamp que llega desde el ESP32
        timestamp: medicion.timestamp,
      });
    });

    await batch.commit();
    res
      .status(200)
      .send("✅ Mediciones guardadas con geolocalización y timestamp del ESP32");
  } catch (err) {
    console.error("❌ Error al guardar mediciones:", err);
    res.status(500).send("Error interno del servidor");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
