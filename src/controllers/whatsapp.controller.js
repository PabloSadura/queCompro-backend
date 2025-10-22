// ✅ Importamos las funciones del orquestador y el servicio de detalles
import { executeWhatsAppSearch, executeAdvancedAIAnalysis } from '../services/orchestor/whatsapp.orchestrator.js';
import { getEnrichedProductDetails } from '../services/search-service/productDetail.service.js';
// ✅ Importamos todas las funciones de envío desde el servicio dedicado
import { sendTextMessage, sendImageMessage, sendReplyButtonsMessage, sendListMessage } from '../services/search-service/whatsapp.service.js';

// --- GESTIÓN DE ESTADO DE CONVERSACIÓN ---
const conversationState = new Map();

// --- LÓGICA CONVERSACIONAL (ROUTER) ---

/**
 * Parsea un texto para extraer un rango de precios.
 */
function parsePriceFromText(text) {
  const priceRegex = /(\d{1,3}(?:[.,]\d{3})*)/g;
  const numbers = (text.match(priceRegex) || []).map(n => parseInt(n.replace(/[.,]/g, '')));
  if (text.includes("entre") && numbers.length >= 2) return { minPrice: Math.min(...numbers), maxPrice: Math.max(...numbers) };
  if ((text.includes("menos de") || text.includes("hasta")) && numbers.length >= 1) return { maxPrice: numbers[0] };
  if ((text.includes("más de") || text.includes("desde")) && numbers.length >= 1) return { minPrice: numbers[0] };
  return {};
}

/**
 * Maneja las respuestas a botones y listas interactivas.
 */
async function handleInteractiveReply(userPhone, message, currentStateData) {
  const { results, collectionId, data: searchContext, state } = currentStateData;
  const replyId = message.interactive.list_reply?.id || message.interactive.button_reply?.id;
  if (!replyId) return;

  const [action, payload] = replyId.split(':');

  const setClosingState = async () => {
    // Pregunta Post-Detalles
    const buttons = [
        { type: 'reply', reply: { id: `post_action:next_option`, title: 'Ver otra opción 📄' } },
        { type: 'reply', reply: { id: `post_action:new_search`, title: 'Buscar algo más 🔎' } },
        { type: 'reply', reply: { id: `post_action:end`, title: 'No, gracias 👋' } },
    ];
    // Aseguramos que solo se envíen 3 botones como máximo
    await sendReplyButtonsMessage(userPhone, "¿Qué te pareció este producto? ¿Te gustaría ver otra opción de la lista o buscar algo diferente?", buttons.slice(0, 3));
    conversationState.set(userPhone, { ...currentStateData, state: 'AWAITING_POST_DETAIL_ACTION' });
  };

  // --- Manejo de Acciones Interactivas ---

  // Respuesta a la pregunta "¿Analizar con IA?"
  if (state === 'AWAITING_AI_CONFIRMATION' && action === 'ai_confirm') {
      if (payload === 'yes') {
          // Si dice SÍ, ejecutamos el análisis avanzado
          executeAdvancedAIAnalysis(userPhone, currentStateData);
      } else {
          // Si dice NO, terminamos o preguntamos si quiere buscar otra cosa
          await sendTextMessage(userPhone, "Entendido. Si necesitas algo más, no dudes en preguntar. 😊");
          conversationState.delete(userPhone);
      }
      return; // Importante: Salir después de manejar la confirmación
  }
  // Respuesta a la pregunta de aclaración de uso (ej: notebook)
  else if (action === 'clarify_usage') {
    searchContext.usage = payload; // Guarda el uso (ej: 'gaming')
    conversationState.set(userPhone, { state: 'AWAITING_BRAND', data: searchContext });
    await sendTextMessage(userPhone, '¡Perfecto! ¿Tienes alguna marca preferida o alguna que quieras evitar? (O escribe "ninguna")');
  }
  // Respuesta a la pregunta de filtros adicionales
  else if (action === 'add_filter') {
    if (payload === 'rating') {
      searchContext.ratingFilter = true; // Marca para añadir tbs=rt:4.5
    }
    // Si elige 'features', pedimos la característica
    if (payload === 'features') {
        conversationState.set(userPhone, { state: 'AWAITING_FEATURE_KEYWORD', data: searchContext });
        await sendTextMessage(userPhone, 'Ok, dime qué característica es importante para ti (ej: "resistente al agua", "pantalla OLED", "16GB RAM").');
    } else {
        // Si no es 'features' o elige 'buscar ahora', iniciamos la búsqueda
        conversationState.set(userPhone, { state: 'SEARCHING', data: searchContext });
        executeWhatsAppSearch(userPhone, searchContext, conversationState);
    }
  }
  // Selección de producto de la lista
  else if (action === 'select_product') {
    const product = results?.find(p => p.product_id == payload);
    if (!product) return;
    await sendTextMessage(userPhone, `Buscando detalles para *${product.title}*...`);
    try {
      const enrichedProduct = await getEnrichedProductDetails(collectionId, payload);
      if (!enrichedProduct) throw new Error("Producto no enriquecido.");
      const updatedResults = results.map(p => p.product_id == payload ? enrichedProduct : p);
      conversationState.set(userPhone, { ...currentStateData, results: updatedResults });
      const buttons = [
        { type: 'reply', reply: { id: `show_details:${payload}`, title: 'Pros y Contras' } },
        { type: 'reply', reply: { id: `show_stores:${payload}`, title: 'Opciones de Compra' } },
        { type: 'reply', reply: { id: `show_features:${payload}`, title: 'Características' } },
        { type: 'reply', reply: { id: `show_images:${payload}`, title: 'Ver Imágenes' } },
      ];
      // Mostramos los primeros 3 botones
      await sendReplyButtonsMessage(userPhone, `¡Listo! Seleccionaste: *${product.title}*.\n\n¿Qué te gustaría ver?`, buttons.slice(0, 3));
    } catch (error) {
       console.error("Error al obtener detalles inmersivos:", error);
       await sendTextMessage(userPhone, "Lo siento, no pude obtener los detalles completos para este producto.");
     }
  }
  // Acciones para mostrar detalles específicos
  else if (action.startsWith('show_')) {
      const product = Array.isArray(results) ? results.find(p => p.product_id == payload) : null;
      if (!product) { /* ... manejo si no encuentra producto ... */ return; }

      if (action === 'show_details') {
          let detailsText = `*Análisis para ${product.title}*:\n\n*✅ PROS:*\n${product.pros?.map(p => `- ${p}`).join('\n') || "No disponibles"}\n\n*❌ CONTRAS:*\n${product.contras?.map(c => `- ${c}`).join('\n') || "No disponibles"}`;
          await sendTextMessage(userPhone, detailsText);
      }
      else if (action === 'show_stores') {
          let storesText = `*Opciones de Compra para ${product.title}:*\n\n`;
          const stores = product.immersive_details?.stores;
          if (stores && Array.isArray(stores) && stores.length > 0) {
            stores.forEach((store, index) => {
              storesText += `*${index + 1}. ${store.name || 'Tienda desconocida'}*\n`;
              storesText += `   Precio: *${store.price || 'No disponible'}*\n`;
              storesText += `   Ver: ${store.link || 'No disponible'}\n\n`;
            });
          } else { storesText = "Lo siento, no encontré opciones de compra específicas."; }
          await sendTextMessage(userPhone, storesText);
      }
      else if (action === 'show_features') {
          let featuresText = `*Características de ${product.title}:*\n\n`;
          const features = product.immersive_details?.about_the_product?.features;
          if(features && Array.isArray(features) && features.length > 0) {
              features.forEach(feature => {
                  featuresText += `*${feature.title || 'Característica'}*: ${feature.value || 'No disponible'}\n`;
              });
          } else { featuresText = "Lo siento, no encontré características detalladas."; }
          await sendTextMessage(userPhone, featuresText);
      }
      else if (action === 'show_images') {
          await sendTextMessage(userPhone, `Aquí tienes las imágenes para *${product.title}*:`);
          const images = product.immersive_details?.thumbnails || [product.thumbnail];
          if (images && images.length > 0) {
            for (const img of images.slice(0, 4)) { if (img) await sendImageMessage(userPhone, img); }
          } else { await sendTextMessage(userPhone, "Lo siento, no encontré imágenes adicionales."); }
      }
      await setClosingState(); // Llama a la nueva pregunta post-detalles
  }
  // Acciones después de ver detalles
  else if (action === 'post_action') {
      if (payload === 'next_option') {
          // Lógica simplificada
          await sendTextMessage(userPhone, "Lo siento, la opción 'Ver otra opción' aún no está implementada. ¿Quieres buscar algo más?");
          conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
      } else if (payload === 'new_search') {
          conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
          await sendTextMessage(userPhone, "¿Qué otro producto te gustaría buscar?");
      } else if (payload === 'end') {
          await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
          conversationState.delete(userPhone);
      }
  }
}

/**
 * Controlador principal del webhook
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(200);
  res.sendStatus(200);

  const userPhone = message.from;
  const currentStateData = conversationState.get(userPhone) || { state: 'GREETING', data: {} };

  if (message.type === 'interactive') {
    handleInteractiveReply(userPhone, message, currentStateData);
    return;
  }

  if (message.type === 'text') {
    const userText = message.text.body.toLowerCase();
    const currentSearchData = currentStateData.data || {};

    // Manejo del cierre explícito
    if (currentStateData.state === 'AWAITING_CLOSING' || currentStateData.state === 'AWAITING_POST_DETAIL_ACTION') {
      const negativeKeywords = ['no', 'gracias', 'nada mas', 'eso es todo', 'chau'];
      if (negativeKeywords.some(keyword => userText.includes(keyword))) {
        await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
        conversationState.delete(userPhone);
        return;
      }
      // Si no es negativo, asumimos que es una nueva búsqueda
      conversationState.set(userPhone, { state: 'SEARCHING', data: { query: message.text.body, userId: userPhone } });
      executeWhatsAppSearch(userPhone, conversationState.get(userPhone).data, conversationState);
      return;
    }

    // Flujo conversacional principal
    switch (currentStateData.state) {
        case 'AWAITING_QUERY':
            const isAmbiguous = ['notebook', 'laptop', 'celular', 'smartphone', 'heladera', 'refrigerador'].includes(userText); // Ejemplo de consultas ambiguas
            if (isAmbiguous && userText.split(' ').length < 3) { // Si es ambigua y corta
                conversationState.set(userPhone, { state: 'AWAITING_CLARIFICATION', data: { query: userText, userId: userPhone } });
                const buttons = [
                    { type: 'reply', reply: { id: `clarify_usage:work`, title: 'Trabajo/Estudio 🧑‍💻' } },
                    { type: 'reply', reply: { id: `clarify_usage:gaming`, title: 'Gaming 🎮' } },
                    { type: 'reply', reply: { id: `clarify_usage:portable`, title: 'Uso General/Portátil 🎒' } },
                ];
                await sendReplyButtonsMessage(userPhone, `Entendido, buscas '${userText}'. Para darte mejores recomendaciones, ¿podrías decirme un poco más? 🤔 ¿La necesitas para algo en particular?`, buttons);
            } else {
                conversationState.set(userPhone, { state: 'AWAITING_BRAND', data: { query: message.text.body, userId: userPhone } });
                await sendTextMessage(userPhone, '¡Perfecto! ¿Tienes alguna marca preferida o alguna que quieras evitar? (O escribe "ninguna")');
            }
            break;
      
      case 'AWAITING_CLARIFICATION': // Necesitas este estado si usas la pregunta de aclaración
          // Si el usuario responde con texto en lugar de botón
          currentSearchData.usage = userText; // Asumimos que la respuesta es el uso
          conversationState.set(userPhone, { state: 'AWAITING_BRAND', data: currentSearchData });
          await sendTextMessage(userPhone, '¡Anotado! ¿Tienes alguna marca preferida o alguna que quieras evitar? (O escribe "ninguna")');
          break;
          
      case 'AWAITING_BRAND':
        if (userText.toLowerCase() !== 'ninguna') {
            currentSearchData.brandPreference = userText;
        }
        conversationState.set(userPhone, { state: 'AWAITING_PRICE_RANGE', data: currentSearchData });
        await sendTextMessage(userPhone, `¡Entendido! ¿Tienes algún rango de precios en mente? (ej: "hasta 150000", o "no")`);
        break;

      case 'AWAITING_PRICE_RANGE':
        const priceData = parsePriceFromText(userText);
        const searchDataWithPrice = { ...currentSearchData, ...priceData };
        conversationState.set(userPhone, { state: 'AWAITING_EXTRA_FILTERS', data: searchDataWithPrice });
        const filterButtons = [
            { type: 'reply', reply: { id: `add_filter:rating`, title: 'Mejor Valoración ⭐' } },
            { type: 'reply', reply: { id: `add_filter:features`, title: 'Caract. Clave ✨' } },
            { type: 'reply', reply: { id: `add_filter:search_now`, title: 'Buscar Ahora 🚀' } },
        ];
        await sendReplyButtonsMessage(userPhone, "Perfecto. Antes de buscar, ¿quieres que filtre por algo más?", filterButtons);
        break;
        
      case 'AWAITING_EXTRA_FILTERS': // Si el usuario responde con texto en lugar de botón
          if (userText.includes('valoración') || userText.includes('rating')) currentSearchData.ratingFilter = true;
          // Asumimos que si no pide filtro específico, busca ahora
          conversationState.set(userPhone, { state: 'SEARCHING', data: currentSearchData });
          executeWhatsAppSearch(userPhone, currentSearchData, conversationState);
          break;
          
      case 'AWAITING_FEATURE_KEYWORD':
          currentSearchData.featureKeyword = userText;
          conversationState.set(userPhone, { state: 'SEARCHING', data: currentSearchData });
          executeWhatsAppSearch(userPhone, currentSearchData, conversationState);
          break;

      default: // GREETING u otro estado
        if (['hola', 'hey', 'buenas'].includes(userText)) {
          conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
          await sendTextMessage(userPhone, "¡Hola! 👋 Soy tu asistente de compras. ¿Qué producto buscas hoy? _Si puedes, dame algunos detalles como marca, modelo o para qué lo usarás._ 😉");
        } else {
          // Búsqueda directa
          const directSearchData = { query: message.text.body, userId: userPhone };
          conversationState.set(userPhone, { state: 'SEARCHING', data: directSearchData });
          executeWhatsAppSearch(userPhone, directSearchData, conversationState);
        }
        break;
    }
  }
}

/**
 * Verificación del Webhook.
 */
export function verifyWhatsAppWebhook(req, res) {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

