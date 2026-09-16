/**
 * Split an hash into chunks.
 *
 * @param {*} hash
 * @param {number} size
 * @param {boolean} preserveKeys
 * @returns {Promise<Array<Map<any, any>>>}
 */
export declare function chunk(hash: any, size: number, preserveKeys: boolean): Promise<Array<Map<any, any>>>;
/**
 * Split an hash into chunks, synchronously.
 *
 * @param {*} hash
 * @param {number} size
 * @param {boolean} preserveKeys
 */
export declare function chunkSynchronously(hash: any, size: number, preserveKeys: boolean): Array<Map<any, any>>;
