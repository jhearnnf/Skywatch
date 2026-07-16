import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'academy.skywatch.app',
  appName: 'SkyWatch CBAT',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      // Both keys must be the *Web* OAuth 2.0 Client ID (same as VITE_GOOGLE_CLIENT_ID):
      // Android passes androidClientId to requestIdToken(), which mints an idToken whose
      // audience the backend verifies against GOOGLE_CLIENT_ID. The Android OAuth client
      // (keystore SHA-1) is never named here — it only has to exist in the same project.
      // serverClientId alone is not read by the Android plugin; without androidClientId it
      // falls back to the placeholder string resource and sign-in fails with DEVELOPER_ERROR.
      androidClientId: '248214544238-ub38ovdua6e5d0ej88scvhu7hhk2ggkn.apps.googleusercontent.com',
      serverClientId: '248214544238-ub38ovdua6e5d0ej88scvhu7hhk2ggkn.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
