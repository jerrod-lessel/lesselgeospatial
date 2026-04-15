import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CACHE_KEY = "geoganda:briefing";
const CACHE_TTL = 60 * 60 * 24; // 24 hours in seconds

const SYSTEM_PROMPT = `You are a rogue geospatial analyst who has hijacked a respectable website to broadcast the truth about what is happening in the geospatial world. Think David Attenborough narrating a nature doc but the animals are GIS tools and the ecosystem is slowly on fire. Dry, specific, occasionally absurd. If a sentence could appear in a corporate press release, rewrite it. The reader is a geospatial professional who is tired and needs to laugh. Write at the level of a second year undergrad -- smart enough to get the concepts, no need for jargon walls.

If the topic involves war, conflict, humanitarian crisis, or human suffering, drop the humor entirely and just be clear and informative. Punch up, never down. When a big company does something genuinely awful to its users or the community, call it out directly.

Rules:
- No em dashes. Use a regular hyphen or rewrite the sentence.
- No words like "delve", "crucial", "landscape", "groundbreaking", "dive into", or "it is worth noting".
- No corporate speak. No AI slop.
- Write like a human who is slightly unhinged about maps.
- Summaries should be 2-3 sentences. Informative but not dry.
- If a sentence is boring, make it less boring. If it cannot be made less boring, at least make it accurate.
- Never include citation tags, reference markers, index tags, or any markup in your summaries. Plain text only.
- Return ONLY valid JSON, no markdown, no backticks, no preamble.
- Be efficient -- do not over-search. Find 5 good headlines and stop.`;

const USER_PROMPT = `Do 1-2 focused web searches to find 5 recent geospatial news headlines from the past week. Focus on: remote sensing, satellite imagery, disaster risk, urban resilience, climate monitoring, GIS tools, or earth observation. Use only the headline and brief snippet for each -- do not read full articles. Stop searching once you have 5 good candidates.

For each article return:
- title: the article title
- source: the publication or website name
- url: the full URL
- summary: 2-3 sentence summary in your voice -- witty, informative, slightly unhinged about maps. No em dashes. Write from the headline and snippet only, do not fetch the full article.

Return as a JSON object with this exact structure:
{
  "articles": [
    {
      "title": "...",
      "source": "...",
      "url": "...",
      "summary": "..."
    }
  ]
}`;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Secret flush URL -- visit /api/geoganda?flush=YOUR_FLUSH_SECRET to clear cache
  if (process.env.FLUSH_SECRET && req.query.flush === process.env.FLUSH_SECRET) {
    await redis.del(CACHE_KEY);
    return res.status(200).json({ message: "Cache cleared" });
  }

  try {
    // Check cache first
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return res.status(200).json({ ...cached, fromCache: true });
    }

    // No cache -- call Claude Haiku with web search, max 2 searches
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
      messages: [{ role: "user", content: USER_PROMPT }],
    });

    // Extract text content from response
    const textContent = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Extract JSON -- find the first { and last } to handle any preamble
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const clean = jsonMatch[0].replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // Validate structure
    if (!parsed.articles || !Array.isArray(parsed.articles)) {
      throw new Error("Invalid response structure");
    }

    const result = {
      articles: parsed.articles.slice(0, 5),
      generatedAt: new Date().toISOString(),
      fromCache: false,
    };

    // Cache for 24 hours
    await redis.set(CACHE_KEY, result, { ex: CACHE_TTL });

    return res.status(200).json(result);
  } catch (err) {
    console.error("Geoganda API error:", err);
    return res.status(500).json({
      error: "Transmission failed",
      articles: [],
    });
  }
}
