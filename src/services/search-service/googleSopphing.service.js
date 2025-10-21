import { getJson } from "serpapi";
import client from "../../config/redis.js";
import dotenv from 'dotenv';
dotenv.config(); // Cargar variables de entorno

const CACHE_EXPIRATION_TIME = 3600; // 1 hora en segundos
let RATING_FILTER_TBS = "mr:1,rt:4"; 

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

    if (minPrice && !isNaN(minPrice)) {
        RATING_FILTER_TBS += `,p_ord:pmin${minPrice}`; 
    }
    if (maxPrice && !isNaN(maxPrice)) {
        RATING_FILTER_TBS += `,p_ord:pmax${maxPrice}`; 
    }

    const params = {
        engine: "google_shopping",
        q: userQuery,
        gl: countryCode || 'ar',
        hl: languageCode || 'es',
        currency: currency || 'ARS',
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
            const total_results = data.search_information?.total_results || results.length;

            const dataToReturn = {
                products: results,
                totalResults: total_results
            };

            resolve(dataToReturn);
        });
    });
}
