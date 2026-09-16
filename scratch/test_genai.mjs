import { GoogleGenAI } from "@google/genai";

async function test() {
  const ai = new GoogleGenAI({
    apiKey: "AQ.invalid_key_that_should_fail",
    httpOptions: { apiVersion: "v1beta" },
  });

  try {
    const session = await ai.live.connect({
      model: "models/gemini-2.0-flash-exp",
    });
    console.log("Connected successfully with invalid key!");
    session.close();
  } catch (err) {
    console.error("Connection failed:", err.message);
  }
}

test();
