import { writeFileSync } from 'node:fs';
export default async function globalSetup() {
  // Marker proves whether `--list` executes globalSetup.
  writeFileSync('global-setup-ran.marker', 'ran');
}
