import axios from 'axios';

// --- Tus variables de entorno ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * Normaliza un número de teléfono para la API de WhatsApp,
 * eliminando el '9' de los números móviles de Argentina si está presente.
 */
function normalizePhoneNumber(phone) {
  if (phone.startsWith('549') && phone.length === 13) {
    return '54' + phone.substring(3);
  }
  return phone;
}

/**
 * Función base para enviar cualquier tipo de petición a la API de WhatsApp.
 */
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

// --- Funciones exportadas para enviar diferentes tipos de mensajes ---

export function sendTextMessage(to, text) {
  return sendWhatsAppRequest({ to, type: "text", text: { body: text }, messaging_product: "whatsapp" });
}

export function sendImageMessage(to, imageUrl, caption = '') {
  return sendWhatsAppRequest({ to, type: "image", image: { link: imageUrl, caption }, messaging_product: "whatsapp" });
}

export function sendListMessage(to, headerText, bodyText, buttonText, sections) {
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

export function sendReplyButtonsMessage(to, bodyText, buttons) {
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
