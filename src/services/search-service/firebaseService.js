import admin from "../../config/firebase.js";

const db = admin.firestore();

export async function saveSearchToFirebase(userQuery, userId, finalRecommendation) {
  try {
    const searchData = {
      userId,
      query: userQuery,
      createdAt: new Date(),
      ...finalRecommendation
    };
    
    const productos = searchData.productos;
    delete searchData.productos;

    const searchDocRef = await db.collection(process.env.FIRESTORE_COLLECTION).add(searchData);
    console.log(`Búsqueda guardada con el ID: ${searchDocRef.id}`);

    const batch = db.batch();
    productos.forEach(product => {
      const productRef = searchDocRef.collection(process.env.FIRESTORE_PRODUCTS_COLLECTION).doc(product.product_id);
      batch.set(productRef, product);
    });
    await batch.commit();
    
    return {id:searchDocRef.id, createdAt: searchData.createdAt };

  } catch (error) {
    console.error("Error al guardar la búsqueda en Firebase:", error);
    throw error;
  }
}
 
export async function getProductFromFirebase(collectionId, productId) {
  try {
    const productRef = db.collection(process.env.FIRESTORE_COLLECTION).doc(collectionId).collection(process.env.FIRESTORE_PRODUCTS_COLLECTION).doc(productId);
    const docSnap = await productRef.get();

    if (docSnap.exists) {
      return docSnap.data();
    } else {
      console.warn(`No se encontró el producto con ID: ${productId} en la colección ${collectionId}`);
      return null;
    }
  } catch (error) {
    console.error("Error al obtener el producto de Firebase:", error);
    throw error;
  }
}

export async function updateProductInFirebase(collectionId, productId, dataToUpdate) {
  try {
    const productRef = db.collection(process.env.FIRESTORE_COLLECTION).doc(collectionId).collection(process.env.FIRESTORE_PRODUCTS_COLLECTION).doc(productId);
    await productRef.update(dataToUpdate);
  } catch (error) {
    console.error("Error al actualizar el producto en Firebase:", error);
    throw error;
  }
}
