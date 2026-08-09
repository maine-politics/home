// scripts/fetch-feeds.mjs
//
// Fetches ticker, Maine headline, and national headline RSS feeds server-side
// (run on a schedule via .github/workflows/fetch-feeds.yml) and writes static
// JSON files to data/. index.html reads those JSON files instead of calling
// a third-party proxy (rss2json) live in visitors' browsers.

import { XMLParser } from 'fast-xml-parser';
import { writeFile, mkdir } from 'fs/promises';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text'
});

const TICKER_FEEDS = [
    { url: 'https://www.mainepublic.org/politics.rss', label: 'Maine Public' },
    { url: 'https://www.bangordailynews.com/feed/', label: 'Bangor Daily News' },
    { url: 'https://www.pressherald.com/feed/', label: 'Portland Press Herald' }
];

const MAINE_FEEDS = [
    { url: 'https://www.mainepublic.org/politics.rss', label: 'Maine Public' },
    { url: 'https://www.bangordailynews.com/feed/', label: 'BDN' },
    { url: 'https://www.pressherald.com/feed/', label: 'Press Herald' },
    { url: 'https://www.sunjournal.com/feed/', label: 'Sun Journal' },
    { url: 'https://www.centralmaine.com/feed/', label: 'Kennebec Journal' }
];

// Weave more than just NPR into the national column.
// Add/remove sources here — this is the one place that controls it.
const NATIONAL_FEEDS = [
    { url: 'https://feeds.npr.org/1014/rss.xml', label: 'NPR Politics' },
    { url: 'https://thehill.com/homenews/feed/', label: 'The Hill' },
    { url: 'https://www.politico.com/rss/politicopicks.xml', label: 'Politico' }
];

function textOf(node) {
    if (node == null) return '';
    if (typeof node === 'string') return node.trim();
    if (typeof node === 'object' && '#text' in node) return String(node['#text']).trim();
    return String(node).trim();
}

function extractItems(parsed) {
    // RSS 2.0
    const channelItems = parsed?.rss?.channel?.item;
    if (channelItems) return Array.isArray(channelItems) ? channelItems : [channelItems];
    // Atom fallback
    const entries = parsed?.feed?.entry;
    if (entries) return Array.isArray(entries) ? entries : [entries];
    return [];
}

function normalize(item) {
    let link = item.link;
    if (link && typeof link === 'object') {
        link = link['@_href'] ?? link['#text'] ?? '';
    }
    return {
        title: textOf(item.title),
        link: typeof link === 'string' ? link.trim() : ''
    };
}

async function fetchFeed(feed, perFeedLimit) {
    try {
        const res = await fetch(feed.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MainePoliticsBot/1.0; +https://maine-politics.github.io)'
            },
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const parsed = parser.parse(xml);
        return extractItems(parsed)
            .slice(0, perFeedLimit)
            .map(normalize)
            .filter(i => i.title && i.link)
            .map(i => ({ ...i, source: feed.label }));
    } catch (e) {
        console.error(`  ✗ ${feed.label}: ${e.message}`);
        return [];
    }
}

async function buildFeedFile(feeds, perFeedLimit, outPath, maxTotal) {
    console.log(`Fetching ${outPath}...`);
    const results = await Promise.all(feeds.map(f => fetchFeed(f, perFeedLimit)));
    let items = results.flat();
    items.sort(() => Math.random() - 0.5); // shuffle for variety
    if (maxTotal) items = items.slice(0, maxTotal);
    await writeFile(outPath, JSON.stringify(items, null, 2) + '\n');
    console.log(`  ✓ wrote ${items.length} items`);
}

async function main() {
    await mkdir('data', { recursive: true });
    await buildFeedFile(TICKER_FEEDS, 5, 'data/ticker.json', 30);
    await buildFeedFile(MAINE_FEEDS, 4, 'data/maine-headlines.json', 15);
    await buildFeedFile(NATIONAL_FEEDS, 6, 'data/national-headlines.json', 12);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
