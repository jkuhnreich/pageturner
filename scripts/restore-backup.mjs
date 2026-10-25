// שחזור גיבוי של Pageturner למסד נתונים
// שימוש: DATABASE_URL=... node scripts/restore-backup.mjs pageturner-backup-YYYY-MM-DD.json.gz
// לפני השחזור: להפעיל את השרת פעם אחת מול המסד החדש, כדי שהטבלאות ייווצרו.
// שורות שכבר קיימות (לפי מפתח ראשי) לא נדרסות.
import fs from "fs";
import { gunzipSync } from "zlib";
import pg from "pg";

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error("usage: DATABASE_URL=... node scripts/restore-backup.mjs <backup.json.gz>");
  process.exit(1);
}
const raw = fs.readFileSync(file);
const data = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"));
const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });

console.log(`backup from ${data.createdAt}${data.imagesOmitted ? " (without images)" : ""}`);
for (const [table, rows] of Object.entries(data.tables)) {
  let added = 0;
  for (const row of rows) {
    const cols = Object.keys(row);
    const vals = cols.map(c => (row[c] !== null && typeof row[c] === "object" ? JSON.stringify(row[c]) : row[c]));
    const r = await pool.query(
      `INSERT INTO ${table} (${cols.map(c => `"${c}"`).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING`,
      vals
    );
    added += r.rowCount;
  }
  console.log(`${table}: ${added} of ${rows.length} restored`);
}
await pool.end();
console.log("done");
