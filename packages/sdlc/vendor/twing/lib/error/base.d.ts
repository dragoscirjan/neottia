import type { TwingSource } from "../source";
export type TwingErrorLocation = {
    line: number;
    column: number;
};
export interface TwingBaseError<Name extends string> extends Error {
    readonly name: Name;
    readonly previous: any | undefined;
    readonly rootMessage: string;
    location: TwingErrorLocation;
    source: TwingSource;
    appendMessage(message: string): void;
}
export declare const createBaseError: <Name extends string>(name: Name, message: string, location: TwingErrorLocation, source: TwingSource, previous?: any) => TwingBaseError<Name>;
