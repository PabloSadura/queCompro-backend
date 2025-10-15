import axios from 'axios'; 

/**
 * Obtiene la geolocalización de una dirección IP usando ip-api.com.
 * NOTA: Esta función espera que se le pase la IP correcta del usuario.
 * En producción (ej. Render), la IP se debe obtener del header 'x-forwarded-for' en el controlador.
 * @param {string} ip - La dirección IP del usuario (ej. req.headers['x-forwarded-for']).
 * @returns {Promise<object>} - Objeto con los datos de geolocalización o un valor por defecto.
 */
export async function getGeoLocation(ip) {
    // Para pruebas en localhost (::1 es IPv6, 127.0.0.1 es IPv4), devuelve un objeto por defecto.
    if (ip === '::1' || ip === '127.0.0.1') {
        console.log("📍 IP de localhost detectada. Usando geolocalización de prueba (AR).");
        return { countryCode: 'AR', currency: 'ARS', status: 'success' };
    }

    // Si no se proporciona una IP (o es la de un proxy interno), ip-api.com
    // usará la IP desde la que se realiza la llamada (la de nuestro servidor).
    // Esto puede ser una aproximación útil en producción si el header 'x-forwarded-for' falla.
    const targetIp = ip || '';
    console.log(`🌍 Obteniendo geolocalización para la IP: ${targetIp || 'automática'}`);

    try {
        // Usamos HTTPS para mayor seguridad
        const response = await axios.get(`https://ip-api.com/json/${targetIp}`);
        const data = response.data;
        
        if (data.status === 'fail') {
            console.error('❌ Error en la API de ip-api.com:', data.message);
            return { countryCode: 'US', currency: 'USD', status: 'fail' };
        }
        
        // Mapeo simple de país a moneda para los casos más comunes
        const currencyMap = { 
            AR: "ARS", 
            US: "USD", 
            ES: "EUR", 
            BR: "BRL",
            MX: "MXN",
            CO: "COP"
        };
        data.currency = currencyMap[data.countryCode] || "USD";
        
        console.log(`✅ Geolocalización exitosa: País=${data.countryCode}, Moneda=${data.currency}`);
        return data;

    } catch (error) {
        console.error('❌ Error crítico al llamar a la API de geolocalización:', error.message);
        return { countryCode: 'US', currency: 'USD', status: 'fail' };
    }
}
