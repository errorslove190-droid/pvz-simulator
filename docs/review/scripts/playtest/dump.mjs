import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('http://localhost:8804/'); await p.waitForFunction(() => typeof VISITORS !== 'undefined');
const d = await p.evaluate(() => ({ visitors: VISITORS, items: { ALL_PARCELS, MALE_ITEMS, FEMALE_ITEMS, SENIOR_ITEMS } }));
writeFileSync('work/playtest/visitors.json', JSON.stringify(d, null, 1)); await b.close();
