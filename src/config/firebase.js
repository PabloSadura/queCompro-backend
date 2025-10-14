

import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";

// ✅ Equivalente de __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serviceAccountPath = path.resolve(__dirname, "../../serviceAccountKey.json");

try {
  if (!admin.apps.length) {
    // ✅ Leemos el archivo JSON con fs (en ESM no podés usar require)
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    }); 

    console.log("✅ Firebase Admin inicializado correctamente");
  }
} catch (err) {
  console.error("❌ Error al inicializar Firebase Admin:", err);
  process.exit(1);
}

export default admin;
