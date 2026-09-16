import { TwingErrorLocation, TwingBaseError } from "./base";
import type { TwingSource } from "../source";
export declare const parsingErrorName = "TwingParsingError";
export interface TwingParsingError extends TwingBaseError<typeof parsingErrorName> {
    /**
     * Tweaks the error message to include suggestions.
     *
     * @param {string} name The original name of the item that does not exist
     * @param {Array<string>} items An array of possible items
     */
    addSuggestions(name: string, items: Array<string>): void;
}
export declare const createParsingError: (message: string, location: TwingErrorLocation, source: TwingSource, previous?: Error) => TwingParsingError;
