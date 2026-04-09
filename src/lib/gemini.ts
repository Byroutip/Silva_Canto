/**
 * Gemini 2.0 Flash — image description for search indexing.
 * Uses the generativelanguage.googleapis.com REST API with an API key.
 */

const GEMINI_MODEL = "gemini-2.0-flash";
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

export async function describeImage(
    imageBase64: string,
    mimeType: string,
    apiKey: string
): Promise<ImageDescription> {
    const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const body = {
        contents: [
            {
                parts: [
                    {
                        inlineData: {
                            mimeType,
                            data: imageBase64,
                        },
                    },
                    { text: PROMPT },
                ],
            },
        ],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
        },
    };

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text();
        if (response.status === 429) {
            throw new Error("RATE_LIMIT");
        }
        throw new Error(`Gemini API chyba ${response.status}: ${text}`);
    }

    const json = await response.json();
    const rawText: string =
        json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return parseDescription(rawText);
}

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
