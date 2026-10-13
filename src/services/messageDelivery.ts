export class MessageDeliveryError extends Error {
    readonly delivery: 'not-sent' | 'uncertain' | 'sent';
    constructor(message: string, delivery: 'not-sent' | 'uncertain' | 'sent') {
        super(message);
        this.name = 'MessageDeliveryError';
        this.delivery = delivery;
    }
}
