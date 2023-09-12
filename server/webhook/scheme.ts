import * as t from '@navch/codec';

import { InfluxPointBuilder } from '../telemetry/influxdb';
import { WebhookChannel } from '../webhook/webhook.repository';
import { mattrScheme } from './mattr.scheme';

export type RequestContext<TBody> = {
  readonly body: TBody;
  readonly channel: WebhookChannel;
};

export type EventScheme<TEvent extends t.Mixed, TPresentation extends t.Mixed> = {
  readonly isEventBody: (data: unknown) => data is t.TypeOf<TEvent>;
  readonly isPresentationBody: (data: unknown) => data is t.TypeOf<TPresentation>;
  readonly presentation: {
    uid: (data: t.TypeOf<TPresentation>) => string;
  };
  readonly influxdb: {
    pointBuilder: (data: RequestContext<t.TypeOf<TEvent>>) => InfluxPointBuilder;
  };
  readonly pusher: {
    eventType: string;
  };
};

export const schemes = [mattrScheme];
