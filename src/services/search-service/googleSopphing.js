import { getJson } from "serpapi";
import client from "../../config/redis.js";
import dotenv from 'dotenv';
dotenv.config(); // Cargar variables de entorno

const CACHE_EXPIRATION_TIME = 3600; // 1 hora en segundos
const RATING_FILTER_TBS = "mr:1,rt:4"; 

/**
 * Busca productos en Google Shopping.
 * @param {string} userId - El ID del usuario.
 * @param {string} userQuery - La consulta del usuario.
 * @param {string} countryCode - Código de país.
 * @param {string} languageCode - Código de idioma.
 * @param {string} currency - Moneda.
 * @param {number} [minPrice] - Precio mínimo opcional.
 * @param {number} [maxPrice] - Precio máximo opcional.
 * @returns {Promise<{products: Array<object>, totalResults: number}>} Objeto con la lista de productos y el total de resultados.
 */
export async function fetchGoogleShoppingResults(userId, userQuery, countryCode, languageCode, currency, minPrice, maxPrice) {
    if (!userQuery) throw new Error("La consulta no puede estar vacía.");

    const cacheKey = `serpapi:shopping:${userQuery}:${countryCode}:${languageCode}:${currency}:${minPrice}:${maxPrice}`;
    try {
        const cachedData = await client.get(cacheKey);
        if (cachedData) {
            console.log("✅ Usando datos de caché para:", userQuery);
            return JSON.parse(cachedData);
        }
    } catch (err) {
        console.error("❌ Error al acceder a Redis, procediendo sin caché:", err);
    }

    const params = {
        engine: "google_shopping",
        q: userQuery,
        gl: countryCode || 'ar',
        hl: languageCode || 'es',
        currency: currency || 'ARS',
        num: 20,
        tbs: RATING_FILTER_TBS,
        api_key: process.env.SERPAPI_KEY1,
    };
    if (minPrice && !isNaN(minPrice)) params.min_price = minPrice;
    if (maxPrice && !isNaN(maxPrice)) params.max_price = maxPrice;
   
    return new Promise((resolve, reject) => {
        getJson(params, (data) => {
            if (data.error) {
                return reject(new Error(`SerpApi Google Shopping Error: ${data.error} (Query: ${userQuery}), Params: ${JSON.stringify(params)}`));
            }
            
            const results = data.shopping_results || [];
            // Si no viene total_results, usamos el largo de los resultados obtenidos como fallback
            const total_results = data.search_information?.total_results || results.length;

            // ✅ CAMBIO 1: Crear un único objeto para devolver
            const dataToReturn = {
                products: results,
                totalResults: total_results
            };

            // ✅ CAMBIO 2: Guardar el objeto completo en la caché
            // Usamos un try/catch por si Redis falla, para que no detenga el flujo
            try {
                client.set(cacheKey, JSON.stringify(dataToReturn), { EX: CACHE_EXPIRATION_TIME });
            } catch (cacheErr) {
                console.error("❌ Error al guardar en Redis:", cacheErr);
            }

            // ✅ CAMBIO 3: Resolver la promesa con el objeto completo
            resolve(dataToReturn);
        });
    });
}
