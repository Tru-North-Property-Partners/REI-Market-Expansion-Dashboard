# Tru North REI Market Expansion Dashboard - Data Sources and Monthly Refresh Runbook

This file documents every dataset feeding the dashboard so the monthly update never requires
"going fishing" for sources again. Pair it with rebuild.js (the runnable refresh script).

## At a glance

| Feed | Geography | Transport | Fields it sets |
|------|-----------|-----------|----------------|
| Redfin city Housing Market Tracker | City | Manual: download then upload to Google Drive | price, days on market, months of supply, sale-to-list, homes sold, pending, inventory |
| Census population (incorporated places) | Place | Manual: upload workbook to Google Sheets | population, 5yr population growth |
| Zillow ZHVI city | City | Direct fetch (CORS ok) | home value (display) + county crosswalk |
| Zillow ZORI city | City | Direct fetch | rent (display) |
| CFPB serious delinquency | County | Direct fetch (gist) | distress score, 40 percent weight |
| CFPB early-stage delinquency | County | Direct fetch (gist) | distress score, 8 percent weight |

Two feeds (Redfin, Census) are private manual uploads; the other four fetch directly.

## 1. Redfin city Housing Market Tracker

Source page: redfin.com/news/data-center/housing-market (Download, city level, all metros).
Redfin exports the entire city-level file at once; there is no way to target a subset.
The file is large (about 76 MB) so it goes to Google Drive, not Sheets or the repo.

- Drive file id: 1B0mZqKMkItyV_mHbEXFaFKz7awOhvKDD (replace each month with the new upload)
- Fetch (from a drive.usercontent.google.com tab): download endpoint with id plus export=download plus confirm=t
- Columns used: REGION NAME, PERIOD END, MEDIAN SALE PRICE NSA ($), MEDIAN DAYS ON MARKET (DAYS),
  MONTHS OF SUPPLY, AVERAGE SALE TO LIST RATIO (%), HOMES SOLD, PENDING SALES, INVENTORY
- Keep only rows where PERIOD END equals the latest period in the file.
- Maps to RAW indices 4 (price), 5 (dom), 6 (moi), 7 (slr), 12 (sold); pending/inventory derive PEND.

## 2. Census population for incorporated places

Source: Census Annual Resident Population Estimates for Incorporated Places
(www2.census.gov popest datasets, cities totals). The keyless bulk file is CORS-blocked and the
Census API now requires a key, so we route it through Google Sheets.

- Upload the workbook (SUB-IP-EST2025-POP.xlsx style) to Google Sheets, then use export format=csv.
- Sheet id: paste the new id into rebuild.js (SHEET_ID) each month.
- Columns used: Geographic Area (Place, State), the 2020 base year column, and the latest year column.
- Maps to RAW index 2 (population) and index 8 (population growth = (latest minus 2020) / 2020 times 100).

## 3. Zillow ZHVI city (value + county crosswalk)

- URL: files.zillowstatic.com research public_csvs zhvi City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv
- Fetches directly from the dashboard origin. Use the last dated column for the current value.
- Columns used: RegionName, State, CountyName, latest month column.
- Maps to RAW index 13 (zhvi, display only) and supplies the county name used to join CFPB.

## 4. Zillow ZORI city (rent)

- URL: files.zillowstatic.com research public_csvs zori City_zori_uc_sfrcondomfr_sm_month.csv
- Columns used: RegionName, State, latest month column.
- Maps to RAW index 14 (rent, display only).

## 5. CFPB delinquency by county

- Serious delinquency gist raw id: 3c0553f5a9a86dab92c6695f4059caeb -> DLQ1 (40 percent of distress)
- Early-stage delinquency gist raw id: 4c605d6baff8844aa38e3634f02fb2f9 -> DLQ2 (8 percent of distress)
- Join city to county via the Zillow CountyName crosswalk from feed 3.
- Delinquency feeds the distress score only; it is never shown as a visible column.

## Optional, not yet integrated

Redfin Investor Home Purchases (metro level), Google Sheet id 18uYuUcgwMXpVjRmtLO8R1Va-zkEb4MA0jxK3YCXHHW4.
A possible future signal; metro granularity, so it would need a city-to-metro mapping before use.

## The monthly gate (which new markets get added)

A new market is added only if all of the following are true:
state is already on the board, population is at least 19,400, homes sold is greater than 50,
and the full Redfin core set (price, dom, moi, slr) plus Census (pop, growth) are present.
No field is ever fabricated; anything unconfirmed stays null and renders as a placeholder.
Scores are null-safe and renormalize, so partial rows still score correctly. Opportunity and ROI
stay cost-agnostic; Zillow value, rent, yield and market heat stay display-only.

## Monthly procedure (about 10 minutes)

1. On redfin.com data center, download the latest city-level Housing Market Tracker file.
2. Upload it to Google Drive; copy the new file id into rebuild.js (DRIVE_ID).
3. Refresh the Census population workbook in Google Sheets; copy the new id into rebuild.js (SHEET_ID).
4. Open the live dashboard tab. In a drive.usercontent.google.com tab, fetch the Redfin and Census
   CSV text (CORS allows it there) and move it back via window.name.
5. In the dashboard tab run: await rebuild(redfinText, censusText). It preserves all existing
   markets, refreshes them, adds qualifying net-new markets, enriches, updates the date badge,
   validates (no em-dashes, no mojibake, equal array lengths), and writes window._FINAL.
6. Copy window._FINAL into index.html on GitHub and commit. Confirm the live market count.

## What cannot be automated to run by itself

There is no always-on server or cron in this setup, and two feeds are private manual uploads, so a
truly self-running monthly job is not possible here. The closest partial option is a GitHub Actions
workflow that refreshes the four direct-fetch feeds on a schedule; the Redfin and Census uploads
would still be manual. See the chat for that workflow file if you want it.
