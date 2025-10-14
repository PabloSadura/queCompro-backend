import {saveSearchToFirebase} from "../services/search-service/firebaseService.js";
import { fetchGoogleShoppingResults } from "../services/search-service/googleSopphing.js";
import { getBestRecommendationFromGemini } from "../services/search-service/geminiService.js";
import { getGeoLocation } from "./aiApi.controller.js";
import logicFusion from "./logis.controller.js";



export default async function handleSearchStream(req, res) {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const geoData = await getGeoLocation(ip);
    const countryCode = geoData.countryCode.toLowerCase();
    const languageCode = (countryCode === "ar" || countryCode === "es") ? "es" : "en";
    const currency = geoData.currency;
    const userQuery = req.query.query;
    const minPrice = Number(req.query.minPrice);
    const maxPrice = Number(req.query.maxPrice);
    const userId = req.user?.uid;

    if (!userQuery || !userId) {
        return res.status(400).json({ error: "Missing query or userId" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    function sendEvent(data) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    try {
        // 1. Buscar en Google Shopping
        sendEvent({ status: `Buscando en Google Shopping para: ${userQuery}...` });
        // Asumo que esta función devuelve { products, totalResults } como discutimos
        const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(userId, userQuery, countryCode, languageCode, currency, minPrice, maxPrice);
        
        if (!shoppingResults || shoppingResults.length === 0) {
            sendEvent({ error: "No se encontraron productos en Google Shopping." });
            return res.end();
        }

        // 2. Analizar con Gemini para obtener la mejor recomendación
        sendEvent({ status: `Analizando ${totalResults} resultados con Gemini u OpenAI...`});
        const geminiAnalysis  = await getBestRecommendationFromGemini(userQuery, shoppingResults);
        
        if (!geminiAnalysis || !geminiAnalysis.productos_analisis) {
            sendEvent({ error: "No se pudo obtener un análisis válido de Gemini." });
            return res.end();
        }
        
        // Obtenemos los productos base recomendados por la IA
        const productosRecomendadosBase  = logicFusion(shoppingResults, geminiAnalysis);

        // 3. Estructura final y guardado (con los productos SIN enriquecer)
        const finalRecommendation = {
            recomendacion_final: geminiAnalysis.recomendacion_final,
            // ✅ AHORA USAMOS DIRECTAMENTE los productos recomendados base
            productos: productosRecomendadosBase,
            total_results: totalResults,
        };
        sendEvent({ status: "Guardando búsqueda y recomendación..." });
       
         // 4. Primero, guardamos en Firebase y esperamos a que nos devuelva el ID de la búsqueda.
           const { id: searchId, createdAt } = await saveSearchToFirebase(userQuery, userId, finalRecommendation);



        // . Finalmente, enviamos el evento 'Completado' con el objeto que contiene el ID.
        sendEvent({ status: "Completado", result: finalRecommendation, id: searchId, createdAt: createdAt });

        
    } catch (err) {
        console.error("Error en el flujo de búsqueda:", err);
        sendEvent({ status: "Error en búsqueda", error: err.message });
    } finally {
        res.end();
    }
}
