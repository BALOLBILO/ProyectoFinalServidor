// --- Helpers (deja num, nonEmpty y sanitizeId como ya los tienes) ---

// Acepta lat/lng o latitud/longitud → devuelve {lat, lon} numéricos
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

// Normaliza timestamp a **segundos numéricos**
function getTimestampSeconds(med) {
  const n = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v : NaN;
  };
  let t = n(med.timestamp);
  if (!Number.isFinite(t) || t <= 0) t = n(med.ts);
  if (!Number.isFinite(t) || t <= 0) t = Math.floor(Date.now() / 1000);
  // si vino en milisegundos, lo bajo a segundos
  if (t > 2_000_000_000) t = Math.round(t / 1000);
  return t;
}

// --- Endpoint principal ---
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

    for (const med of mediciones) {
      try {
        // coords obligatorias
        const { lat, lon } = getLatLon(med);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          skipped++;
          continue;
        }

        // timestamp (segundos)
        const tsSec = getTimestampSeconds(med);

        // fechaHora (string opcional)
        const fechaHora = (med.fechaHora ?? "").toString();

        // métricas (numéricas; si alguna no viene, la omitimos)
        const toNum = (v) => {
          const x = Number(v);
          return Number.isFinite(x) ? x : undefined;
        };

        const data = {};
        // === WHITELIST ESTRICTA ===
        const co      = toNum(med.co);
        const co2     = toNum(med.co2);
        const nh3     = toNum(med.nh3);
        const no2     = toNum(med.no2);
        const pm10    = toNum(med.pm10);
        const pm25    = toNum(med.pm25);
        const tvoc    = toNum(med.tvoc);

        if (co      !== undefined) data.co = co;
        if (co2     !== undefined) data.co2 = co2;
        if (nh3     !== undefined) data.nh3 = nh3;
        if (no2     !== undefined) data.no2 = no2;
        if (pm10    !== undefined) data.pm10 = pm10;
        if (pm25    !== undefined) data.pm25 = pm25;
        if (tvoc    !== undefined) data.tvoc = tvoc;

        // siempre incluimos estos
        data.fechaHora = fechaHora;                       // string (si vino vacío, queda "")
        data.latitud   = lat;                             // número
        data.longitud  = lon;                             // número
        data.position  = new admin.firestore.GeoPoint(lat, lon); // GeoPoint
        data.geohash   = geofire.geohashForLocation([lat, lon]); // string
        data.timestamp = tsSec;                           // número (segundos)

        // id para doc; ACK debe devolver el original sin tocar
        const idArchivoOriginal = med.idArchivo && med.idArchivo.toString();
        const docId = idArchivoOriginal
          ? sanitizeId(idArchivoOriginal)           // sólo para ID del doc
          : `esp32_${Date.now()}`;

        batch.set(col.doc(docId), data, { merge: false }); // sólo los campos whitelisted
        accepted.push(idArchivoOriginal || docId);         // devolver EXACTO lo que vino
      } catch (e) {
        skipped++;
        console.error("skip item:", e?.message || e);
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
