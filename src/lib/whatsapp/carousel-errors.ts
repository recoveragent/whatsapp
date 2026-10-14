/** Explicit HTTP rejection, distinct from an unknown network outcome. */
export class MetaCarouselRejectedError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'MetaCarouselRejectedError';
  }
}
