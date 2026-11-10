import { chmodSync, copyFileSync } from "node:fs"
copyFileSync("src/catalog.json", "dist/catalog.json")
chmodSync("dist/index.js", 0o755)
