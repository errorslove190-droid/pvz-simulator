import { launch, newGame } from './lib.mjs';
const b = await launch();
const p = await newGame(b, { mobile: false });
const r = await p.evaluate(() => {
  const re = RETURN_PROMISE_RE;
  return VISITORS.map(v => ({ id: v.id, name: v.name, total: (v.hardEnds||[]).length, match: (v.hardEnds||[]).filter(e => re.test(e.v)).map(e => e.v) })).filter(x => x.match.length);
});
console.log(JSON.stringify(r, null, 1));
await b.close();
