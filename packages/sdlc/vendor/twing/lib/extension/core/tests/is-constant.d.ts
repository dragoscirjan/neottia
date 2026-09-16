import type { TwingCallable } from "../../../callable-wrapper";
import { TwingSynchronousCallable } from "../../../callable-wrapper";
export declare const isConstant: TwingCallable<[
    comparand: any,
    constant: any,
    object: any | null
], boolean>;
export declare const isConstantSynchronously: TwingSynchronousCallable<[
    comparand: any,
    constant: any,
    object: any | null
], boolean>;
