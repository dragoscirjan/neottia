import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
export declare const map: TwingCallable<[
    map: any,
    callback: (...args: Array<any>) => Promise<any>
], Map<any, any>>;
export declare const mapSynchronously: TwingSynchronousCallable<[
    map: any,
    callback: (...args: Array<any>) => any
], Map<any, any>>;
