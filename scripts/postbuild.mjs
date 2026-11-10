import { chmodSync } from "node:fs"
chmodSync("dist/index.js", 0o755)
