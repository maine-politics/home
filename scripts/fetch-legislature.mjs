// scripts/fetch-legislature.mjs
//
// Fetches Maine Legislature data server-side (run on a schedule via
// .github/workflows/fetch-feeds.yml) and writes static JSON files to
// data/legislature/. legislature.html reads those JSON files instead of
// calling the legislature API live in visitors' browsers.
//
// Data sources: https://legislature.maine.gov/api/

import { writeFile, mkdir } from 'fs/promises';

const API_BASE = 'https://legislature.maine.gov/api';

// Current legislature number — update when a new session starts
const CURRENT_LEGISLATURE = 132; // 132nd Legislature (2025-2026)

async function fetchJSON(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MainePoliticsBot/1.0; +https://maine-politics.github.io)',
            'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function textOf(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object' && '#text' in value) return String(value['#text']).trim();
    return String(value).trim();
}

async function safeFetch(url, label) {
    try {
        console.log(`Fetching ${label}...`);
        const data = await fetchJSON(url);
        console.log(`  ✓ got ${label}`);
        return data;
    } catch (e) {
        console.error(`  ✗ ${label}: ${e.message}`);
        return null;
    }
}

function normalizeBill(bill) {
    return {
        ld: textOf(bill.ld_number || bill.ldNumber),
        title: textOf(bill.title),
        status: textOf(bill.status || bill.bill_status),
        sponsor: textOf(bill.sponsor?.name || bill.primary_sponsor?.name || 'Unknown'),
        party: textOf(bill.sponsor?.party || bill.primary_sponsor?.party || '?'),
        district: textOf(bill.sponsor?.district || bill.primary_sponsor?.district || ''),
        committee: textOf(bill.committee || bill.current_committee || 'TBD'),
        last_action: textOf(bill.last_action || bill.latest_action || 'No action yet'),
        documents: Array.isArray(bill.documents) ? bill.documents.length : 0,
        amendments: Array.isArray(bill.amendments) ? bill.amendments.length : 0,
        votes: Array.isArray(bill.votes) ? bill.votes.length : 0,
        introduced: textOf(bill.date_introduced || bill.introduced_date || '')
    };
}

function normalizeLegislator(leg) {
    return {
        name: textOf(leg.name || leg.member_name),
        party: textOf(leg.party || leg.party_affiliation),
        district: textOf(leg.district || leg.district_number),
        chamber: textOf(leg.chamber || leg.member_type),
        committee: textOf(leg.committee || leg.committee_assignment || 'None'),
        sponsored_bills: Array.isArray(leg.sponsored_bills) ? leg.sponsored_bills.length : 0,
        title: textOf(leg.title || '')
    };
}

function normalizeCommittee(comm) {
    return {
        name: textOf(comm.name || comm.committee_name),
        chair: textOf(comm.chair || comm.chair_name || 'TBD'),
        members: Array.isArray(comm.members) ? comm.members.length : 0,
        bills: Array.isArray(comm.bills) ? comm.bills.length : 0,
        next_meeting: textOf(comm.next_meeting || comm.next_meeting_date || '')
    };
}

function processBills(bills) {
    if (!Array.isArray(bills)) return [];
    
    return bills
        .filter(bill => bill && (bill.ld_number || bill.ldNumber) && bill.title)
        .map(normalizeBill)
        .sort((a, b) => {
            // Sort by recent activity first
            const aActive = !['ENACTED', 'DEAD', 'VETOED', 'LD_NOT_YET_ASSIGNED'].includes(a.status);
            const bActive = !['ENACTED', 'DEAD', 'VETOED', 'LD_NOT_YET_ASSIGNED'].includes(b.status);
            if (aActive !== bActive) return aActive ? -1 : 1;
            return parseInt(a.ld) - parseInt(b.ld);
        });
}

function processLegislators(legislators) {
    if (!Array.isArray(legislators)) return [];
    
    return legislators
        .filter(leg => leg && (leg.name || leg.member_name))
        .map(normalizeLegislator)
        .sort((a, b) => b.sponsored_bills - a.sponsored_bills);
}

function processCommittees(committees) {
    if (!Array.isArray(committees)) return [];
    
    return committees
        .filter(comm => comm && (comm.name || comm.committee_name))
        .map(normalizeCommittee)
        .sort((a, b) => b.bills - a.bills);
}

async function buildWarRoomData() {
    console.log('Building Maine Legislature war room data...');
    await mkdir('data/legislature', { recursive: true });
    
    // Try multiple endpoint formats since the API documentation is spotty
    const billsData = await safeFetch(
        `${API_BASE}/bills/?legislature=${CURRENT_LEGISLATURE}&limit=100`,
        'bills'
    ) || await safeFetch(
        `${API_BASE}/bills/`,
        'bills (fallback)'
    );
    
    const legislatorsData = await safeFetch(
        `${API_BASE}/legislators/?legislature=${CURRENT_LEGISLATURE}`,
        'legislators'
    ) || await safeFetch(
        `${API_BASE}/legislators/`,
        'legislators (fallback)'
    );
    
    const committeesData = await safeFetch(
        `${API_BASE}/committees/?legislature=${CURRENT_LEGISLATURE}`,
        'committees'
    ) || await safeFetch(
        `${API_BASE}/committees/`,
        'committees (fallback)'
    );
    
    // Extract arrays from different possible response shapes
    const bills = billsData?.results || billsData?.bills || billsData || [];
    const legislators = legislatorsData?.results || legislatorsData?.legislators || legislatorsData || [];
    const committees = committeesData?.results || committeesData?.committees || committeesData || [];
    
    const processedBills = processBills(Array.isArray(bills) ? bills : [bills]);
    const processedLegislators = processLegislators(Array.isArray(legislators) ? legislators : [legislators]);
    const processedCommittees = processCommittees(Array.isArray(committees) ? committees : [committees]);
    
    const warRoom = {
        updated: new Date().toISOString(),
        legislature: {
            number: CURRENT_LEGISLATURE,
            name: `${CURRENT_LEGISLATURE}th Maine Legislature`,
            session: '2025-2026'
        },
        stats: {
            total_bills: processedBills.length,
            active_bills: processedBills.filter(b => 
                !['ENACTED', 'DEAD', 'VETOED', 'LD_NOT_YET_ASSIGNED'].includes(b.status)
            ).length,
            passed_bills: processedBills.filter(b => 
                ['ENACTED', 'PASSED_TO_BE_ENGROSSED', 'PASSED'].includes(b.status)
            ).length,
            total_legislators: processedLegislators.length,
            committees: processedCommittees.length,
            hot_bills: processedBills.slice(0, 15),
            top_sponsors: processedLegislators.slice(0, 25),
            committee_watch: processedCommittees.slice(0, 20)
        }
    };
    
    // Write main war room data
    await writeFile(
        'data/legislature/war-room.json',
        JSON.stringify(warRoom, null, 2) + '\n'
    );
    
    // Write raw data for potential future use (larger dataset)
    await writeFile(
        'data/legislature/bills-full.json',
        JSON.stringify(processedBills, null, 2) + '\n'
    );
    
    console.log(`  ✓ wrote war room data`);
    console.log(`    Bills: ${warRoom.stats.total_bills} (${warRoom.stats.active_bills} active)`);
    console.log(`    Legislators: ${warRoom.stats.total_legislators}`);
    console.log(`    Committees: ${warRoom.stats.committees}`);
    
    if (processedBills.length === 0) {
        console.warn('  ⚠ No bill data found — API might be down or format changed');
    }
}

async function main() {
    await buildWarRoomData();
}

main().catch(e => {
    console.error('Legislature fetch failed:');
    console.error(e);
    // Don't exit with error code — keep feed workflow running even if this fails
    process.exit(0);
});
