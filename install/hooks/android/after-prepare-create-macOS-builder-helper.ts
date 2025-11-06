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

// Adds a helper script to run "npm rebuild" with the current PATH.
// This workaround is needed for Android Studio on macOS when it is not started
// from the command line, as npm probably won't be in the PATH at build time.
async function buildMacOSHelperNpmBuildScript(context: any, platform: string) {
  var wwwPath = await getPlatformWWWPath(context, platform);
  var helperMacOSBuildScriptPath = path.join(wwwPath, 'build-native-modules-MacOS-helper-script.sh');
  fs.writeFileSync( helperMacOSBuildScriptPath,`#!/bin/bash
    export PATH=$PATH:${process.env.PATH}
    npm $@
  `, {"mode": 0o755}
  );
}

export default async function(context: any) {
  if (context.opts.platforms.indexOf('android') >= 0) {
    if (process.platform === 'darwin') {
      await buildMacOSHelperNpmBuildScript(context, 'android');
    }
  }
}
