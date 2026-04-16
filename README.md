# LGeo - Lessel Geospatial

Personal site and project hub for Jerrod Lessel, senior geospatial analyst and remote sensing researcher.

**Live site:** lesselgeospatial.com

## Projects

### Geospatial Manifold
A pre-disaster urban resilience auditing platform for city planners. Analyzes road network vulnerability using OSMnx and NetworkX.

### Project Geoganda
A daily AI-curated geospatial news briefing. Finding the ground truth in geospatial news. Updated every 24 hours via the Anthropic API with web search.

## Stack

- Static HTML/CSS site
- Vercel for hosting and serverless functions
- Upstash Redis for 24-hour response caching
- Anthropic Claude API with web search for Geoganda briefing

## Local Development

```bash
npm install
npx vercel dev
```
