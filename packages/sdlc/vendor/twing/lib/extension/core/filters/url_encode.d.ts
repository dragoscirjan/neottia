import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * URL encodes (RFC 3986) a string as a path segment or a hash as a query string.
 *
 * @param {string|{}} url A URL or a hash of query parameters
 *
 * @returns {Promise<string>} The URL encoded value
 */
export declare const url_encode: TwingCallable;
export declare const urlEncodeSynchronously: TwingSynchronousCallable;
