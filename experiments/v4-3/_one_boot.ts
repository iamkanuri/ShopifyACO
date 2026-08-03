import { runDemo } from "../../src/server/buyerTestDemo.js";
const d = await runDemo();
console.log(JSON.stringify({ c: d.counts, r: d.rows.map((x) => [x.entryId, x.status]) }));
