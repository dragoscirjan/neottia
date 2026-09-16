/**
 * Provides the ability to get constants from instances as well as class/global constants.
 *
 * Constants makes no sense in JavaScript. To emulate the expected behavior, it is assumed that so-called constants are keys of the environment constructor or the passed object constructor.
 *
 * @param {string} name The name of the constant
 * @param {any} object The object to get the constant from
 *
 * @returns {any}
 */
import { TwingContext } from "../context";
export declare function getConstant(context: TwingContext<any, any> | Map<string, any>, name: string, object: any | null): any;
