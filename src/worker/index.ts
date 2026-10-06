import fs from "node:fs";
import path from "node:path";
import { processNextJob } from "../server/jobs";

const envFile = path.join(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const workerName = process.env.WORKER_ID || `worker-${process.pid}`;
console.log(`PIM-lite worker ${workerName} polling the Postgres queue.`);

async function loop(): Promise<void> {
  for (;;) {
    try {
      const worked = await processNextJob();
      if (!worked) await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

void loop();
