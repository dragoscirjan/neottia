import type { TwingSource } from "../source";
export declare function getTraceableMethod<M extends (...args: Array<any>) => Promise<any>>(method: M, location: {
    line: number;
    column: number;
}, templateSource: TwingSource): M;
export declare function getSynchronousTraceableMethod<M extends (...args: Array<any>) => any>(method: M, location: {
    line: number;
    column: number;
}, templateSource: TwingSource): M;
