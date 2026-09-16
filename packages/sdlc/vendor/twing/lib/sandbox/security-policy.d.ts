import { TwingMarkup } from "../markup";
export interface TwingSandboxSecurityPolicy {
    /**
     * @param {any | TwingMarkup} candidate
     * @param {string} method
     *
     * @throws When the method is not allowed on the passed object
     */
    checkMethodAllowed(candidate: any | TwingMarkup, method: string): void;
    /**
     * @param {any} candidate
     * @param {string} property
     *
     * @throws TwingSandboxSecurityNotAllowedPropertyError When the property is not allowed on the passed object
     */
    checkPropertyAllowed(candidate: any | TwingMarkup, property: string): void;
    checkSecurity(tags: Array<string>, filters: Array<string>, functions: Array<string>): {
        message: string;
        token: string;
        type: "filter" | "function" | "tag";
    } | null;
}
export declare const createSandboxSecurityPolicy: (clearances?: {
    allowedTags?: Array<string>;
    allowedFilters?: Array<string>;
    allowedMethods?: Map<any, Array<string>>;
    allowedProperties?: Map<any, Array<string>>;
    allowedFunctions?: Array<string>;
}) => TwingSandboxSecurityPolicy;
