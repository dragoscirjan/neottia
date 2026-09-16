export type IterateCallback = (key: any, value: any) => Promise<void>;
export type SynchronousIterateCallback = (key: any, value: any) => void;
/**
 * Executes the provided function once for each element of an iterable.
 *
 * @param {*} iterable An iterable
 * @param {IterateCallback} callback Callback to execute for each element, taking a key and a value as arguments
 *
 * @return {void}
 */
export declare const iterate: (iterable: any, callback: IterateCallback) => Promise<void>;
export declare const iterateSynchronously: (iterable: any, callback: SynchronousIterateCallback) => void;
