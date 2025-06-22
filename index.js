const express = require('express');
const admin = require('firebase-admin');
const app = express();
app.use(express.json());

// 🔐 Ruta al archivo de clave privada de Firebase
const serviceAccount = require('./clave.json');

// 🔥 Inicializar Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// 📥 Ruta POST para recibir datos del ESP32
app.post('/mediciones', async (req, res) => {
  try {
    const datos = req.body;
    datos.timestamp = new Date(); // Agrega el timestamp si no lo manda el ESP32

    await db.collection('mediciones').add(datos);
    res.status(200).send('Medición guardada');
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).send('Error al guardar la medición');
  }
});

// ✅ Escuchar peticiones
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en http://localhost:${PORT}`);
});
