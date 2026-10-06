import fs from "node:fs/promises";
import path from "node:path";
import { loadKidswearPack } from "../src/domain/pack/load";
import { buildPristineTemplate } from "../src/server/template-inject";

async function main() {
  const pack = loadKidswearPack().pack;
  const channel = pack.channels[0];
  const buffer = await buildPristineTemplate(channel.columns.map((column) => column.header));
  const file = path.join(process.cwd(), channel.templateFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  console.log(`Wrote ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
