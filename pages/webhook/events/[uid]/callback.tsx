import { parse } from 'query-string';
import { isEmpty } from 'ramda';
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function CallbackScreen() {
  const router = useRouter();
  const { asPath: path, basePath } = router;
  const endpoint = [basePath, '/api/v1', path.split('/callback')[0]].join('');
  const query = path.includes('?') || !path.includes('#') ? router.query : parse(path.split('#', 2)[1]);

  useEffect(() => {
    console.debug('[CallbackScreen] Parsed params:', { query });

    // The page may not be able to read the browser's location when exported as
    // static HTML, or unexpectedly rendered on the server-side.
    if (isEmpty(query)) {
      console.debug('[CallbackScreen] Abort', { query });
      return;
    }

    const process = async () => {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      });
      if (resp.status === 200) {
        console.info('[CallbackScreen] Posted event to server', await resp.json());
      } else {
        console.info('[CallbackScreen] Failed to send event', { status: resp.status });
      }
    };
    process().catch(error => {
      console.error('[CallbackScreen] Failed to send event', error);
    });
  }, [endpoint, JSON.stringify(query)]);

  return <div>{'Webhook event received, processing details. You may close this window at any time.'}</div>;
}
