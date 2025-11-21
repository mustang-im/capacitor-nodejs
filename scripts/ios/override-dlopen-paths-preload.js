import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const substitutionDataFile = path.join(__dirname, 'override-dlopen-paths-data.json');

if (fs.existsSync(substitutionDataFile)) {
  const pathSubstitutionData = JSON.parse(fs.readFileSync(substitutionDataFile, 'utf8'));

  const pathSubstitutionDictionary = Object.fromEntries(
    pathSubstitutionData.map(({ originalpath, newpath }) => [
      path.normalize(path.join(__dirname, ...originalpath)),
      path.normalize(path.join(__dirname, ...newpath))
    ])
  );

  const oldDlopen = process.dlopen;

  process.dlopen = function (_module, _filename) {
    const normalizedFilename = path.normalize(_filename);
    if (pathSubstitutionDictionary?.[normalizedFilename]) {
      _filename = pathSubstitutionDictionary[normalizedFilename];
    }
    oldDlopen(_module, _filename);
  };
}
