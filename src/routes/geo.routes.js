import express from "express";
import geoip from "geoip-lite";

const router = express.Router();

router.get("/resolve", (req, res) => {
  const { lat, lon } = req.query;

  let countryCode = "US";
  let currency = "USD";

  // Si viene lat/lon, podrías usar un servicio externo (ej: Google Geocoding API)
  // Para simplificar, usamos geoip por IP:
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const geo = geoip.lookup(ip);

  if (geo && geo.country) {
    countryCode = geo.country;
  }

  const currencyMap = { AR: "ARS", US: "USD", ES: "EUR", BR: "BRL", MX: "MXN" };
  currency = currencyMap[countryCode] || "USD";

  res.json({ countryCode, currency });
});

export default router;
