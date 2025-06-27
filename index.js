const express = require("express");
const admin = require("firebase-admin");
const serviceAccount = require("./clave.json"); // ⚠️ NO subas esto a GitHub

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🌐 API funcionando correctamente");
});

app.post("/mediciones", async (req, res) => {
  const mediciones = req.body;

  console.log("📥 Recibidas:", JSON.stringify(mediciones, null, 2));

  if (!Array.isArray(mediciones)) {
    return res.status(400).send("Se esperaba un array de mediciones");
  }

  try {
    const batch = db.batch();
    const coleccion = db.collection("mediciones");

    mediciones.forEach((medicion) => {
      const docRef = coleccion.doc();
      batch.set(docRef, medicion);
    });

    await batch.commit();
    console.log("✅ Mediciones guardadas en Firestore");
    res.status(200).send("✅ Mediciones guardadas correctamente");
  } catch (err) {
    console.error("❌ Error al guardar mediciones:", err);
    res.status(500).send("Error interno del servidor");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
