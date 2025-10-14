// src/services/geoip-service/ipApiService.js

import axios from 'axios'; 

/**
 * Obtiene la geolocalización de una dirección IP usando ip-api.com
 * @param {string} ip - La dirección IP del usuario.
 * @returns {Promise<object>} - Objeto con los datos de geolocalización o un valor por defecto.
 */
export async function getGeoLocation(ip) {
    if (ip === '::1' || ip === '127.0.0.1') {
        // Para pruebas locales, devuelve un objeto por defecto
        return { countryCode: 'AR', currency: 'ARS', status: 'success' };
    }

    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        const data = response.data;
        
        if (data.status === 'fail') {
            console.error('❌ Error en la API de ip-api.com:', data.message);
            return { countryCode: 'US', currency: 'USD', status: 'fail' };
        }
        
        // Mapeo simple de país a moneda
        const currencyMap = { AR: "ARS", US: "USD", ES: "EUR", BR: "BRL" };
        data.currency = currencyMap[data.countryCode] || "USD";
        
        return data;

    } catch (error) {
        console.error('❌ Error al obtener geolocalización:', error);
        return { countryCode: 'US', currency: 'USD', status: 'fail' };
    }
}