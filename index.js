app.post("/mediciones", async (req, res) => {
  const mediciones = req.body;

  if (!Array.isArray(mediciones)) {
    return res.status(400).send("Se esperaba un array de mediciones");
  }

  try {
    const batch = db.batch();
    const coleccion = db.collection("mediciones"); // ✅ Esta es la colección principal

    mediciones.forEach((medicion) => {
      const docRef = coleccion.doc(); // crea nuevo doc con ID aleatorio
      batch.set(docRef, medicion);
    });

    await batch.commit(); // 🔥 Esto es lo que escribe realmente
    res.status(200).send("✅ Mediciones guardadas correctamente");
  } catch (err) {
    console.error("❌ Error al guardar mediciones:", err);
    res.status(500).send("Error interno del servidor");
  }
});
