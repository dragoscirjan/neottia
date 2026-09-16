import type { TwingParser } from "./parser";
import type { TwingBaseNode } from "./node";
import type { Token } from "twig-lexer";
import type { TwingTokenStream } from "./token-stream";
/**
 * Interface implemented by tag handlers.
 */
export interface TwingTagHandler {
    /**
     * Initializes the tag handler with a parser and returns a token parser.
     */
    initialize(parser: TwingParser, level: 2 | 3): TwingTokenParser;
    /**
     * The tag handled by the tag handler.
     */
    readonly tag: string;
}
export type TwingTokenParser = (token: Token, stream: TwingTokenStream) => TwingBaseNode | null;
