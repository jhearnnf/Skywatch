import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'academy.skywatch.app',
  appName: 'SkyWatch',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      // Must match your Web OAuth 2.0 Client ID (same as VITE_GOOGLE_CLIENT_ID).
      // Replace this placeholder with your actual client ID.
      serverClientId: '248214544238-ub38ovdua6e5d0ej88scvhu7hhk2ggkn.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
