/**
 * Marketing Algorithm Tracker
 * Uses Gemini API with Google Search grounding to fetch and explain
 * Facebook & Instagram algorithm changes.
 */

import {
    collection,
    doc,
    getDocs,
    setDoc,
    query,
    orderBy,
    limit,
    type Firestore,
} from "firebase/firestore";

// ── Types ──

export type Platform = "facebook" | "instagram";

export type AlgorithmUpdate = {
    id: string;
    platform: Platform;
    title: string;
    summary: string;       // human-friendly, simple Czech
    details: string;        // deeper explanation
    sources: string[];      // source URLs
    date: string;           // YYYY-MM-DD
    fetchedAt: number;
    tags: string[];
};

export type MarketingQuery = {
    question: string;
    answer: string;
    sources: string[];
};

const COLLECTION = "algorithmUpdates";

const META_OFFICIAL_SOURCES = `
OFICIÁLNÍ ZDROJE META (vždy z nich čerpej informace):
- Meta Transparency Center – Explaining Ranking: https://transparency.meta.com/features/explaining-ranking/
- Facebook Reels AI system: https://transparency.meta.com/features/explaining-ranking/fb-reels/
- Instagram Reels Chaining AI system: https://transparency.meta.com/features/explaining-ranking/ig-reels-chaining/
- Instagram Explore AI system: https://transparency.meta.com/features/explaining-ranking/ig-explore/
- Instagram Creators – Recommendations and originality: https://creators.instagram.com/blog/recommendations-and-originality
- About Meta – How AI ranks content: https://about.fb.com/news/2023/06/how-ai-ranks-content-on-facebook-and-instagram/
`;

const FORMAT_TAGS_INSTRUCTION = `
TAGS musí VŽDY obsahovat typ formátu kterého se změna týká. Použij tyto tagy (jeden nebo více):
feed, reels, stories, carousel, voice, live, text, photo, video, explore, hashtags, engagement, dosah, algoritmus
Příklad: "feed, reels, dosah, engagement"
`;

// ── Fetch via Gemini with Google Search grounding + auto-retry ──

async function geminiWithSearch(
    prompt: string,
    apiKey: string
): Promise<{ text: string; sources: string[] }> {
    const { callGemini } = await import("./gemini");

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
        },
    };

    const { text, candidate } = await callGemini(body, apiKey);

    // Extract source URLs from grounding metadata
    const sources: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groundingMeta = (candidate as any)?.groundingMetadata;
    if (groundingMeta?.groundingChunks) {
        for (const chunk of groundingMeta.groundingChunks) {
            if (chunk?.web?.uri) {
                sources.push(chunk.web.uri);
            }
        }
    }

    return { text, sources };
}

// ── Scrape algorithm changes for a platform ──

export async function scrapeAlgorithmChanges(
    platform: Platform,
    apiKey: string
): Promise<AlgorithmUpdate[]> {
    const platformName = platform === "facebook" ? "Facebook" : "Instagram";

    const prompt = `Najdi nejnovější změny a novinky v algoritmu ${platformName} z posledních 7 dní (dnes je ${new Date().toISOString().split("T")[0]}).

${META_OFFICIAL_SOURCES}

Pro každou změnu/novinku odpověz ve formátu (můžeš uvést 3-5 položek):

---ITEM---
TITLE: [stručný název změny]
DATE: [datum ve formátu YYYY-MM-DD, nebo přibližné]
SUMMARY: [vysvětlení změny jednoduše, lidskou řečí, jako bys to vysvětloval kamarádovi co dělá marketing. 2-3 věty v češtině. Žádný odborný žargon.]
DETAILS: [podrobnější vysvětlení co to prakticky znamená pro člověka co spravuje firemní profil na ${platformName}. Co by měl změnit ve své strategii? 3-5 vět v češtině.]
TAGS: [formátové tagy + klíčová slova oddělená čárkou]
---END---

${FORMAT_TAGS_INSTRUCTION}

Pokud nejsou žádné nové změny z posledních 7 dní, uveď nejnovější známé změny/trendy algoritmu ${platformName}.
Odpovídej POUZE ve formátu výše, žádný úvod ani závěr.`;

    const { text, sources } = await geminiWithSearch(prompt, apiKey);
    return parseUpdates(text, platform, sources);
}

function parseUpdates(
    raw: string,
    platform: Platform,
    sources: string[]
): AlgorithmUpdate[] {
    const items = raw.split("---ITEM---").filter(s => s.includes("TITLE:"));
    const updates: AlgorithmUpdate[] = [];

    for (const item of items) {
        const title = extractField(item, "TITLE");
        const date = extractField(item, "DATE") || new Date().toISOString().split("T")[0];
        const summary = extractField(item, "SUMMARY");
        const details = extractField(item, "DETAILS");
        const tagsRaw = extractField(item, "TAGS");
        const tags = tagsRaw
            ? tagsRaw.split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
            : [];

        if (title && summary) {
            const id = `${platform}-${date}-${title.slice(0, 30).replace(/[^a-z0-9áčďéěíňóřšťúůýž]+/gi, "-").toLowerCase()}`;
            updates.push({
                id,
                platform,
                title,
                summary,
                details: details || summary,
                sources,
                date,
                fetchedAt: Date.now(),
                tags,
            });
        }
    }

    return updates;
}

function extractField(text: string, field: string): string {
    const regex = new RegExp(`${field}:\\s*(.+?)(?=\\n(?:TITLE|DATE|SUMMARY|DETAILS|TAGS|---END)|$)`, "s");
    const match = text.match(regex);
    return match ? match[1].trim() : "";
}

// ── Save updates to Firestore ──

export async function saveUpdates(
    db: Firestore,
    updates: AlgorithmUpdate[]
): Promise<void> {
    for (const update of updates) {
        await setDoc(doc(db, COLLECTION, update.id), update);
    }
}

// ── Load stored updates ──

export async function getStoredUpdates(
    db: Firestore,
    maxCount = 500
): Promise<AlgorithmUpdate[]> {
    const q = query(
        collection(db, COLLECTION),
        orderBy("fetchedAt", "desc"),
        limit(maxCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as AlgorithmUpdate);
}

// ── AI-powered search/explanation ──

export async function askMarketingQuestion(
    question: string,
    apiKey: string
): Promise<MarketingQuery> {
    const prompt = `Jsi marketingový expert, který vysvětluje věci jednoduše a srozumitelně. Mluv česky, jako bys radil kamarádovi.

${META_OFFICIAL_SOURCES}

Otázka: ${question}

Odpověz stručně a prakticky (max 5 vět). Zaměř se na to, co to znamená PRO PRAXI — co konkrétně má člověk udělat nebo změnit.
Nepoužívej odborný žargon. Mluv jednoduše. Čerpej z oficiálních zdrojů Meta výše.`;

    const { text, sources } = await geminiWithSearch(prompt, apiKey);
    return { question, answer: text, sources };
}

// ── Fetch baseline: current state of algorithms ──

async function scrapeCurrentAlgorithm(
    platform: Platform,
    apiKey: string
): Promise<AlgorithmUpdate[]> {
    const platformName = platform === "facebook" ? "Facebook" : "Instagram";

    const prompt = `Popiš KOMPLETNĚ jak aktuálně (rok 2025/2026) funguje algoritmus ${platformName}. Rozděl to do hlavních oblastí.

${META_OFFICIAL_SOURCES}

Čerpej PRIMÁRNĚ z výše uvedených oficiálních zdrojů Meta.

Pro každou oblast odpověz ve formátu:

---ITEM---
TITLE: [název oblasti, např. "Feed - řazení příspěvků" nebo "Reels - dosah a distribuce"]
DATE: ${new Date().toISOString().split("T")[0]}
SUMMARY: [vysvětli jednoduše jak tato část algoritmu funguje. Piš česky, lidsky, jako bys vysvětloval kamarádovi co dělá marketing na sítích. 3-4 věty. Žádný žargon.]
DETAILS: [podrobnější vysvětlení s praktickými tipy. Co konkrétně ovlivňuje úspěch v této oblasti? Jaké metriky algoritmus sleduje? Co dělat a nedělat? 5-8 vět česky, jednoduše.]
TAGS: [formátové tagy + klíčová slova oddělená čárkou]
---END---

${FORMAT_TAGS_INSTRUCTION}

Pokryj tyto oblasti (pro každou samostatný ITEM):
- Feed (řazení příspěvků)
- Stories
- Reels / Videa
- Carousel / Kolotoče
- Explore / Objevování
- Engagement signály (co algoritmus měří)
- Dosah a viditelnost
- Hashtags a discovery
- Nejlepší čas na postování
- Tipy pro růst

Odpovídej POUZE ve formátu výše.`;

    const { text, sources } = await geminiWithSearch(prompt, apiKey);
    const updates = parseUpdates(text, platform, sources);
    // Mark these as baseline items
    return updates.map(u => ({
        ...u,
        id: `baseline-${u.id}`,
        tags: [...u.tags, "základ", "jak-funguje"],
    }));
}

export async function fetchBaseline(
    db: Firestore,
    apiKey: string,
    onProgress?: (msg: string) => void
): Promise<AlgorithmUpdate[]> {
    const all: AlgorithmUpdate[] = [];

    onProgress?.("Stahuji jak funguje algoritmus Facebooku…");
    const fb = await scrapeCurrentAlgorithm("facebook", apiKey);
    all.push(...fb);

    onProgress?.("Stahuji jak funguje algoritmus Instagramu…");
    const ig = await scrapeCurrentAlgorithm("instagram", apiKey);
    all.push(...ig);

    onProgress?.("Ukládám…");
    await saveUpdates(db, all);

    return all;
}

// ── Check if baseline exists ──

export function hasBaseline(updates: AlgorithmUpdate[]): boolean {
    return updates.some(u => u.id.startsWith("baseline-"));
}

// ── Full refresh: scrape both platforms ──

export async function refreshAllUpdates(
    db: Firestore,
    apiKey: string,
    onProgress?: (msg: string) => void
): Promise<AlgorithmUpdate[]> {
    const newUpdates: AlgorithmUpdate[] = [];

    onProgress?.("Hledám novinky z Facebooku…");
    const fbUpdates = await scrapeAlgorithmChanges("facebook", apiKey);
    newUpdates.push(...fbUpdates);

    onProgress?.("Hledám novinky z Instagramu…");
    const igUpdates = await scrapeAlgorithmChanges("instagram", apiKey);
    newUpdates.push(...igUpdates);

    onProgress?.("Ukládám novinky…");
    await saveUpdates(db, newUpdates);

    // Return all stored updates (old + new merged)
    onProgress?.("Načítám kompletní historii…");
    const all = await getStoredUpdates(db);
    return all;
}
