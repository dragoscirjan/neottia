import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Cycles over a value.
 *
 * @param _executionContext
 * @param value
 * @param position The cycle position
 *
 * @returns The value at position
 */
export declare const cycle: TwingCallable<[
    value: Map<any, any> | Array<any> | string | boolean | null,
    position: number
]>;
export declare const cycleSynchronously: TwingSynchronousCallable<[
    value: Map<any, any> | Array<any> | string | boolean | null,
    position: number
]>;
