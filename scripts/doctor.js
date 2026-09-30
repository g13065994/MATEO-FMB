'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const required = ['package.json', 'package-lock.json', 'settings.json', 'index.js'];
const failures = [];

console.log('MATEO-FMB doctor');
console.log('Node: ' + process.version);
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) failures.push('Node.js 22 or newer is required.');

for (const file of required) {
  if (fs.existsSync(path.join(root, file))) console.log('OK    ' + file);
  else failures.push('Missing ' + file);
}

try {
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  console.log('OK    JSON configuration');
} catch (error) {
  failures.push('Invalid JSON configuration: ' + error.message);
}

const appState = process.env.MATEO_APPSTATE_FILE || path.join(root, 'appstate.json');
console.log((fs.existsSync(appState) ? 'OK    ' : 'INFO  ') + 'AppState: ' + appState);

if (failures.length) {
  console.error('\nDoctor found problems:');
  for (const failure of failures) console.error('ERROR ' + failure);
  process.exitCode = 1;
} else {
  console.log('\nMATEO-FMB baseline looks healthy.');
}
