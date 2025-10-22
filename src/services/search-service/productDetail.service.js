import { getProductFromFirebase, updateProductInFirebase } from '../search-service/firebaseService.service.js';
import { fetchImmersiveProductDetails } from '../search-service/googleInmersive.service.js';

/**
 * Obtiene los detalles completos de un producto.
 * Primero busca en Firestore. Si los detalles inmersivos no existen, los busca en SerpApi,
 * actualiza el documento en Firestore y luego devuelve el producto completo.
 * @param {string} collectionId - El ID del documento de la búsqueda principal.
 * @param {string} productId - El ID del producto.
 * @returns {Promise<object>} El objeto del producto completo y enriquecido.
 */
export async function getEnrichedProductDetails(collectionId, productId) {
  if (!collectionId || !productId) {
    throw new Error('Faltan collectionId o productId para obtener los detalles del producto.');
  }

  // 1. Obtener el producto base desde Firestore.
  const product = await getProductFromFirebase(collectionId, productId);

  if (!product) {
    throw new Error(`Producto con ID ${productId} no encontrado en Firebase.`);
  }

  // 2. Si ya tiene los detalles, los devolvemos (actúa como caché).
  if (product.immersive_details) {
    console.log(`[DB Cache Hit] Devolviendo detalles para el producto: ${productId}`);
    return product;
  }

  // 3. Si no tiene detalles, los buscamos usando el enlace inmersivo.
  if (!product.serpapi_immersive_product_api) {
    console.warn(`[DB Cache Miss] No hay enlace inmersivo para el producto: ${productId}. Devolviendo producto base.`);
    return product; // Devuelve el producto base si no hay forma de enriquecerlo.
  }
  
  console.log(`[DB Cache Miss] Buscando detalles inmersivos para el producto: ${productId}`);
  const immersiveDetails = await fetchImmersiveProductDetails(product.serpapi_immersive_product_api);

  // Si la llamada a la API inmersiva falla, devolvemos el producto que ya teníamos.
  if (!immersiveDetails) {
      return product;
  }

  // 4. Construimos el objeto del producto actualizado.
  const updatedProduct = {
    ...product,
    immersive_details: immersiveDetails,
  };

  // 5. Guardamos los nuevos detalles en Firestore para futuras peticiones.
  await updateProductInFirebase(collectionId, productId, { 
    immersive_details: immersiveDetails 
  });

  // 6. Devolvemos el producto recién enriquecido.
  return updatedProduct;
}
