const fs = require('fs');
const path = require('path');

// Get the root directory of the application
const ROOT_DIR = path.dirname(require.main.filename);

// Build the data directory path relative to the root
const DATA_DIR = path.join(ROOT_DIR, 'data', 'activities', 'input');

fs.mkdirSync(DATA_DIR, { recursive: true }); // Create directory if it doesn't exist

// Function to write data to file
async function writeActivityFile(riderId, rideid, stravaId, data) {
  const filePath = path.join(DATA_DIR, `activity-${riderId}-${rideid}-${stravaId}.json`);
  const jsonData = JSON.stringify(data, null, 2); // Pretty-printed JSON for readability
  try {
    await fs.promises.writeFile(filePath, jsonData, 'utf-8');
    return filePath;
  } catch (err) {
    throw new Error(`Failed to write file: ${err.message}`);
  }
}

function getSortedPropertyNames(obj) {
  if (typeof obj !== 'object' || obj === null) {
      return '';
  }
  return Object.keys(obj).sort().join(',');
}

function getFilenameFromPath(filePath) {
    return path.basename(filePath);
}

module.exports = { writeActivityFile, getSortedPropertyNames, getFilenameFromPath };