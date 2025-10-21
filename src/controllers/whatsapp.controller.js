import { getBestRecommendationFromGemini } from '../services/search-service/geminiService.js';
import { fetchGoogleShoppingResults } from '../services/search-service/googleSopphing.js';
import logicFusion from './logis.controller.js';
import axios from 'axios';

// --- Tus variables de entorno ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// --- GESTIÓN DE ESTADO DE CONVERSACIÓN ---
const conversationState = new Map();

// --- FUNCIONES AUXILIARES DE ENVÍO ---

function normalizePhoneNumber(phone) {
  if (phone.startsWith('549') && phone.length === 13) {
    return '54' + phone.substring(3);
  }
  return phone;
}

async function sendWhatsAppRequest(requestBody) {
  const recipientNumber = normalizePhoneNumber(requestBody.to);
  const finalBody = { ...requestBody, to: recipientNumber };
  try {
    await axios.post(WHATSAPP_API_URL, finalBody, {
      headers: { 
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("❌ Error al enviar mensaje de WhatsApp:", error.response?.data || error.message);
  }
}

function sendTextMessage(to, text) {
  return sendWhatsAppRequest({ to, type: "text", text: { body: text }, messaging_product: "whatsapp" });
}

function sendImageMessage(to, imageUrl, caption = '') {
  return sendWhatsAppRequest({ to, type: "image", image: { link: imageUrl, caption }, messaging_product: "whatsapp" });
}

// ✅ NUEVO: Función para enviar una lista interactiva
function sendListMessage(to, headerText, bodyText, buttonText, sections) {
  return sendWhatsAppRequest({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: headerText },
      body: { text: bodyText },
      action: { button: buttonText, sections },
    },
    messaging_product: "whatsapp"
  });
}

// ✅ NUEVO: Función para enviar botones de respuesta
function sendReplyButtonsMessage(to, bodyText, buttons) {
  return sendWhatsAppRequest({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: { buttons },
    },
    messaging_product: "whatsapp"
  });
}

/**
 * Procesa la lógica de búsqueda y envía una lista interactiva.
 */
async function executeSearch(userPhone, userQuery) {
  try {
    await sendTextMessage(userPhone, `¡Entendido! Dame un momento mientras busco "${userQuery}"... 🕵️‍♂️`);
    const { products: shoppingResults } = await fetchGoogleShoppingResults(null, userQuery, 'ar', 'es', 'ARS');
    if (!shoppingResults || shoppingResults.length === 0) {
      await sendTextMessage(userPhone, "Lo siento, no encontré productos para tu búsqueda.");
      return;
    }

    await sendTextMessage(userPhone, "Encontré varios productos. Ahora, mi IA los está analizando... 🧠");
    const aiAnalysis = await getBestRecommendationFromGemini(userQuery, shoppingResults);
    const productosRecomendados = logicFusion(shoppingResults, aiAnalysis);

    // Guardamos los resultados en el estado de la conversación para usarlos después
    conversationState.set(userPhone, { state: 'AWAITING_PRODUCT_SELECTION', results: productosRecomendados });

    // Preparamos las filas para el mensaje de lista
    const rows = productosRecomendados.slice(0, 10).map(prod => ({ // La lista solo puede tener 10 items
      id: `select_product:${prod.product_id}`,
      title: prod.title.substring(0, 24),
      description: `Precio: ${prod.price}`.substring(0, 72)
    }));

    await sendListMessage(
      userPhone,
      `Análisis para "${userQuery}"`,
      `¡Listo! Mi recomendación principal es:\n\n${aiAnalysis.recomendacion_final}\n\nPara ver más detalles, selecciona una de las mejores opciones de la lista de abajo.`,
      "Ver Opciones",
      [{ title: "Productos Recomendados", rows }]
    );

  } catch (error) {
    console.error("Error procesando la búsqueda de WhatsApp:", error);
    await sendTextMessage(userPhone, "Lo siento, ocurrió un error inesperado al procesar tu búsqueda.");
  }
}

/**
 * Controlador principal para el webhook de WhatsApp, ahora con lógica interactiva.
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(200);
  res.sendStatus(200); // Responde inmediatamente a Meta

  const userPhone = message.from;
  const currentStateData = conversationState.get(userPhone) || {};
  const { state, results } = currentStateData;

  // --- 1. MANEJO DE RESPUESTAS INTERACTIVAS ---
  if (message.type === 'interactive') {
    const replyId = message.interactive.list_reply?.id || message.interactive.button_reply?.id;
    if (!replyId) return;

    const [action, payload] = replyId.split(':');
    const product = results?.find(p => p.product_id === payload);
    if (!product) return;

    if (action === 'select_product') {
      const buttons = [
        { type: 'reply', reply: { id: `show_details:${payload}`, title: 'Pros y Contras' } },
        { type: 'reply', reply: { id: `show_stores:${payload}`, title: 'Opciones de Compra' } },
        { type: 'reply', reply: { id: `show_images:${payload}`, title: 'Ver Imágenes' } },
      ];
      await sendReplyButtonsMessage(userPhone, `Seleccionaste: *${product.title}*.\n\n¿Qué te gustaría ver?`, buttons);
    } 
    else if (action === 'show_details') {
      let detailsText = `*Análisis para ${product.title}*:\n\n`;
      detailsText += "*✅ PROS:*\n" + (product.pros?.map(p => `- ${p}`).join('\n') || "No disponibles");
      detailsText += "\n\n*❌ CONTRAS:*\n" + (product.contras?.map(c => `- ${c}`).join('\n') || "No disponibles");
      await sendTextMessage(userPhone, detailsText);
    } 
    else if (action === 'show_stores') {
      let storesText = `*Tiendas para ${product.title}:*\n\n`;
      product.immersive_details?.stores?.forEach(store => {
        storesText += `*${store.name}* - ${store.price}\n${store.link}\n\n`;
      });
      await sendTextMessage(userPhone, storesText || "No encontré opciones de compra.");
    } 
    else if (action === 'show_images') {
      await sendTextMessage(userPhone, `Aquí tienes las imágenes para *${product.title}*:`);
      for (const img of (product.thumbnails || [product.thumbnail]).slice(0, 4)) {
        if(img) await sendImageMessage(userPhone, img);
      }
    }
    return;
  }

  // --- 2. MANEJO DE MENSAJES DE TEXTO ---
  if (message.type === 'text') {
    const userQuery = message.text.body.toLowerCase();

    if (['hola', 'hey', 'buenas'].includes(userQuery)) {
      conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
      await sendTextMessage(userPhone, "¡Hola! 👋 Soy tu asistente de compras. ¿Qué producto te gustaría que analice por ti?");
    } else {
      conversationState.set(userPhone, { state: 'SEARCHING' });
      executeSearch(userPhone, message.text.body); // Se ejecuta en segundo plano
    }
  }
}

/**
 * Verificación del Webhook.
 */
export function verifyWhatsAppWebhook(req, res) {
  // ... (código sin cambios)
}

