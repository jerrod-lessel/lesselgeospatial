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
- Return ONLY valid JSON, no markdown, no backticks, no preamble.`;

const USER_PROMPT = `Search the web for 5 recent and interesting geospatial news articles from the past week. Focus on: remote sensing, satellite imagery, disaster risk, urban resilience, climate monitoring, GIS tools, earth observation, or spatial data science. Prioritize research findings, new tools, and genuinely interesting developments over press releases or product announcements (unless the product announcement is actually interesting or newsworthy).

For each article return:
- title: the article title
- source: the publication or website name
- url: the full URL
- summary: 2-3 sentence summary in your voice -- witty, informative, slightly unhinged about maps. No em dashes.

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

  try {
    // Check cache first
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return res.status(200).json({ ...cached, fromCache: true });
    }

    // No cache -- call Claude with web search
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: USER_PROMPT }],
    });

    // Extract text content from response
    const textContent = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parse JSON -- strip any accidental markdown fences
    const clean = textContent.replace(/```json|```/g, "").trim();
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
