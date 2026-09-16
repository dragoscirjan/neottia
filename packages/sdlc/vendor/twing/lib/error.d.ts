import { TwingParsingError } from "./error/parsing";
import { TwingRuntimeError } from "./error/runtime";
export type TwingError = TwingRuntimeError | TwingParsingError;
export declare const isATwingError: (candidate: Error) => candidate is TwingError;
