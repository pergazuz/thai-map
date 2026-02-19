
import { GoogleGenAI, Type } from "@google/genai";
import { CircleMarker } from "../types";

const API_KEY = process.env.API_KEY;
const IS_MOCK = !API_KEY || API_KEY === 'PLACEHOLDER_API_KEY';

const ai = IS_MOCK ? null : new GoogleGenAI({ apiKey: API_KEY });

// --- Mock helpers ---

const mockAnalyzeAreas = (markers: CircleMarker[]): string => {
  const names = markers.map(m => m.label).join(", ");
  return `[Demo Mode — add GEMINI_API_KEY in Vercel to enable AI analysis]

Zone Summary (${markers.length} zone${markers.length !== 1 ? 's' : ''}):
${markers.map((m, i) => `  ${i + 1}. ${m.label} — Center: ${m.lat.toFixed(4)}°N, ${m.lng.toFixed(4)}°E`).join('\n')}

Geographic Overview:
The selected zones (${names}) are located within Thailand. Each zone covers a primary radius of 50 km and an extended range of 100 km. In a live environment, this section would describe the major provinces, landmarks, and strategic insights for the selected areas.

Note: This is placeholder output. Connect a Gemini API key to receive real AI-generated analysis.`;
};

const mockBatchIdentifyProvinces = (points: { lat: number; lng: number }[]): string[] => {
  return points.map(p => `${p.lat.toFixed(3)}°N ${p.lng.toFixed(3)}°E`);
};

// --- Service functions ---

export const analyzeAreas = async (markers: CircleMarker[]) => {
  if (markers.length === 0) return null;

  if (IS_MOCK) return mockAnalyzeAreas(markers);

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
    const response = await ai!.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Failed to analyze areas. Please check your connection.";
  }
};

export const batchIdentifyProvinces = async (points: {lat: number, lng: number}[]) => {
  if (points.length === 0) return [];

  if (IS_MOCK) return mockBatchIdentifyProvinces(points);

  const coordsList = points.map((p, i) => `${i}: ${p.lat}, ${p.lng}`).join('\n');
  const prompt = `Identify the Thai province for each coordinate below. Return a JSON array of strings (province names only) in the same order as provided.
  Coordinates:
  ${coordsList}`;

  try {
    const response = await ai!.models.generateContent({
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
    const text = response.text;
    return text ? JSON.parse(text.trim()) : [];
  } catch (error) {
    console.error("Identify Provinces Error:", error);
    return points.map(() => "Unknown Province");
  }
};
