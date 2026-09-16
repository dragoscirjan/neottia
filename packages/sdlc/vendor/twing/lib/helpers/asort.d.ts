/**
 * Sort a map and maintain index association.
 *
 * @param map
 * @param compareFunction
 * @returns
 */
export declare const asort: (map: Map<any, any>, compareFunction?: (a: any, b: any) => Promise<-1 | 0 | 1>) => Promise<void>;
export declare const asortSynchronously: (map: Map<any, any>, compareFunction?: (a: any, b: any) => -1 | 0 | 1) => void;
