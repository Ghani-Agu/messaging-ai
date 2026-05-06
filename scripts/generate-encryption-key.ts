import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");
console.log(`LIVE_DATA_ENCRYPTION_KEY=${key}`);
console.log("");
console.log("Add the line above to .env.local. Save the key to your");
console.log("password manager as backup. Losing this key means losing");
console.log("access to all encrypted Live Data Source credentials.");
