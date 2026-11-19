/** The receiving service of a sent command; absent or multiple receivers keep the sender. */
export interface MessagingService {
  serviceId: string;
  send: readonly string[];
  receive: readonly string[];
}

export function messagingCommandReceiver(
  kind: unknown,
  references: readonly string[],
  services: readonly MessagingService[],
): string | undefined {
  if (kind !== 'command') {
    return undefined;
  }
  const accepted = new Set(references);
  const sent = services.some(service => service.send.some(reference => accepted.has(reference)));
  if (!sent) {
    return undefined;
  }
  const receivers = new Set(services
    .filter(service => service.receive.some(reference => accepted.has(reference)))
    .map(service => service.serviceId));
  if (receivers.size !== 1) {
    return undefined;
  }
  return receivers.values().next().value;
}

/** Contracts of one service share this identity, including across contract kinds. */
export function messagingServiceIdentity(contract: { id: string; fileOrigin?: string; data?: Record<string, unknown> }): string {
  const data = contract.data ?? {};
  if (typeof data._service !== 'string') {
    return contract.id;
  }
  return JSON.stringify([contract.fileOrigin, data._party, data._context, data._service]);
}
