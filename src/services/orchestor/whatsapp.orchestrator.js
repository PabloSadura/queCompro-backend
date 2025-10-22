// Importamos el orquestador principal (renombrado en la importación para claridad)
import { performSearchLogic as runSearchAndRecommendation } from './search.orchestrator.js';
// Importamos los servicios de envío de WhatsApp
import { sendTextMessage, sendListMessage } from '../search-service/whatsapp.service.js';

/**
 * Orquesta el flujo completo de una búsqueda para un usuario de WhatsApp,
 * incluyendo filtros conversacionales.
 * @param {string} userPhone - El número de teléfono del usuario.
 * @param {object} searchData - Contiene query, userId, minPrice, maxPrice, usage, brandPreference, ratingFilter, featureKeyword.
 * @param {Map} conversationState - El mapa de estado de la conversación.
 */
export async function executeWhatsAppSearch(userPhone, searchData, conversationState) {
  let thinkingTimeout = null;
  try {
    const {
        query,
        userId, // Asegúrate de que el userId se pase correctamente desde el controller
        minPrice,
        maxPrice,
        usage,
        brandPreference,
        ratingFilter,
        featureKeyword
    } = searchData;

    // --- Construcción de la Consulta Enriquecida ---
    let finalQuery = query;
    if (usage) finalQuery += ` para ${usage}`;
    if (brandPreference && brandPreference.toLowerCase() !== 'ninguna') {
        finalQuery += ` ${brandPreference}`;
    }
    if (featureKeyword) finalQuery += ` ${featureKeyword}`;
    // --- Fin Construcción ---

    let searchingText = `¡Entendido! Buscando "${finalQuery}"`; // Usamos la query enriquecida
    if (maxPrice) searchingText += ` hasta $${maxPrice}`;
    if (minPrice) searchingText += ` desde $${minPrice}`;
    if (ratingFilter) searchingText += ` con buena valoración`;
    searchingText += `... 🕵️‍♂️`;
    
    await sendTextMessage(userPhone, searchingText);

    thinkingTimeout = setTimeout(() => {
      sendTextMessage(userPhone, "El análisis está tardando un poco más de lo normal, pero sigo trabajando en ello... 🤓");
    }, 20000);

    // --- DELEGACIÓN AL ORQUESTADOR PRINCIPAL ---
    // Pasamos todos los datos recolectados, incluyendo los nuevos filtros
    const searchResult = await runSearchAndRecommendation({
      query: finalQuery, // Usamos la query enriquecida
      userId,
      minPrice,
      maxPrice,
      countryCode: 'ar',
      languageCode: 'es',
      currency: 'ARS',
      ratingFilter // Pasamos el filtro de rating
    });
    // --- Fin Delegación ---
    
    clearTimeout(thinkingTimeout);
    
    // Guarda el resultado en el estado de la conversación
    conversationState.set(userPhone, { 
      state: 'AWAITING_PRODUCT_SELECTION', 
      results: searchResult.productos, 
      collectionId: searchResult.id,
      data: searchData // Guardamos los criterios originales por si acaso
    });
    
    // Formatea y envía una lista interactiva al usuario
    const rows = searchResult.productos.slice(0, 10).map(prod => ({
      id: `select_product:${prod.product_id}`,
      title: prod.title.substring(0, 24),
      description: `Precio: ${prod.price}`.substring(0, 72)
    }));

    await sendListMessage(userPhone, `Análisis para "${query}"`, `¡Listo! Mi recomendación principal es:\n\n${searchResult.recomendacion_final}\n\nSelecciona una opción para ver más detalles.`, "Ver Opciones", [{ title: "Productos Recomendados", rows }]);

  } catch (error) {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    console.error("Error en executeWhatsAppSearch:", error.message);
    await sendTextMessage(userPhone, `Lo siento, ocurrió un error inesperado durante la búsqueda: ${error.message}`);
    conversationState.delete(userPhone);
  }
}

