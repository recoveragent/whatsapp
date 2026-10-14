/** A Meta receipt proves delivery was accepted. A later local failure must
 * not trigger another outbound send to the customer. */
export class ProductCarouselAlreadySentError extends Error {
  constructor(
    readonly whatsappMessageId: string,
    cause: unknown
  ) {
    super('Carousel accepted by Meta; local persistence failed.', { cause });
    this.name = 'ProductCarouselAlreadySentError';
  }
}

/** A network/server failure may have happened after Meta accepted the send.
 * Wait for a receipt or human review rather than sending a duplicate. */
export class ProductCarouselDeliveryUncertainError extends Error {
  constructor(cause: unknown) {
    super('Carousel delivery outcome is unknown; automatic fallback skipped.', {
      cause,
    });
    this.name = 'ProductCarouselDeliveryUncertainError';
  }
}
