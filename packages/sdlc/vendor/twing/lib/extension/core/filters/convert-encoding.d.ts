import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
export declare const convertEncoding: TwingCallable<[
    value: string | Buffer,
    to: string,
    from: string
], Buffer>;
export declare const convertEncodingSynchronously: TwingSynchronousCallable<[
    value: string | Buffer,
    to: string,
    from: string
], Buffer>;
