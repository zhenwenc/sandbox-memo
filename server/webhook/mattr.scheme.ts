import * as t from '@navch/codec';

import { EventScheme } from './scheme';
import { currentTimestamp } from '../telemetry/influxdb';

const WebhookEventBody = t.type({
  event: t.type({
    id: t.string,
    type: t.string,
    timestamp: t.string,
  }),
  webhookId: t.string,
  deliveryId: t.string,
  deliveryTimestamp: t.string,
});

/**
 * MATTR Webhook {@link https://learn.mattr.global/tutorials/}
 */
export const mattrScheme: EventScheme<typeof WebhookEventBody> = {
  isEventBody: WebhookEventBody.is,
  influxdb: {
    pointBuilder: data => point => {
      const { body, channel } = data;

      const now = Date.now();
      const eventTimestamp = new Date(body.event.timestamp).getTime();
      const deliveryTimestamp = new Date(body.deliveryTimestamp).getTime();

      /**
       * The estimated kafka consumer group lag in milliseconds. This metrics uses
       * the time difference between event creation time and event delivery time.
       *
       * Note that the delivery request time is NOT included.
       */
      return point
        .tag('channel', channel.id)
        .tag('webhook_id', body.webhookId)
        .tag('event_type', body.event.type)
        .intField('event_lag_ms', deliveryTimestamp - eventTimestamp)
        .intField('event_arrival_lag_ms', now - eventTimestamp)
        .intField('delivery_lag_ms', now - deliveryTimestamp)
        .timestamp(currentTimestamp());
    },
  },
  pusher: {
    eventType: 'WEBHOOK_MATTR_EVENT',
  },
};
