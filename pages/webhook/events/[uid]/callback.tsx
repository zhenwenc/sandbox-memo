import { parse } from 'query-string';
import { isEmpty } from 'ramda';
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function CallbackScreen() {
  const router = useRouter();
  const url = router.asPath;
  const query = url.includes('?') || !url.includes('#') ? router.query : parse(url.split('#', 2)[1]);
  const uid = router.query.uid as string;

  useEffect(() => {
    console.debug('[CallbackScreen] Parsed params:', { uid, query });

    // The page may not be able to read the browser's location when exported as
    // static HTML, or unexpectedly rendered on the server-side.
    if (!uid || isEmpty(query)) {
      console.debug('[CallbackScreen] Abort', { uid, query });
      return;
    }

    const params = query as Record<string, string>;

    fetch(`/api/v1/webhook/events/${uid}`, { method: 'POST', body: JSON.stringify(params) })
      .then(resp => {
        console.info('[CallbackScreen] Posted query params to server', resp.body);
      })
      .catch(error => {
        console.error('[CallbackScreen] Failed to post data', error);
      });
  }, [uid, JSON.stringify(query)]);

  return <div>'Webhook event received, processing details. You may close this window at any time.'</div>;
}
