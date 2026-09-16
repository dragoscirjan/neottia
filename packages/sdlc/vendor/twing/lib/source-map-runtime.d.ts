import { TwingSource } from "./source";
import { TwingOutputBuffer } from "./output-buffer";
import { RawSourceMap } from "source-map";
export interface TwingSourceMapRuntime {
    readonly sourceMap: RawSourceMap;
    /**
     * @param {number} line 0-based
     * @param {number} column 1-based
     * @param {string} nodeType
     * @param {TwingSource} source
     * @param {TwingOutputBuffer} outputBuffer
     */
    enterSourceMapBlock(line: number, column: number, nodeType: string, source: TwingSource, outputBuffer: TwingOutputBuffer): void;
    leaveSourceMapBlock(outputBuffer: TwingOutputBuffer): void;
}
export declare const createSourceMapRuntime: () => TwingSourceMapRuntime;
