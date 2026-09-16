import { TwingMarkup } from "../../../markup";
import type { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
export declare const dump: TwingCallable<[
    ...vars: Array<any>
], TwingMarkup>;
export declare const dumpSynchronously: TwingSynchronousCallable<[
    ...vars: Array<any>
], TwingMarkup>;
