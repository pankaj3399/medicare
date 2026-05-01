import { MongoClient } from "mongodb";

const SOURCE_URI = process.env.SOURCE_URI;
const TARGET_URI = process.env.TARGET_URI;
const SOURCE_DB = process.env.SOURCE_DB || "medicare";
const TARGET_DB = process.env.TARGET_DB || SOURCE_DB;
const BATCH = 2000;

if (!SOURCE_URI || !TARGET_URI) {
  console.error("ERROR: SOURCE_URI and TARGET_URI must both be set.");
  process.exit(1);
}

if (SOURCE_URI === TARGET_URI && SOURCE_DB === TARGET_DB) {
  console.error("ERROR: source and target are the same. Refusing to run.");
  process.exit(1);
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

async function copyCollection(srcDb, dstDb, name) {
  const src = srcDb.collection(name);
  const dst = dstDb.collection(name);

  const total = await src.estimatedDocumentCount();
  console.log(`\n[${name}] ${fmt(total)} docs in source`);

  await dst.drop().catch(() => {});
  console.log(`[${name}] dropped target`);

  const cursor = src.find({}, { noCursorTimeout: true });
  let buf = [];
  let copied = 0;
  let lastLog = Date.now();

  for await (const doc of cursor) {
    buf.push(doc);
    if (buf.length >= BATCH) {
      await dst.insertMany(buf, { ordered: false });
      copied += buf.length;
      buf = [];
      if (Date.now() - lastLog > 2000) {
        const pct = total ? ((copied / total) * 100).toFixed(1) : "?";
        console.log(`[${name}]   ${fmt(copied)} / ${fmt(total)}  (${pct}%)`);
        lastLog = Date.now();
      }
    }
  }
  if (buf.length) {
    await dst.insertMany(buf, { ordered: false });
    copied += buf.length;
  }
  console.log(`[${name}] copied ${fmt(copied)} docs`);

  const indexes = await src.indexes();
  for (const ix of indexes) {
    if (ix.name === "_id_") continue;
    const { key, name: ixName, ...options } = ix;
    delete options.v;
    delete options.ns;
    await dst.createIndex(key, { name: ixName, ...options });
    console.log(`[${name}]   index ${ixName} ✓`);
  }
}

async function main() {
  console.log(`source: ${SOURCE_URI.replace(/\/\/[^@]*@/, "//***:***@")}  db=${SOURCE_DB}`);
  console.log(`target: ${TARGET_URI.replace(/\/\/[^@]*@/, "//***:***@")}  db=${TARGET_DB}`);

  const srcClient = new MongoClient(SOURCE_URI);
  const dstClient = new MongoClient(TARGET_URI);
  await srcClient.connect();
  await dstClient.connect();

  const srcDb = srcClient.db(SOURCE_DB);
  const dstDb = dstClient.db(TARGET_DB);

  const collections = (await srcDb.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."));

  console.log(`\nCollections to copy: ${collections.join(", ")}`);
  for (const name of collections) {
    await copyCollection(srcDb, dstDb, name);
  }

  await srcClient.close();
  await dstClient.close();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
