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

/**
 * Normaliza un número de teléfono para la API de WhatsApp,
 * eliminando el '9' de los números móviles de Argentina si está presente.
 */
function normalizePhoneNumber(phone) {
  if (phone.startsWith('549') && phone.length === 13) {
    console.log(`[Phone Normalization] Removiendo el '9' del número móvil de Argentina: ${phone}`);
    return '54' + phone.substring(3);
  }
  return phone;
}

/**
 * Función base para enviar cualquier tipo de mensaje a la API de WhatsApp.
 */
async function sendWhatsAppRequest(requestBody) {
  const recipientNumber = normalizePhoneNumber(requestBody.to);
  const finalBody = { ...requestBody, to: recipientNumber };

  console.log(`[WhatsApp Send] Intentando enviar mensaje a: ${recipientNumber}`);
  
  try {
    await axios.post(WHATSAPP_API_URL, finalBody, {
      headers: { 
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[WhatsApp Send] Mensaje enviado exitosamente a ${recipientNumber}`);
  } catch (error) {
    console.error("❌ Error al enviar mensaje de WhatsApp. Respuesta de Meta:", error.response?.data || error.message);
  }
}

/**
 * Envía un mensaje de texto simple.
 */
function sendTextMessage(to, text) {
  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: text },
  });
}

/**
 * Envía una imagen con una descripción opcional.
 */
function sendImageMessage(to, imageUrl, caption = '') {
  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    to: to,
    type: "image",
    image: {
      link: imageUrl,
      caption: caption
    },
  });
}

/**
 * Procesa la lógica de búsqueda principal y envía actualizaciones.
 */
async function executeSearch(userPhone, userQuery) {
  try {
    // 1. Informa al usuario que la búsqueda ha comenzado.
    await sendTextMessage(userPhone, `¡Entendido! Dame un momento mientras busco "${userQuery}"... 🕵️‍♂️`);

    const { products: shoppingResults } = await fetchGoogleShoppingResults(null, userQuery, 'ar', 'es', 'ARS');
    if (!shoppingResults || shoppingResults.length === 0) {
      await sendTextMessage(userPhone, "Lo siento, no encontré productos para tu búsqueda. ¿Podrías intentar con otros términos?");
      return;
    }

    // 2. Informa al usuario que se está realizando el análisis de IA.
    await sendTextMessage(userPhone, "Encontré varios productos. Ahora, mi IA los está analizando para darte la mejor recomendación... 🧠");

    const aiAnalysis = await getBestRecommendationFromGemini(userQuery, shoppingResults);
    const productosRecomendados = logicFusion(shoppingResults, aiAnalysis);
    const topRecommendation = productosRecomendados.find(p => p.isRecommended);

    // 3. Envía los resultados finales.
    await sendTextMessage(userPhone, `🤖 *Análisis Completado!*\n\n*Mi recomendación principal es:* ${aiAnalysis.recomendacion_final}`);

    if (topRecommendation && topRecommendation.thumbnail) {
      await sendImageMessage(userPhone, topRecommendation.thumbnail, topRecommendation.title);
    }

    let optionsText = "Aquí tienes un resumen de las mejores opciones que encontré:\n";
    productosRecomendados.slice(0, 3).forEach((prod, index) => {
      optionsText += `\n*${index + 1}. ${prod.title}*\n`;
      optionsText += `   Precio: *${prod.price}*\n`;
      optionsText += `   Rating: ${prod.rating || 'N/A'} ⭐\n`;
      optionsText += `   Ver más: ${prod.product_link}\n`;
    });

    await sendTextMessage(userPhone, optionsText);
    await sendTextMessage(userPhone, "¿Hay algo más en lo que pueda ayudarte?");

  } catch (error) {
    console.error("Error procesando la búsqueda de WhatsApp:", error);
    await sendTextMessage(userPhone, "Lo siento, ocurrió un error inesperado al procesar tu búsqueda. Por favor, intenta de nuevo más tarde.");
  }
}

/**
 * Controlador principal para el webhook de WhatsApp, ahora con lógica conversacional.
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message || message.type !== 'text') {
    return res.sendStatus(200);
  }

  const userPhone = message.from;
  const userQuery = message.text.body.toLowerCase();

  console.log(`Mensaje recibido de ${userPhone}: "${userQuery}"`);
  
  const currentState = conversationState.get(userPhone);

  if (['hola', 'hey', 'buenas', 'buenos dias'].includes(userQuery)) {
    conversationState.set(userPhone, 'AWAITING_QUERY');
    await sendTextMessage(userPhone, "¡Hola! 👋 Soy tu asistente de compras personal. ¿Qué producto te gustaría que analice por ti hoy?");
    return res.sendStatus(200);
  }

  if (currentState === 'AWAITING_QUERY') {
    conversationState.set(userPhone, 'SEARCHING');
    await executeSearch(userPhone, message.text.body);
    conversationState.delete(userPhone);
    return res.sendStatus(200);
  }

  conversationState.set(userPhone, 'SEARCHING');
  await executeSearch(userPhone, message.text.body);
  conversationState.delete(userPhone);
  
  res.sendStatus(200);
}

/**
 * Verificación del Webhook (requerido por Meta una sola vez).
 */
export function verifyWhatsAppWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[Webhook Verification] Intentando verificar...');
    console.log(`[Webhook Verification] Token recibido: ${token}`);
    console.log(`[Webhook Verification] Token esperado: ${VERIFY_TOKEN}`);

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[Webhook Verification] ¡Éxito! Los tokens coinciden.');
        res.status(200).send(challenge);
    } else {
        console.error('[Webhook Verification] ¡ERROR! Los tokens no coinciden o el modo no es "subscribe".');
        res.sendStatus(403);
    }
}

