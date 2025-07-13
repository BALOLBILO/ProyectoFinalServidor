const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// ✅ Corrige los saltos de línea en la clave privada
const serviceAccount = JSON.parse(
  process.env.GOOGLE_CREDENTIALS.replace(/\\n/g, '\n')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
      batch.set(docRef, {
        ...medicion,
        timestamp: admin.firestore.FieldValue.serverTimestamp(), // 🚀 agrega el timestamp
      });
    });

    await batch.commit();
    res.status(200).send("✅ Mediciones guardadas correctamente con timestamp");
  } catch (err) {
    console.error("❌ Error al guardar mediciones:", err);
    res.status(500).send("Error interno del servidor");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
