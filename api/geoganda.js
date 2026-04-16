import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CACHE_KEY = "geoganda:briefing";
const SEEN_KEY = "geoganda:seen_urls";
const CACHE_TTL = 60 * 60 * 24; // 24 hours
const SEEN_TTL = 60 * 60 * 24 * 14; // 14 days rolling blacklist

const SYSTEM_PROMPT = `You are a rogue geospatial analyst who has hijacked a respectable website to broadcast the truth about what is happening in the geospatial world. You find this stuff genuinely fascinating and you write like it.

Your tone is dry, specific, and occasionally absurd. Here are examples of the exact voice you should use:

GOOD: "Researchers have mapped every pothole in São Paulo using LiDAR, which is either the most useful application of satellite technology this year or a very expensive way to confirm that São Paulo has potholes."

GOOD: "A new flood risk model covers 180 countries, which is great news for 180 countries and mildly unsettling for everyone living in them."

GOOD: "ESA released a 10-meter global land cover map. It is extremely detailed. It will be used primarily to argue about where exactly the wetland boundary is."

BAD: "Researchers have developed a new methodology for assessing flood risk using remote sensing data." (boring, sounds like an abstract)

BAD: "This groundbreaking study delves into the crucial landscape of urban resilience." (AI slop, delete on sight)

Rules:
- No em dashes. Use a hyphen or rewrite the sentence.
- No words like "delve", "crucial", "landscape", "groundbreaking", "dive into", "it is worth noting", "comprehensive".
- If the topic involves war, conflict, humanitarian crisis, or human suffering -- drop the humor entirely and just be clear and informative.
- Punch up never down. Call out bad behavior from big companies directly.
- Write at the level of a second year undergrad -- smart enough for concepts, no jargon walls.
- Summaries are 2-3 sentences. The first sentence states what happened. The second adds the dry observation.
- Never include citation tags, reference markers, or any markup. Plain text only.
- Return ONLY valid JSON, no markdown, no backticks, no preamble.
- Be efficient -- do 1-2 searches, find 5 good headlines, stop.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Cache flush
  if (process.env.FLUSH_SECRET && req.query.flush === process.env.FLUSH_SECRET) {
    await redis.del(CACHE_KEY);
    return res.status(200).json({ message: "Cache cleared" });
  }

  // Full reset including seen URLs
  if (process.env.FLUSH_SECRET && req.query.reset === process.env.FLUSH_SECRET) {
    await redis.del(CACHE_KEY);
    await redis.del(SEEN_KEY);
    return res.status(200).json({ message: "Cache and seen URLs cleared" });
  }

  try {
    // Check cache first
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return res.status(200).json({ ...cached, fromCache: true });
    }

    // Get previously seen URLs to avoid duplicates
    let seenUrls = [];
    try {
      const seen = await redis.get(SEEN_KEY);
      if (seen && Array.isArray(seen)) {
        seenUrls = seen;
      }
    } catch (e) {
      seenUrls = [];
    }

    // Build the avoid list for the prompt
    const avoidSection = seenUrls.length > 0
      ? `\n\nDo NOT include any articles from these URLs -- they have already been used in recent briefings:\n${seenUrls.join("\n")}`
      : "";

    const USER_PROMPT = `Do 1-2 focused web searches to find 5 recent geospatial news articles published in the last 7 days. Focus on: remote sensing, satellite imagery, disaster risk, urban resilience, climate monitoring, GIS tools, or earth observation. Use only the headline and brief snippet -- do not fetch full articles. Prioritize research findings and genuinely interesting developments over press releases.${avoidSection}

For each article return:
- title: the article title
- source: the publication or website name
- url: the full URL
- summary: 2-3 sentences in your voice. First sentence states what happened. Second sentence adds the dry observation or absurd implication. No em dashes.

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

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
      messages: [{ role: "user", content: USER_PROMPT }],
    });

    const textContent = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    const clean = jsonMatch[0].replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    if (!parsed.articles || !Array.isArray(parsed.articles)) {
      throw new Error("Invalid response structure");
    }

    const articles = parsed.articles.slice(0, 5);

    const result = {
      articles,
      generatedAt: new Date().toISOString(),
      fromCache: false,
    };

    // Cache today's briefing
    await redis.set(CACHE_KEY, result, { ex: CACHE_TTL });

    // Update seen URLs -- add today's URLs to the rolling 14-day blacklist
    const newUrls = articles.map(a => a.url).filter(Boolean);
    const updatedSeen = [...new Set([...seenUrls, ...newUrls])].slice(-70); // keep last 70 (14 days x 5)
    await redis.set(SEEN_KEY, updatedSeen, { ex: SEEN_TTL });

    return res.status(200).json(result);
  } catch (err) {
    console.error("Geoganda API error:", err);
    return res.status(500).json({
      error: "Transmission failed",
      articles: [],
    });
  }
}
