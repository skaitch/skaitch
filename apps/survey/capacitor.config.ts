import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.skaitch.survey',
  appName: 'skAItch Survey',
  webDir: 'dist',
  // Sending to the desktop app goes over plain HTTP on the local network (ADR 0011).
  android: { allowMixedContent: true },
};

export default config;
