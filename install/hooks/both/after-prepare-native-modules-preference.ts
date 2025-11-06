import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Gets the platform's www path.
async function getPlatformWWWPath(context: any, platform: string) {
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
  return platformAPIInstance.locations.www;
}

// Adds a file to save the contents of the NODEJS_MOBILE_BUILD_NATIVE_MODULES
// environment variable if it is set during the prepare step.
async function saveBuildNativeModulesPreference(context: any, platform: string) {
  var wwwPath = await getPlatformWWWPath(context, platform);
  var saveBuildNativeModulesPreferencePath = path.join(wwwPath, 'NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt');
  if (process.env.NODEJS_MOBILE_BUILD_NATIVE_MODULES !== undefined) {
    fs.writeFileSync(saveBuildNativeModulesPreferencePath, process.env.NODEJS_MOBILE_BUILD_NATIVE_MODULES);
  }
}

export default async function(context: any) {
  if (context.opts.platforms.indexOf('android') >= 0) {
    await saveBuildNativeModulesPreference(context, 'android');
  }
  if (context.opts.platforms.indexOf('ios') >= 0) {
    await saveBuildNativeModulesPreference(context, 'ios');
  }
}
