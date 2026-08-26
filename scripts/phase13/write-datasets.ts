import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { allDatasets } from "./datasets";

mkdirSync(join(process.cwd(), "datasets"), { recursive: true });

for (const d of allDatasets) {
  writeFileSync(join(process.cwd(), "datasets", `${d.id}.json`), JSON.stringify(d, null, 2));
  console.log(`wrote datasets/${d.id}.json (${d.turns.length} turns)`);
}
console.log(`\n${allDatasets.length} datasets written.`);
