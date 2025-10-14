import admin from "../config/firebase.js";

/**
 * Obtiene el historial de búsquedas de un usuario, incluyendo los productos
 * de la subcolección correspondiente a cada búsqueda.
 */
async function getUserHistory(req, res) {
  try {    
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: "No autorizado" });
    }
    
    // 1. Obtener los documentos principales de las búsquedas del usuario.
    const searchesSnapshot = await admin.firestore().collection(process.env.FIRESTORE_COLLECTION)
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .get();

    // 2. Para cada búsqueda, crear una promesa que también obtenga los productos de su subcolección.
    const historyPromises = searchesSnapshot.docs.map(async (doc) => {
      const searchData = doc.data();
      
      // 3. Obtener los documentos de la subcolección 'productos'.
      const productsSnapshot = await doc.ref.collection(process.env.FIRESTORE_PRODUCTS_COLLECTION).get();
      const productos = productsSnapshot.docs.map(productDoc => productDoc.data());

      // 4. Construir el objeto de historial completo que el frontend espera.
      return {
        id: doc.id,
        query: searchData.query || "",
        createdAt: searchData.createdAt.toDate(), // Convertir Timestamp a Date
        result: {
          productos: productos || [],
          recomendacion_final: searchData.recomendacion_final || "No hay recomendación disponible",
          total_results: searchData.total_results || 0
        }
      };
    });

    // 5. Esperar a que todas las búsquedas y sus subcolecciones se resuelvan.
    const userHistory = await Promise.all(historyPromises);
    
    res.json(userHistory);

  } catch (err) {
    console.error("Error obteniendo historial:", err);
    res.status(500).json({ error: "Error interno" });
  }
}

export default getUserHistory;
