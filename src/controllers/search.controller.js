import { performSearchLogic } from "../services/orchestor/search.orchestrator.js";
import { getGeoLocation } from "./aiApi.controller.js";

export default async function handleSearchStream(req, res) {
    try {
        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        const geoData = await getGeoLocation(ip);
        
        const userQuery = req.query.query;
        const userId = req.user?.uid;

        if (!userQuery || !userId) {
            return res.status(400).json({ error: "Missing query or userId" });
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.flushHeaders();

        function sendEvent(data) {
            // Verificamos que la conexión no se haya cerrado antes de escribir
            if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        }

        sendEvent({ status: `Buscando en Google Shopping para: ${userQuery}...` });
        
        // DELEGACIÓN: Llama al orquestador con los parámetros de la web
        const searchResult = await performSearchLogic({
            userId,
            query: userQuery,
            minPrice: Number(req.query.minPrice),
            maxPrice: Number(req.query.maxPrice),
            countryCode: geoData.countryCode.toLowerCase(),
            languageCode: (geoData.countryCode.toLowerCase() === "ar" || geoData.countryCode.toLowerCase() === "es") ? "es" : "en",
            currency: geoData.currency,
        });

        sendEvent({ status: "Completado", result: searchResult });

    } catch (err) {
        console.error("Error en el flujo de búsqueda:", err.message);
        // Enviamos el error a través del stream si es posible
        if (res && !res.headersSent) {
            // Si las cabeceras no se han enviado, podemos enviar un error HTTP
            res.status(500).json({ status: "Error en búsqueda", error: err.message });
        } else if (res && !res.writableEnded) {
            // Si el stream ya empezó, enviamos el error como un evento
            res.write(`data: ${JSON.stringify({ status: "Error en búsqueda", error: err.message })}\n\n`);
        }
    } finally {
        if (res && !res.writableEnded) {
            res.end();
        }
    }
}

