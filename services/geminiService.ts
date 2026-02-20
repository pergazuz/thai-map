
import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.API_KEY;
const IS_MOCK = !API_KEY || API_KEY === 'PLACEHOLDER_API_KEY';

const ai = IS_MOCK ? null : new GoogleGenAI({ apiKey: API_KEY });

const mockBatchIdentifyProvinces = (points: { lat: number; lng: number }[]): string[] => {
  return points.map(p => `${p.lat.toFixed(3)}°N ${p.lng.toFixed(3)}°E`);
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
