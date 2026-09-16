import { TwingCallable, TwingSynchronousCallable } from "../../../callable-wrapper";
/**
 * Number format filter.
 *
 * All of the formatting options can be left null, in that case the defaults will
 * be used.  Supplying any of the parameters will override the defaults set in the
 * environment object.
 *
 * @param {*} number A float/int/string of the number to format
 * @param {number} numberOfDecimals the number of decimal points to display
 * @param {string} decimalPoint the character(s) to use for the decimal point
 * @param {string} thousandSeparator the character(s) to use for the thousands separator
 *
 * @returns {Promise<string>} The formatted number
 */
export declare const numberFormat: TwingCallable;
export declare const numberFormatSynchronously: TwingSynchronousCallable;
