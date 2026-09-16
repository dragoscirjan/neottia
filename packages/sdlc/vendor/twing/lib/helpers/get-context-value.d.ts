import type { TwingContext } from "../context";
export declare const getContextValue: (charset: string, templateName: string, isStrictVariables: boolean, context: TwingContext<any, any>, name: string, isAlwaysDefined: boolean, shouldIgnoreStrictCheck: boolean, shouldTestExistence: boolean) => Promise<any>;
export declare const getContextValueSynchronously: (charset: string, templateName: string, isStrictVariables: boolean, context: Map<string, any>, globals: Map<string, any>, name: string, isAlwaysDefined: boolean, shouldIgnoreStrictCheck: boolean, shouldTestExistence: boolean) => any;
