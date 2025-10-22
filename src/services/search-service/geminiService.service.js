// src/services/geminiService.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import geminiPrompt from "../../config/geminiPrompt.js";
import { analyzeShoppingResults } from "./ia.service.js";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const CACHE_EXPIRATION_TIME = 3600; // 1 hora en segundos

function sanitizeGeminiResponse(text) {
  let cleaned = text.replace(/```(?:json)?/g, "").replace(/```/g, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned.trim();
}

export async function getBestRecommendationFromGemini(userQuery, shoppingResults) {
  if (!shoppingResults || shoppingResults.length === 0) {
    return {
      productos: [],
      recomendacion_final: "No se encontraron productos para analizar.",
    };
  }

  const prompt = geminiPrompt(shoppingResults, userQuery);

  try {
    console.log("Intentando obtener recomendación con Google Gemini...");
    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const recommendation = JSON.parse(sanitizeGeminiResponse(text));

    return recommendation;

  } catch (geminiError) {
    console.error("Falló la llamada a Gemini.", geminiError.message);
       try {
      console.log("Ejecutando análisis local basado en reglas...");
      // ✅ 2. Llamamos a tu función de análisis local
      const localAnalysisResult = analyzeShoppingResults(userQuery, shoppingResults);
      console.log("✅ Análisis local completado.");
      return localAnalysisResult;

    } catch (localAnalysisError) {
      console.error("❌ Falló también el análisis local.", localAnalysisError.message);
      // Si ambos fallan, lanzamos un error final
      throw new Error("Error: No se pudo obtener un análisis (ni IA ni local).");
    }
  }
}
