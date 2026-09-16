import type { TwingCallable } from "../../../callable-wrapper";
import { TwingSynchronousCallable } from "../../../callable-wrapper";
export declare const constant: TwingCallable<[
    name: string,
    object: any | null
]>;
export declare const constantSynchronously: TwingSynchronousCallable<[
    name: string,
    object: any | null
]>;
