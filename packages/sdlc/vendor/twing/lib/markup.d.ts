export interface TwingMarkup {
    /**
     * @deprecated
     */
    readonly charset: string;
    readonly content: string;
    /**
     * @deprecated
     */
    readonly count: number;
    /**
     * @deprecated
     */
    toJSON: () => string;
    /**
     * @deprecated
     */
    toString: () => string;
}
export declare const isAMarkup: (candidate: any) => candidate is TwingMarkup;
export declare const createMarkup: (content: string, charset?: string) => TwingMarkup;
