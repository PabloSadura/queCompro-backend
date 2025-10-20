import { getBestRecommendationFromAI } from '../services/search-service/aiService.js';
import { fetchGoogleShoppingResults } from '../services/search-service/googleSopphing.js';
import logicFusion from './logis.controller.js';
import axios from 'axios';

// --- DEBES CONFIGURAR ESTAS VARIABLES EN TU .env Y EN RENDER ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * Normaliza un número de teléfono para la API de WhatsApp,
 * eliminando el '9' de los números móviles de Argentina si está presente.
 * @param {string} phone - El número de teléfono a normalizar.
 * @returns {string} El número de teléfono normalizado.
 */
function normalizePhoneNumber(phone) {
  // Si es un número de Argentina que incluye el '9' para móviles (ej. 549...)
  if (phone.startsWith('549') && phone.length === 13) {
    console.log(`[Phone Normalization] Removiendo el '9' del número móvil de Argentina: ${phone}`);
    // Se quita el '9' uniendo '54' con el resto del número.
    return '54' + phone.substring(3);
  }
  return phone;
}

/**
 * Función para enviar un mensaje de texto de vuelta al usuario, ahora con logging detallado.
 */
async function sendWhatsAppMessage(to, text) {
  const recipientNumber = normalizePhoneNumber(to);

  const requestBody = {
    messaging_product: "whatsapp",
    to: recipientNumber,
    type: "text",
    text: { body: text },
  };

  const headers = { 
    'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json'
  };

  console.log(`[WhatsApp Send] Intentando enviar mensaje a: ${recipientNumber}`);
  console.log(`[WhatsApp Send] Body:`, JSON.stringify(requestBody, null, 2));

  try {
    await axios.post(WHATSAPP_API_URL, requestBody, { headers });
    console.log(`[WhatsApp Send] Mensaje enviado exitosamente a ${recipientNumber}`);
  } catch (error) {
    // Este log es crucial. Muestra el error exacto que devuelve Meta.
    console.error("❌ Error al enviar mensaje de WhatsApp. Respuesta de Meta:", error.response?.data || error.message);
  }
}

/**
 * Controlador principal para el webhook de WhatsApp.
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message || message.type !== 'text') {
    return res.sendStatus(200);
  }

  const userPhone = message.from;
  const userQuery = message.text.body;

  console.log(`Mensaje recibido de ${userPhone}: "${userQuery}"`);

  try {
    await sendWhatsAppMessage(userPhone, `¡Hola! 👋 Recibí tu búsqueda: "${userQuery}". Dame un momento mientras analizo las mejores opciones para ti...`);

    const { products: shoppingResults } = await fetchGoogleShoppingResults(null, userQuery, 'ar', 'es', 'ARS');
    if (!shoppingResults || shoppingResults.length === 0) {
      await sendWhatsAppMessage(userPhone, "Lo siento, no encontré productos para tu búsqueda. ¿Podrías intentar con otros términos?");
      return res.sendStatus(200);
    }

    const aiAnalysis = await getBestRecommendationFromAI(userQuery, shoppingResults);
    const productosRecomendados = logicFusion(shoppingResults, aiAnalysis);

    let responseText = `🤖 *Análisis Completado para "${userQuery}"*\n\n`;
    responseText += `*Recomendación de la IA:* ${aiAnalysis.recomendacion_final}\n\n`;
    responseText += "Aquí están las mejores opciones que encontré:\n\n";

    productosRecomendados.forEach((prod, index) => {
      responseText += `*${index + 1}. ${prod.title}*\n`;
      responseText += `Precio: *${prod.price}*\n`;
      responseText += `Rating: ${prod.rating || 'N/A'} ⭐\n`;
      responseText += `Ver más: ${prod.product_link}\n\n`;
    });

    await sendWhatsAppMessage(userPhone, responseText);
    
    res.sendStatus(200);

  } catch (error) {
    console.error("Error procesando la búsqueda de WhatsApp:", error);
    await sendWhatsAppMessage(userPhone, "Lo siento, ocurrió un error inesperado al procesar tu búsqueda. Por favor, intenta de nuevo más tarde.");
    res.sendStatus(500);
  }
}

/**
 * Verificación del Webhook (requerido por Meta una sola vez), ahora con logging.
 */
export function verifyWhatsAppWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[Webhook Verification] Intentando verificar...');
  console.log(`[Webhook Verification] Token recibido: ${token}`);
  console.log(`[Webhook Verification] Token esperado: ${VERIFY_TOKEN}`);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Webhook Verification] ¡Éxito! Los tokens coinciden. Respondiendo al challenge.');
    res.status(200).send(challenge);
  } else {
    console.error('[Webhook Verification] ¡ERROR! Los tokens no coinciden o el modo no es "subscribe".');
    res.sendStatus(403);
  }
}

