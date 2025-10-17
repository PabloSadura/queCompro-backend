import { db } from "../config/firebase.js";
import NodeCache from "node-cache";

const historyCache = new NodeCache({ stdTTL: 300, checkperiod: 120 });


async function getUserHistory(req, res) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: "No autorizado" });
    }

    // 2. Intentamos obtener el historial desde la caché usando el userId como clave.
    const cachedHistory = historyCache.get(userId);
    if (cachedHistory) {
      console.log(`[Cache Hit] Devolviendo historial para el usuario: ${userId}`);
      return res.json(cachedHistory);
    }

    // 3. Si no está en la caché (cache miss), procedemos a buscar en Firestore.
    console.log(`[Cache Miss] Buscando historial en Firestore para el usuario: ${userId}`);
    const searchesSnapshot = await db.collection(process.env.FIRESTORE_COLLECTION)
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    const historyPromises = searchesSnapshot.docs.map(async (doc) => {
      const searchData = doc.data();
      const productsSnapshot = await doc.ref.collection(process.env.FIRESTORE_PRODUCTS_COLLECTION).get();
      const productos = productsSnapshot.docs.map(productDoc => productDoc.data());

      return {
        id: doc.id,
        query: searchData.query || "",
        createdAt: searchData.createdAt.toDate(),
        result: {
          productos: productos || [],
          recomendacion_final: searchData.recomendacion_final || "No hay recomendación disponible",
          total_results: searchData.total_results || 0
        }
      };
    });

    const userHistory = await Promise.all(historyPromises);
    
    // 4. Guardamos el resultado obtenido de Firestore en la caché para la próxima vez.
    historyCache.set(userId, userHistory);
    
    res.json(userHistory);

  } catch (err) {
    console.error("Error obteniendo historial:", err);
    res.status(500).json({ error: "Error interno" });
  }
}

export default getUserHistory;

    

