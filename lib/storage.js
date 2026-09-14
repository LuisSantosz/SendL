"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
function storage(directory) {
  return {
    async read(name, fallback = null) {
      try { return JSON.parse(await fs.readFile(path.join(directory, name + ".json"), "utf8")); }
      catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
    },
    async write(name, value) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const target = path.join(directory, name + ".json");
      const temp = target + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
      try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, target); }
      finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    },
    async remove(name) { await fs.rm(path.join(directory, name + ".json"), { force: true }); }
  };
}
module.exports = storage;
