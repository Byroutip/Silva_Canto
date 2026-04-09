/**
 * Gemini 2.0 Flash — image description for search indexing.
 * Uses the generativelanguage.googleapis.com REST API with an API key.
 */

const GEMINI_MODELS = ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash"];
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type ImageDescription = {
    descriptionCs: string;
    descriptionEn: string;
    tags: string[];
};

const PROMPT = `Popiš tento obrázek podrobně pro účely vyhledávání. Uveď:
- Hlavní předměty a objekty
- Barvy, materiály, textury
- Prostředí / místo
- Akce nebo pózy osob (pokud jsou přítomny)
- Jakýkoliv viditelný text

Odpověz ve formátu:
CS: [český popis, 2-3 věty]
EN: [English description, 2-3 sentences]
TAGS: [klíčová slova oddělená čárkou, česky i anglicky, min 15 slov]`;

async function callGemini(
    body: object,
    apiKey: string,
    models = GEMINI_MODELS
): Promise<{ text: string; candidate: unknown }> {
    for (const model of models) {
        const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

        for (let attempt = 0; attempt < 3; attempt++) {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (response.ok) {
                const json = await response.json();
                const candidate = json?.candidates?.[0];
                const text: string = candidate?.content?.parts?.[0]?.text ?? "";
                return { text, candidate };
            }

            if (response.status === 429) {
                // Try to extract retry delay
                const errBody = await response.text();
                const delayMatch = errBody.match(/retry in (\d+)/i);
                const waitSec = delayMatch ? Math.min(parseInt(delayMatch[1]), 60) : 10 * (attempt + 1);
                console.warn(`Rate limited on ${model}, waiting ${waitSec}s (attempt ${attempt + 1}/3)…`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }

            // Non-429 error — try next model
            const text = await response.text();
            console.warn(`Gemini ${model} error ${response.status}, trying next model…`);
            if (models.indexOf(model) === models.length - 1) {
                throw new Error(`Gemini API chyba ${response.status}: ${text}`);
            }
            break;
        }
    }
    throw new Error("Všechny Gemini modely selhaly.");
}

export async function describeImage(
    imageBase64: string,
    mimeType: string,
    apiKey: string
): Promise<ImageDescription> {
    const body = {
        contents: [
            {
                parts: [
                    { inlineData: { mimeType, data: imageBase64 } },
                    { text: PROMPT },
                ],
            },
        ],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
        },
    };

    const { text } = await callGemini(body, apiKey);
    return parseDescription(text);
}

// Exported for marketing module to use
export { callGemini, GEMINI_BASE, GEMINI_MODELS };

function parseDescription(raw: string): ImageDescription {
    let descriptionCs = "";
    let descriptionEn = "";
    let tags: string[] = [];

    const csMatch = raw.match(/CS:\s*(.+?)(?=\nEN:|$)/s);
    if (csMatch) descriptionCs = csMatch[1].trim();

    const enMatch = raw.match(/EN:\s*(.+?)(?=\nTAGS:|$)/s);
    if (enMatch) descriptionEn = enMatch[1].trim();

    const tagsMatch = raw.match(/TAGS:\s*(.+)/s);
    if (tagsMatch) {
        tags = tagsMatch[1]
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t.length > 0);
    }

    // Fallback: if parsing fails, use the whole text as description
    if (!descriptionCs && !descriptionEn) {
        descriptionCs = raw.slice(0, 300);
        descriptionEn = raw.slice(0, 300);
    }

    return { descriptionCs, descriptionEn, tags };
}
