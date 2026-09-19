'use client';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type GoogleAccountsWindow = {
  google: {
    accounts: {
      oauth2: {
        initTokenClient(config: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void }): { requestAccessToken(options?: { prompt?: string }): void };
      };
    };
  };
};

const googleWindow = () => (window as unknown as GoogleAccountsWindow);

function loadScript(id: string, src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') return resolve();
    const script = existing ?? document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error('Google library could not load.'));
    if (!existing) document.head.appendChild(script);
  });
}

/*
  Returns an access token for the drive.file scope, the same scope the
  tracker connection was authorised with. Google re-uses the existing
  grant, so this normally completes without any prompt.
*/
export async function requestGoogleToken(clientId: string): Promise<string> {
  if (!clientId) throw new Error('Google authorization is not configured.');
  await loadScript('google-identity-services', 'https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    const client = googleWindow().google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => response.access_token ? resolve(response.access_token) : reject(new Error(response.error || 'Authorization was cancelled.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}
