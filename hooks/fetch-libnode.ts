/// <reference types="../" />
import { cp, glob, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import fs from "node:fs";
import AdmZip from "adm-zip";
import type { PluginsConfig } from "@capacitor/cli";

const __dirname = import.meta.dirname;
const packageDir = path.resolve(__dirname, "../");
const projectDir = path.resolve(packageDir, "../../");


async function getConfigPath() {
  for await (let path of glob(`${projectDir}/**/capacitor.config.{ts,json}`)) {
    if (path) {
      return path;
    }
  }
}

async function readConfig(path: string) {
  let file = await import(path);
  let config = file.default.plugins.CapacitorNodeJS;
  return config;
}

const platform = process.env.CAPACITOR_PLATFORM_NAME ?? "web";
const iosDefaultLib = 'https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-ios.zip';
const androidDefaultLib = 'https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip';

const AndroidArch = {
  arm: "armeabi-v7a",
  arm64: "arm64-v8a",
  x64: "x86_64",
}

const noLibCache = process.env.NO_LIBNODE_CACHE;
let libDir: string = platform == 'android' ? androidDefaultLib : iosDefaultLib;
let archs: string[] = platform == 'android' ? Object.keys(AndroidArch) : [];

/**
 * Sets the correct lib path for the platform and
 * fetches the lib if source is an `https://` url
 */
async function setupLib() {
  try {
    if (!noLibCache && libNodesPresent(platform, archs)) {
      await removeUnusedLibs(platform, archs);
      return;
    }

    if (!libDir?.startsWith("https://")) {
      await copyLib();
      await removeUnusedLibs(platform, archs);
      return;
    }

    let url = libDir;
    libDir = path.join(packageDir, platform, 'libnode');

    console.log('Downloading libnode...');
    let zipPath = await fetchLib(url);
    console.log('Download finished!');

    console.log('Extracting libnode...');
    await extractAsset(zipPath, libDir);
    console.log('Extraction finished!');

    await removeUnusedLibs(platform, archs);
  } catch (ex) {
    console.error(ex);
    process.exit(0);
  }
}

const androidProject = path.join(packageDir, "android");
const androidBinDir = path.join(androidProject, "libnode", "bin");

async function copyLib() {
  let destDir = path.join(packageDir, platform, 'libnode');
  await cp(libDir, destDir, {recursive: true});
  libDir = destDir;
}

function libNodesPresent(platform: string, archs: string[]) {
  if (platform == "android") {
    let validArchs = Object.entries(AndroidArch);
    let selectedArchs = validArchs.filter((vArch) => archs.includes(vArch[0] as string));
    return selectedArchs.every((arch) => fs.existsSync(path.join(androidBinDir, arch[1], "libnode.so")));
  }
  return false;
}

async function removeUnusedLibs(platform: string, archs: string[]) {
  if (platform == "android") {
    let validArchs = Object.entries(AndroidArch);
    let selectedArchs = validArchs.filter((vArch) => archs.includes(vArch[0] as string));
    let deleteItems = (await readdir(androidBinDir)).filter((i) => !selectedArchs.some((a) => i == a[1]));
    await Promise.all(deleteItems.map((i) => rm(path.join(androidBinDir, i), {recursive: true})));
  }
}

async function fetchLib(url: string, retries = 5): Promise<string> {
  return await new Promise(async (resolve, reject) => {
    try {
      if (!url) {
        reject(new Error("ERROR: Missing lib URL"));
      }
      if (retries == 0) {
        reject(new Error('ERROR: Too many retries while fetching libnode...'));
      }
      https.get(url, {headers: {'User-Agent': 'node.js'}}, async (fileRes) => {
        fileRes.on("error", (ex) => {
          reject(ex);
        });
        if (fileRes.statusCode == 302) {
          resolve(await fetchLib(fileRes.headers.location as string, retries -= 1));
        }
        const tmpPath = path.join(packageDir, "tmp.zip");
        const fileStream = fs.createWriteStream(tmpPath);
        fileRes.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(fileStream.path as string);
        });
      });
    } catch (ex) {
      reject(ex);
    }
  });
}

async function extractAsset(zipPath: string, destinationPath: string) {
  let zip = new AdmZip(zipPath);
  zip.extractAllTo(destinationPath, true);
  fs.unlinkSync(zipPath);
}

async function configureAndroidBuild() {
  if (platform != "android") return;

  // @ts-ignore
  let content = `ANDROID_ABI=${archs.map((a) => AndroidArch[a]).join(",")}\n`;
  await writeFile(path.join(androidProject, "build.properties"), content);
}


async function main() {
  try {
    if (platform == "web") return;

    let path = await getConfigPath();
    if (!path) {
      throw new Error("ERROR: Capacitor config not found");
    }

    let config: PluginsConfig["CapacitorNodeJS"] = await readConfig(path);
    libDir = config?.[`${platform}LibNode`] ?? libDir;
    archs = config?.[`${platform}Architectures`] ?? archs;

    await Promise.all([
      setupLib(),
      configureAndroidBuild(),
    ]);

  } catch (ex) {
    console.error(ex);
  }
}

main();
