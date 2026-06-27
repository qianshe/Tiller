export type DomainEvent<Name extends string = string, Payload = unknown> = {
  name: Name;
  payload: Payload;
  occurredAt: string;
};

export type DomainEventBusPort = {
  publish(event: DomainEvent): Promise<void>;
  publishMany(events: DomainEvent[]): Promise<void>;
};
