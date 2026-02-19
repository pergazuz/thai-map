
import { GoogleGenAI, Type } from "@google/genai";
import { CircleMarker } from "../types";

// Always use named parameter and process.env.API_KEY directly as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeAreas = async (markers: CircleMarker[]) => {
  if (markers.length === 0) return null;

  const locations = markers.map(m => `[${m.lat}, ${m.lng}]`).join(", ");
  const prompt = `
    Analyze the following coordinates in Thailand: ${locations}.
    Each point represents the center of a 50km radius circle.
    Please provide:
    1. A brief summary of the geographic regions covered.
    2. A list of major provinces intersected.
    3. Notable landmarks or tourist attractions within these 50km zones.
    Format the response clearly.
  `;

  try {
    const response = await ai.models.generateContent({
      // Using gemini-3-flash-preview for basic text task
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    // Use .text property directly, do not call text()
    return response.text;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Failed to analyze areas. Please check your connection.";
  }
};

export const batchIdentifyProvinces = async (points: {lat: number, lng: number}[]) => {
  if (points.length === 0) return [];
  
  const coordsList = points.map((p, i) => `${i}: ${p.lat}, ${p.lng}`).join('\n');
  const prompt = `Identify the Thai province for each coordinate below. Return a JSON array of strings (province names only) in the same order as provided.
  Coordinates:
  ${coordsList}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });
    // Use .text property directly and trim whitespace as recommended for JSON
    const text = response.text;
    return text ? JSON.parse(text.trim()) : [];
  } catch (error) {
    console.error("Identify Provinces Error:", error);
    return points.map(() => "Unknown Province");
  }
};
