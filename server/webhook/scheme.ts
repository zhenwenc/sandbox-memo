import * as t from '@navch/codec';

import { InfluxPointBuilder } from '../telemetry/influxdb';
import { PusherChannel } from '../subscription/pusher.repository';
import { mattrScheme } from './mattr.scheme';

export type RequestContext<TBody> = {
  readonly body: TBody;
  readonly channel: PusherChannel;
};

export type EventScheme<TEvent extends t.Mixed> = {
  readonly isEventBody: (data: unknown) => data is t.TypeOf<TEvent>;
  readonly influxdb: {
    pointBuilder: (data: RequestContext<t.TypeOf<TEvent>>) => InfluxPointBuilder;
  };
  readonly pusher: {
    eventType: string;
  };
};

export const schemes = [mattrScheme];
