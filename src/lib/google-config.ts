import 'server-only';

export function googlePickerConfiguration() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const apiKey = process.env.GOOGLE_PICKER_API_KEY;
  const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER;
  if (!clientId || !apiKey || !appId) return null;
  return { clientId, apiKey, appId };
}
