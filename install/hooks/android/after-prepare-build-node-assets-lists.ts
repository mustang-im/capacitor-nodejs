import fs from 'node:fs';
import path from 'node:path';

var fileList: string[] = [];
var dirList: string[] = [];

function enumFolder(folderPath: string) {
  var files = fs.readdirSync(folderPath);
  for (var i in files) {
    var name = files[i];
    var filePath = folderPath + '/' + files[i];
    if (fs.statSync(filePath).isDirectory()) {
      if (name.startsWith('.') === false) {
        dirList.push(filePath);
        enumFolder(filePath);
      }
    } else {
      if (name.startsWith('.') === false &&
          name.endsWith('.gz') === false &&
          name.endsWith('~') === false) {
        fileList.push(filePath);
      }
    }
  }
}

async function createFileAndFolderLists(context: any) {
  try {
    var cordovaLib = context.requireCordovaModule('cordova-lib');
    var platformAPI = cordovaLib.cordova_platforms.getPlatformApi('android');
    var nodeJsProjectRoot = 'www/nodejs-project';
    // The Android application's assets path will be the parent of the application's www folder.
    var androidAssetsPath = path.join(platformAPI.locations.www,'..');
    var fileListPath = path.join(androidAssetsPath,'file.list');
    var dirListPath = path.join(androidAssetsPath,'dir.list');

    enumFolder(nodeJsProjectRoot);
    fs.writeFileSync(fileListPath, fileList.join('\n'));
    fs.writeFileSync(dirListPath, dirList.join('\n'));
  } catch (err) {
    console.log(err);
    throw err;
  }
}

export default async function(context: any) {
  if (context.opts.platforms.indexOf('android') < 0) {
    return;
  }

  await createFileAndFolderLists(context);
}
