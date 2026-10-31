// פענוח גיבוי מוצפן של Pageturner
// שימוש: BACKUP_PASSPHRASE=... node scripts/decrypt-backup.mjs pageturner-backup-YYYY-MM-DD.json.gz.enc
// התוצאה: קובץ .json.gz רגיל לצידו, שאפשר לשחזר עם scripts/restore-backup.mjs
import fs from "fs";
import { scryptSync, createDecipheriv } from "crypto";

const file = process.argv[2];
const pass = process.env.BACKUP_PASSPHRASE;
if (!file || !pass) {
  console.error("usage: BACKUP_PASSPHRASE=... node scripts/decrypt-backup.mjs <backup.json.gz.enc>");
  process.exit(1);
}
const buf = fs.readFileSync(file);
if (buf.subarray(0, 5).toString() !== "PTBK1") { console.error("not an encrypted Pageturner backup"); process.exit(1); }
const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(33, 49), enc = buf.subarray(49);
const d = createDecipheriv("aes-256-gcm", scryptSync(pass, salt, 32), iv);
d.setAuthTag(tag);
let out;
try { out = Buffer.concat([d.update(enc), d.final()]); }
catch { console.error("wrong passphrase or corrupted file"); process.exit(1); }
const outFile = file.replace(/\.enc$/, "");
fs.writeFileSync(outFile, out);
console.log(`decrypted → ${outFile}`);
