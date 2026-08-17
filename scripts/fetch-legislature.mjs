// Fetches Maine Legislature data and saves as JSON for the war room
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data/legislature');

// Ensure directory exists
mkdirSync(DATA_DIR, { recursive: true });

const API_BASE = 'https://legislature.maine.gov/api';

async function fetchJSON(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'MainePoliticsBot/1.0 (contact@mainepolitics.org)',
            'Accept': 'application/json'
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}

async function fetchLegislatureData() {
    console.log('Fetching Maine Legislature data...');
    
    try {
        // Get current legislature info
        const legislatures = await fetchJSON(`${API_BASE}/legislatures/`);
        const current = legislatures.results?.find(l => l.is_current) || legislatures.results?.[0];
        
        if (!current) throw new Error('No legislature found');
        
        console.log(`Current legislature: ${current.name}`);
        
        // Fetch bills
        console.log('Fetching bills...');
        const bills = await fetchJSON(`${API_BASE}/bills/?legislature=${current.id}&limit=100`);
        
        // Fetch legislators
        console.log('Fetching legislators...');
        const legislators = await fetchJSON(`${API_BASE}/legislators/?legislature=${current.id}`);
        
        // Fetch committees
        console.log('Fetching committees...');
        const committees = await fetchJSON(`${API_BASE}/committees/?legislature=${current.id}`);
        
        // Process and save data
        const warRoomData = {
            updated: new Date().toISOString(),
            legislature: {
                id: current.id,
                name: current.name,
                session_start: current.start_date,
                session_end: current.end_date
            },
            stats: {
                total_bills: bills.count || bills.results?.length || 0,
                active_bills: bills.results?.filter(b => 
                    !['ENACTED', 'DEAD', 'VETOED'].includes(b.status)
                ).length || 0,
                passed_bills: bills.results?.filter(b => 
                    ['ENACTED', 'PASSED_TO_BE_ENGROSSED'].includes(b.status)
                ).length || 0,
                total_legislators: legislators.count || legislators.results?.length || 0,
                committees: committees.count || committees.results?.length || 0
            },
            hot_bills: processBills(bills.results || []),
            legislator_activity: processLegislators(legislators.results || []),
            committee_watch: processCommittees(committees.results || [])
        };
        
        // Save main war room data
        writeFileSync(
            resolve(DATA_DIR, 'war-room.json'),
            JSON.stringify(warRoomData, null, 2)
        );
        
        // Save raw data for potential future use
        writeFileSync(
            resolve(DATA_DIR, 'bills-raw.json'),
            JSON.stringify(bills.results || [], null, 2)
        );
        
        console.log('✅ Legislature data saved successfully');
        console.log(`   Bills: ${warRoomData.stats.total_bills}`);
        console.log(`   Active: ${warRoomData.stats.active_bills}`);
        console.log(`   Legislators: ${warRoomData.stats.total_legislators}`);
        
    } catch (error) {
        console.error('Error fetching legislature data:', error.message);
        // Don't fail the workflow, just log the error
        // This way your news feeds still update even if legislature API is down
    }
}

function processBills(bills) {
    return bills
        .filter(bill => bill.title && bill.ld_number)
        .slice(0, 10)
        .map(bill => ({
            ld: bill.ld_number,
            title: bill.title,
            status: bill.status || 'UNKNOWN',
            sponsor: bill.sponsor?.name || 'Unknown',
            party: bill.sponsor?.party || '?',
            committee: bill.committee || 'TBD',
            documents: bill.documents?.length || 0,
            votes: bill.votes?.length || 0,
            last_action: bill.last_action || 'No action yet'
        }));
}

function processLegislators(legislators) {
    return legislators
        .filter(leg => leg.name)
        .slice(0, 186) // Maine has 186 legislators
        .map(leg => ({
            name: leg.name,
            party: leg.party || 'I',
            district: leg.district || 'Unknown',
            chamber: leg.chamber || 'Unknown',
            committee: leg.committee || 'None',
            sponsored_bills: leg.sponsored_bills?.length || 0
        }))
        .sort((a, b) => b.sponsored_bills - a.sponsored_bills);
}

function processCommittees(committees) {
    return committees
        .filter(comm => comm.name)
        .map(comm => ({
            name: comm.name,
            chair: comm.chair || 'TBD',
            members: comm.members?.length || 0,
            bills: comm.bills?.length || 0,
            next_meeting: comm.next_meeting || null
        }))
        .sort((a, b) => b.bills - a.bills);
}

// Run it
fetchLegislatureData();
