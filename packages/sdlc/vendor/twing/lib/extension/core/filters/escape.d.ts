import { TwingMarkup } from "../../../markup";
import type { TwingCallable } from "../../../callable-wrapper";
import { TwingSynchronousCallable } from "../../../callable-wrapper";
export declare const escape: TwingCallable<[
    value: string | TwingMarkup | null,
    strategy: string | null
], string | boolean | TwingMarkup | null>;
export declare const escapeSynchronously: TwingSynchronousCallable<[
    value: string | TwingMarkup | null,
    strategy: string | null
], string | boolean | TwingMarkup | null>;
