import type { TwingAttributeAccessorCallType } from "../node/expression/attribute-accessor";
import type { TwingEnvironment, TwingSynchronousEnvironment } from "../environment";
/**
 * Returns the attribute value for a given array/object.
 *
 * @param environment
 * @param {*} object The object or array from where to get the item
 * @param {*} attribute The item to get from the array or object
 * @param {Map<any, any>} methodArguments A map of arguments to pass if the item is an object method
 * @param {string} type The type of attribute (@see Twig_Template constants)
 * @param {boolean} shouldTestExistence Whether this is only a defined check
 * @param {boolean} shouldIgnoreStrictCheck Whether to ignore the strict attribute check or not
 * @param sandboxed
 * @param strict
 *
 * @return {Promise<any>} The attribute value, or a boolean when isDefinedTest is true, or null when the attribute is not set and ignoreStrictCheck is true
 *
 * @throw {TwingErrorRuntime} if the attribute does not exist and Twing is running in strict mode and isDefinedTest is false
 */
export declare const getAttribute: (environment: TwingEnvironment, object: any, attribute: any, methodArguments: Map<any, any>, type: TwingAttributeAccessorCallType, shouldTestExistence: boolean, shouldIgnoreStrictCheck: boolean | null, sandboxed: boolean, strict: boolean) => Promise<any>;
export declare const getAttributeSynchronously: (environment: TwingSynchronousEnvironment, object: any, attribute: any, methodArguments: Map<any, any>, type: TwingAttributeAccessorCallType, shouldTestExistence: boolean, shouldIgnoreStrictCheck: boolean | null, sandboxed: boolean, strict: boolean) => any;
