import {saveSearchToFirebase} from "../services/search-service/firebaseService.service.js";
import { fetchGoogleShoppingResults } from "../services/search-service/googleSopphing.service.js";
import { getBestRecommendationFromGemini } from "../services/search-service/geminiService.service.js";
import { getGeoLocation } from "./aiApi.controller.js";
import logicFusion from "./logis.controller.js";

export default async function handleSearchStream(req, res) {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const geoData = await getGeoLocation(ip);
    const countryCode= 'ar'
    // const countryCode = geoData.countryCode.toLowerCase();
    const languageCode = (countryCode === "ar" || countryCode === "es") ? "es" : "en";
    const currency = 'ARS';
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
            sendEvent({ error: "No se encontraron productos en Google Shopping. 🕵️‍♂️" });
            return res.end();
        }
        sendEvent({ status: `Analizando ${totalResults} resultados con IA ✨` });
        let geminiAnalysis;
        let analysisTimeout;
        // 2. Analizar con Gemini para obtener la mejor recomendacióntry {
            // Inicia un temporizador que se ejecutará después de 30 segundos
        try{   
             analysisTimeout = setTimeout(() => {
                sendEvent({ status: "El análisis está tomando un poco más de lo esperado. Seguimos trabajando en ello. ⏱️" });
            }, 30000); // 30 segundos

            // Llama a la función de análisis
            geminiAnalysis = await getBestRecommendationFromGemini(userQuery, shoppingResults);

        } finally {
            clearTimeout(analysisTimeout);
        }

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
        sendEvent({ status: "Guardando búsqueda y recomendación. 💾" });
       
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