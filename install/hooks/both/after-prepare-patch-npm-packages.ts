import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Patches a package.json in case it has variable substitution for
// the module's binary at runtime. Since we are cross-compiling
// for mobile, this substitution will have different values at
// build time and runtime, so we pre-substitute them with fixed
// values.
function patchPackageJSON_preNodeGyp_modulePath(filePath: string) {
  let packageReadData = fs.readFileSync(filePath, 'utf8');
  let packageJSON = JSON.parse(packageReadData);
  if ( packageJSON && packageJSON.binary && packageJSON.binary.module_path ) {
    let binaryPathConfiguration = packageJSON.binary.module_path;
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{node_abi\}/g, "node_abi");
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{platform\}/g, "platform");
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{arch\}/g, "arch");
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{target_arch\}/g, "target_arch");
    binaryPathConfiguration = binaryPathConfiguration.replace(/\{libc\}/g, "libc");
    packageJSON.binary.module_path = binaryPathConfiguration;
    let packageWriteData = JSON.stringify(packageJSON, null, 2);
    fs.writeFileSync(filePath, packageWriteData);
  }
}

// Visits every package.json to apply patches.
function visitPackageJSON(folderPath: string) {
  let files = fs.readdirSync(folderPath);
  for (var i in files) {
    let name = files[i];
    let filePath = path.join(folderPath, files[i]);
    if(fs.statSync(filePath).isDirectory()) {
      visitPackageJSON(filePath);
    } else {
      if (name === 'package.json') {
        try {
          patchPackageJSON_preNodeGyp_modulePath(filePath);
        } catch (e) {
          console.warn(
            'Failed to patch the file : "' +
            filePath +
            '". The following error was thrown: ' +
            JSON.stringify(e)
          );
        }
      }
    }
  }
}

// Applies the patch to the selected platform
async function patchTargetPlatform(context: any, platform: string) {
  const platformPath = path.join(context.opts.projectRoot, 'platforms', platform);
  const apiPath = path.join(platformPath, 'cordova', 'Api');
  const platformAPIModule = await import(pathToFileURL(apiPath).href);
  const platformAPI = platformAPIModule.default || platformAPIModule;
  let platformAPIInstance;
  try {
    platformAPIInstance = new platformAPI();
  } catch (e) {
    platformAPIInstance = new platformAPI(platform, platformPath);
  }
  const wwwPath = platformAPIInstance.locations.www;
  const nodeModulesPathToPatch = path.join(wwwPath, 'nodejs-project', 'node_modules');
  if (fs.existsSync(nodeModulesPathToPatch)) {
    visitPackageJSON(nodeModulesPathToPatch);
  }
}

export default async function(context: any) {
  if (context.opts.platforms.indexOf('android') >= 0) {
    await patchTargetPlatform(context, 'android');
  }
  if (context.opts.platforms.indexOf('ios') >= 0) {
    await patchTargetPlatform(context, 'ios');
  }
}
