export interface TwingSource {
    readonly code: string;
    readonly name: string;
}
export declare const createSource: (name: string, code: string) => TwingSource;
