import { executeLocalAnalysisSearch, executeAdvancedAIAnalysis } from '../services/orchestor/whatsapp.orchestrator.js';
import { getEnrichedProductDetails } from '../services/search-service/productDetail.service.js';
import { sendTextMessage, sendImageMessage, sendReplyButtonsMessage, sendListMessage } from '../services/search-service/whatsapp.service.js';

// --- GESTIÓN DE ESTADO DE CONVERSACIÓN ---
const conversationState = new Map();

// --- FUNCIONES AUXILIARES ---

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
  const reply = message.interactive.list_reply || message.interactive.button_reply; 
  if (!reply || !reply.id) return;

  const replyId = reply.id;
  const [action, payload] = replyId.split(':');

  const setClosingState = async () => {
    const buttons = [
        { type: 'reply', reply: { id: `post_action:new_search`, title: 'Buscar algo más 🔎' } },
        { type: 'reply', reply: { id: `post_action:end`, title: 'No, gracias 👋' } },
    ];
    await sendReplyButtonsMessage(userPhone, "¿Puedo ayudarte en algo más?", buttons.slice(0,3));
    conversationState.set(userPhone, { ...currentStateData, state: 'AWAITING_POST_DETAIL_ACTION' });
  };

  // --- Manejo de Acciones Interactivas ---

  // PASO 2: Respuesta a la selección de categoría
  if (state === 'AWAITING_CATEGORY' && action === 'select_category') {
      const category = payload;
      const categoryTitle = reply.title;
      conversationState.set(userPhone, {
          state: 'AWAITING_BRAND', // PASO 3
          data: { category: category, userId: userPhone }
      });
      await sendTextMessage(userPhone, `¡Perfecto, *${categoryTitle}*! ¿Tienes alguna marca en mente? (ej: "Samsung", "LG", o escribe "ninguna")`);
      return;
  }
  // PASO 6: Respuesta a la confirmación de análisis IA
  else if (state === 'AWAITING_AI_CONFIRMATION' && action === 'ai_confirm') {
      if (payload === 'yes') {
          // Si dice SÍ, ejecutamos el análisis avanzado (PASO 7)
          executeAdvancedAIAnalysis(userPhone, currentStateData);
      } else {
          // Si dice NO, terminamos
          await sendTextMessage(userPhone, "Entendido. ¡Espero que el análisis rápido te sea útil! Si necesitas algo más, no dudes en preguntar. 😊");
          conversationState.delete(userPhone);
      }
      return;
  }
  // Selección de producto de la lista (después del análisis IA)
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
      ];
      await sendReplyButtonsMessage(userPhone, `¡Listo! Seleccionaste: *${product.title}*.\n\n¿Qué te gustaría ver?`, buttons.slice(0,3));
    } catch (error) {
       console.error("Error al obtener detalles inmersivos:", error);
       await sendTextMessage(userPhone, "Lo siento, no pude obtener los detalles completos para este producto.");
     }
  }
  // Acciones para mostrar detalles específicos
  else if (action.startsWith('show_')) {
      const product = Array.isArray(results) ? results.find(p => p.product_id == payload) : null;
      if (!product) { await sendTextMessage(userPhone, "Hubo un problema. Por favor, selecciona el producto de nuevo."); return; }

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
      await setClosingState();
  }
  // Acciones después de ver detalles
  else if (action === 'post_action') {
      if (payload === 'new_search') {
          // Reinicia el flujo al Paso 1 (Saludo)
          conversationState.set(userPhone, { state: 'GREETING', data: {} });
          handleGreeting(userPhone, userPhone);
      } else if (payload === 'end') {
          await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
          conversationState.delete(userPhone);
      }
  }
}

/**
 * Función separada para manejar el saludo e inicio de conversación (PASO 1 y 2)
 */
async function handleGreeting(userPhone, userId) {
    conversationState.set(userPhone, { state: 'AWAITING_CATEGORY', data: { userId: userId } });
    const categories = [
        { id: "celular", title: "📱 Celulares"},
        { id: "notebook", title: "💻 Notebooks"},
        { id: "televisor", title: "📺 Televisores"},
        { id: "heladera", title: "🧊 Heladeras"},
        { id: "lavarropas", title: "🧺 Lavarropas"},
        { id: "aire_acondicionado", title: "💨 Aires Ac."},
        { id: "auriculares", title: "🎧 Auriculares"},
        { id: "cocina", title: "🍳 Cocinas"},
        { id: "microondas", title: "🔥 Microondas"},
        { id: "smartwatch", title: "⌚ Smartwatches"}
    ];
    const rows = categories.map(cat => ({ id: `select_category:${cat.id}`, title: cat.title }));
    await sendTextMessage(userPhone, "¡Hola! 👋 Soy tu asistente de compras.");
    await sendListMessage(userPhone, "Elige una Categoría", "¿En qué tipo de producto estás interesado hoy?", "Categorías", [{ title: "Categorías Populares", rows }]);
}

/**
 * Controlador principal del webhook
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(200);
  res.sendStatus(200);

  const userPhone = message.from;
  const currentStateData = conversationState.get(userPhone) || { state: 'GREETING', data: { userId: userPhone } };
  const currentSearchData = currentStateData.data || { userId: userPhone };

  if (message.type === 'interactive') {
    handleInteractiveReply(userPhone, message, currentStateData);
    return;
  }

  if (message.type === 'text') {
    const userText = message.text.body;

    // Manejo del cierre explícito
    if (currentStateData.state === 'AWAITING_CLOSING' || currentStateData.state === 'AWAITING_POST_DETAIL_ACTION') {
       const negativeKeywords = ['no', 'gracias', 'nada mas', 'eso es todo', 'chau'];
        if (negativeKeywords.some(keyword => userText.toLowerCase().includes(keyword))) {
            await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
            conversationState.delete(userPhone);
            return;
        }
        // Si no es negativo, asumimos nueva búsqueda
        handleGreeting(userPhone, userPhone);
        return;
    }

    // Flujo conversacional principal guiado
    switch (currentStateData.state) {
        case 'AWAITING_CATEGORY':
             conversationState.set(userPhone, {
                state: 'AWAITING_PRODUCT_NAME',
                data: { ...currentSearchData, category: userText.toLowerCase() }
            });
            await sendTextMessage(userPhone, `¡Genial! Categoría: ${userText.toUpperCase()}. Ahora dime, ¿qué producto específico buscas?`);
            break;

        case 'AWAITING_PRODUCT_NAME':
            currentSearchData.query = userText;
            conversationState.set(userPhone, { state: 'AWAITING_BRAND', data: currentSearchData });
            await sendTextMessage(userPhone, '¡Perfecto! ¿Tienes alguna marca en mente? (ej: "Samsung", o escribe "ninguna")');
            break;

        case 'AWAITING_BRAND':
            currentSearchData.brandPreference = userText;
            conversationState.set(userPhone, { state: 'AWAITING_PRICE_RANGE', data: currentSearchData });
            await sendTextMessage(userPhone, `¡Anotado! ¿Tienes algún rango de precios? (ej: "hasta 150000", o "no")`);
            break;

        case 'AWAITING_PRICE_RANGE':
            // PASO 4: Pregunta de Precio
            const priceData = parsePriceFromText(userText.toLowerCase());
            const searchDataWithPrice = { ...currentSearchData, ...priceData };
            conversationState.set(userPhone, { state: 'SEARCHING', data: searchDataWithPrice });
            // PASO 5: Ejecutar análisis local
            executeLocalAnalysisSearch(userPhone, searchDataWithPrice, conversationState);
            break;
        
        default: // GREETING
            if (['hola', 'hey', 'buenas'].includes(userText.toLowerCase())) {
                handleGreeting(userPhone, userPhone); // PASO 1 y 2
            } else {
                // Búsqueda directa (como fallback)
                const directSearchData = { query: userText, userId: userPhone, category: 'default' };
                conversationState.set(userPhone, { state: 'SEARCHING', data: directSearchData });
                executeLocalAnalysisSearch(userPhone, directSearchData, conversationState);
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

