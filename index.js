const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// 🚨 Lee la clave desde la variable de entorno GOOGLE_CREDENTIALS
const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ✅ Endpoint para recibir múltiples mediciones
app.post("/mediciones", async (req, res) => {
    console.log("🔎 Cuerpo recibido:", req.body); // <-- AGREGALO

  const mediciones = req.body;

  if (!Array.isArray(mediciones)) {
    return res.status(400).send("Se esperaba un array de mediciones");
  }

  try {
    const batch = db.batch();
    const coleccion = db.collection("mediciones");

    mediciones.forEach((medicion) => {
      const docRef = coleccion.doc(); // ID aleatorio
      batch.set(docRef, medicion);
    });

    await batch.commit();
    res.status(200).send("✅ Mediciones guardadas correctamente");
  } catch (err) {
    console.error("❌ Error al guardar mediciones:", err);
    res.status(500).send("Error interno del servidor");
  }
});

// 🚀 Arranca el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
