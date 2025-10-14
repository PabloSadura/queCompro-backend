import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => {
    console.error('❌ Error de conexión a Redis:', err);
    // Puedes implementar una lógica de reintento o notificar al equipo
});

(async () => {
    try {
        await client.connect();
        console.log('✅ Conexión a Redis exitosa.');
    } catch (err) {
        console.error('❌ No se pudo conectar a Redis.', err);
    }
})();

export default client;