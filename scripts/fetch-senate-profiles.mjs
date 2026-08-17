// Fetches complete Maine Senate profiles from district pages
// URL pattern: https://legislature.maine.gov/district[NUMBER]
// Map pattern: https://legislature.maine.gov/uploads/visual_edit/senatedistrict[NUMBER].png
// Saves to: data/legislature/senators.json

import { writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';

const DATA_DIR = 'data/legislature';
const PHOTOS_DIR = 'images/politicians/senate';
const MAPS_DIR = 'images/maps';
const TOTAL_DISTRICTS = 35;

function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function extractPhotoUrl(html) {
    const patterns = [
        /src="([^"]*uploads\/visual_edit[^"]*\.(?:jpg|jpeg|png))"/i,
        /src="([^"]*uploads\/[^"]*\.(?:jpg|jpeg|png))"/i,
        /<img[^>]+src="([^"]*\.(?:jpg|jpeg|png))"/i
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            let url = match[1];
            if (url.startsWith('/')) {
                url = `https://legislature.maine.gov${url}`;
            }
            return url;
        }
    }
    return null;
}

function extractName(html) {
    const match = html.match(/Sen\.\s+([^<(]+)\s*\(([DR])-/i) ||
                  html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                  html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
    
    if (match && match[1]) {
        return cleanText(match[1]);
    }
    return null;
}

function extractParty(html) {
    const match = html.match(/Sen\.\s+[^<(]+\s*\(([DRI])-/i);
    if (match && match[1]) {
        return match[1].toUpperCase();
    }
    return null;
}

function extractCounty(html, party) {
    const match = html.match(/\([DRI]-([^)]+)\)/i);
    if (match && match[1]) {
        return cleanText(match[1]);
    }
    return null;
}

function extractDistrictTowns(html) {
    const match = html.match(/Senate District \d+:([^M]+)Mailing Address/i);
    if (match && match[1]) {
        return cleanText(match[1]);
    }
    return null;
}

function extractEmail(html) {
    const match = html.match(/Email:\s*<a href="mailto:([^"]+)"/i) ||
                  html.match(/mailto:([^"']+)/i);
    if (match && match[1]) {
        return cleanText(match[1]);
    }
    return null;
}

function extractPhone(html) {
    const match = html.match(/State House:\s*([^<\n]+)/i) ||
                  html.match(/Phone:\s*([^<\n]+)/i);
    if (match && match[1]) {
        return cleanText(match[1]);
    }
    return null;
}

function extractWebsite(html) {
    const match = html.match(/Website:\s*<a href="([^"]+)"/i) ||
                  html.match(/Website:\s*([^<\n]+)/i);
    if (match && match[1]) {
        return cleanText(match[1]);
    }
    return null;
}

function extractLegislativeService(html) {
    const match = html.match(/Legislative Service:\s*([^<\n]+)/i);
    if (match && match[1]) {
        return cleanText(match[1]);
    }
    return null;
}

function extractCommittees(html) {
    const match = html.match(/Committee Assignments:\s*([\s\S]*?)(?:Maine Government|$)/i);
    if (match && match[1]) {
        const committees = [];
        const committeeMatches = match[1].matchAll(/<a[^>]*>([^<]+)<\/a>/g);
        for (const cm of committeeMatches) {
            if (cm[1] && !committees.includes(cleanText(cm[1]))) {
                committees.push(cleanText(cm[1]));
            }
        }
        if (committees.length === 0) {
            const text = cleanText(match[1]);
            if (text && text !== 'None') {
                committees.push(text);
            }
        }
        return committees;
    }
    return [];
}

async function scrapeDistrict(districtNumber) {
    const url = `https://legislature.maine.gov/district${districtNumber}`;
    
    try {
        console.log(`District ${districtNumber}:`);
        
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MainePoliticsBot/1.0)',
                'Accept': 'text/html'
            },
            signal: AbortSignal.timeout(15000)
        });
        
        if (!res.ok) {
            console.log(`  ✗ HTTP ${res.status}`);
            return null;
        }
        
        const html = await res.text();
        
        // Extract all data
        const name = extractName(html);
        const party = extractParty(html);
        const county = extractCounty(html);
        const districtTowns = extractDistrictTowns(html);
        const email = extractEmail(html);
        const phone = extractPhone(html);
        const website = extractWebsite(html);
        const legislativeService = extractLegislativeService(html);
        const committees = extractCommittees(html);
        const photoUrl = extractPhotoUrl(html);
        
        if (!name) {
            console.log(`  ✗ Could not parse name`);
            return null;
        }
        
        console.log(`  ✓ ${name} (${party}-${county})`);
        
        // Download photo
        let photoFilename = null;
        if (photoUrl) {
            photoFilename = `district-${districtNumber}.jpg`;
            try {
                const photoRes = await fetch(photoUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; MainePoliticsBot/1.0)'
                    }
                });
                
                if (photoRes.ok) {
                    const buffer = await photoRes.arrayBuffer();
                    await writeFile(resolve(PHOTOS_DIR, photoFilename), Buffer.from(buffer));
                    console.log(`  ✓ Photo downloaded`);
                } else {
                    console.log(`  ✗ Photo download failed (HTTP ${photoRes.status})`);
                    photoFilename = null;
                }
            } catch (e) {
                console.log(`  ✗ Photo download error: ${e.message}`);
                photoFilename = null;
            }
        }
        
        // Download district map
        let mapFilename = null;
        const mapUrl = `https://legislature.maine.gov/uploads/visual_edit/senatedistrict${districtNumber}.png`;
        try {
            const mapRes = await fetch(mapUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; MainePoliticsBot/1.0)'
                }
            });
            
            if (mapRes.ok && mapRes.headers.get('content-type')?.includes('image')) {
                mapFilename = `senate-district-${districtNumber}.png`;
                const mapBuffer = await mapRes.arrayBuffer();
                await writeFile(resolve(MAPS_DIR, mapFilename), Buffer.from(mapBuffer));
                console.log(`  ✓ Map downloaded`);
            } else {
                console.log(`  ✗ No map found`);
            }
        } catch (e) {
            console.log(`  ✗ Map download error: ${e.message}`);
        }
        
        // Build profile object
        return {
            district: districtNumber,
            name: name,
            party: party,
            county: county,
            district_towns: districtTowns,
            mailing_address: "3 State House Station, Augusta, Maine 04333",
            phone: phone,
            email: email,
            website: website,
            legislative_service: legislativeService,
            committees: committees,
            photo: photoFilename ? `images/politicians/senate/${photoFilename}` : null,
            map: mapFilename ? `images/maps/${mapFilename}` : null,
            photo_url: photoUrl,
            page_url: url,
            profile_url: `politicians/senate-${districtNumber}.html`
        };
        
    } catch (e) {
        console.log(`  ✗ Error: ${e.message}`);
        return null;
    }
}

async function main() {
    await mkdir(DATA_DIR, { recursive: true });
    await mkdir(PHOTOS_DIR, { recursive: true });
    await mkdir(MAPS_DIR, { recursive: true });
    
    console.log(`Scraping all ${TOTAL_DISTRICTS} Senate districts...\n`);
    
    const senators = [];
    let success = 0;
    
    for (let district = 1; district <= TOTAL_DISTRICTS; district++) {
        const senator = await scrapeDistrict(district);
        if (senator) {
            senators.push(senator);
            success++;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    senators.sort((a, b) => a.district - b.district);
    
    const output = {
        updated: new Date().toISOString(),
        legislature: "132nd Maine Legislature",
        chamber: "Senate",
        total_seats: 35,
        composition: {
            dem: senators.filter(s => s.party === 'D').length,
            rep: senators.filter(s => s.party === 'R').length,
            ind: senators.filter(s => s.party === 'I').length
        },
        senators: senators
    };
    
    await writeFile(
        resolve(DATA_DIR, 'senators.json'),
        JSON.stringify(output, null, 2) + '\n'
    );
    
    console.log(`\n✓ Scraped ${success}/${TOTAL_DISTRICTS} districts`);
    console.log(`✓ Saved ${senators.length} senator profiles`);
    console.log(`✓ Photos in: ${PHOTOS_DIR}/`);
    console.log(`✓ Maps in: ${MAPS_DIR}/`);
    console.log(`✓ Data in: ${DATA_DIR}/senators.json`);
}

main().catch(console.error);
