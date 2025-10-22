import { performSearchLogic as runSearchAndRecommendation} from './search.orchestrator.js';
import { sendTextMessage, sendListMessage } from '../search-service/whatsapp.service.js';

/**
 * Orquesta el flujo completo de una búsqueda para un usuario de WhatsApp.
 * @param {string} userPhone - El número de teléfono del usuario.
 * @param {object} searchData - Contiene query, userId, minPrice, maxPrice.
 * @param {Map} conversationState - El mapa de estado de la conversación.
 */
export async function executeWhatsAppSearch(userPhone, searchData, conversationState) {
  let thinkingTimeout = null;
  try {
    const { query, minPrice, maxPrice } = searchData;
    let searchingText = `¡Entendido! Buscando "${query}"`;
    if(maxPrice) searchingText += ` hasta $${maxPrice}`;
    if(minPrice) searchingText += ` desde $${minPrice}`;
    searchingText += `... 🕵️‍♂️`;
    
    await sendTextMessage(userPhone, searchingText);

    thinkingTimeout = setTimeout(() => {
      sendTextMessage(userPhone, "El análisis está tardando un poco más de lo normal, pero sigo trabajando en ello... 🤓");
    }, 20000);

    // DELEGACIÓN: Llama al orquestador principal, pero pasa parámetros fijos
    // para la geolocalización, ya que no los tenemos en WhatsApp.
    const searchResult = await runSearchAndRecommendation({
      ...searchData,
      countryCode: 'ar',
      languageCode: 'es',
      currency: 'ARS'
    });
    
    
    // Guarda el resultado en el estado de la conversación
    conversationState.set(userPhone, { 
      state: 'AWAITING_PRODUCT_SELECTION', 
      results: searchResult.productos, 
      collectionId: searchResult.id 
    });
    
    clearTimeout(thinkingTimeout);
    
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

