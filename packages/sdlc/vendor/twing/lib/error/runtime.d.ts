import { TwingErrorLocation, TwingBaseError } from "./base";
import type { TwingSource } from "../source";
export declare const runtimeErrorName = "TwingRuntimeError";
export interface TwingRuntimeError extends TwingBaseError<typeof runtimeErrorName> {
}
export declare const createRuntimeError: (message: string, location: TwingErrorLocation, source: TwingSource, previous?: Error) => TwingRuntimeError;
