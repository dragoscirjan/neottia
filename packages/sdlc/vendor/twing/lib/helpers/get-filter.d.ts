import type { TwingFilter, TwingSynchronousFilter } from "../filter";
/**
 * Get a filter by name.
 *
 * @param {string} name The filter name
 *
 * @return {TwingFilter|false} A TwingFilter instance or false if the filter does not exist
 */
export declare const getFilter: <Filter extends TwingFilter | TwingSynchronousFilter>(filters: Map<string, Filter>, name: string) => Filter | null;
