import path from "node:path";
import { glob } from "fs/promises";

export const __dirname = import.meta.dirname;
export const packageDir = path.resolve(__dirname, "../../../");
export const projectDir = path.resolve(packageDir, "../../");

export async function getConfigPath() {
  for await (let path of glob(`${projectDir}/**/capacitor.config.{ts,json}`)) {
    if (path) {
      return path;
    }
  }
}

export async function readConfig(path: string) {
  let file = await import(path);
  let config = file.default.plugins.CapacitorNodeJS;
  return config;
}
